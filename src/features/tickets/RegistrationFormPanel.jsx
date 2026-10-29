import React, { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { newCommandId } from './ticket-ui.mjs'

export default function RegistrationFormPanel({ ticket, can, onSaved, onBusyChange, suggestedServiceId }) {
  const info = ticket.registrationForm
  const preferredServiceId = info.serviceId || suggestedServiceId || ''
  const allowed = can('tickets.linkService') && can('planning.commercial') && can('records.contact')
  const [search, setSearch] = useState(''), [items, setItems] = useState([]), [total, setTotal] = useState(0)
  const [selected, setSelected] = useState(null), [replace, setReplace] = useState(false)
  const [email, setEmail] = useState(info.email || info.candidates?.[0] || '')
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const command = useRef(null), saving = useRef(false)
  useEffect(() => {
    if (!allowed || info.multiple || ticket.status === 'Resuelto') return
    if (search.trim().length < 2 && !preferredServiceId) { setItems([]); setTotal(0); setLoading(false); return }
    let active = true
    setLoading(true)
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ view:'formServices', search:search.trim(), ...(ticket.customerId ? {customerId:ticket.customerId} : {}), ...(!search.trim() && preferredServiceId ? {serviceId:preferredServiceId} : {}) })
      requestJson('/api/tickets?' + query).then(data => {
        if (!active) return
        setItems(data.items || []); setTotal(data.total || 0)
        if (!search.trim() && preferredServiceId && data.items?.length === 1) setSelected(data.items[0])
      }).catch(failure => { if (active) { setError(failure.message); setItems([]); setTotal(0) } }).finally(() => { if (active) setLoading(false) })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [search, ticket.customerId, ticket.version, preferredServiceId, info.multiple, ticket.status, allowed, retry])
  if (!allowed) return null
  if (info.multiple) return <section className="tickets-feedback"><h3>Formulario de alta recibido</h3><p>El aviso contiene varias respuestas. Revisá cada respuesta por separado antes de asociarla a una instalación.</p></section>
  if (ticket.status === 'Resuelto') return info.serviceId ? <section className="tickets-feedback"><h3>Formulario vinculado</h3><p>El correo {info.email} quedó guardado en la instalación. Este aviso ya fue resuelto.</p>{info.confirmedByName && <small>Vinculado por {info.confirmedByName}.</small>}</section> : null
  const conflictingEmails = (selected?.existingFormEmails || [selected?.formEmail]).filter(value => value && value.trim().toLowerCase() !== email.trim().toLowerCase())
  const conflict = conflictingEmails.length > 0
  async function submit(event) {
    event.preventDefault()
    if (saving.current || !selected || conflict && !replace) return
    saving.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      const payload = { action:'formReceipt', id:ticket.id, version:ticket.version, formEmail:email, serviceId:selected.id, replaceForm:replace, serviceSnapshot:selected.snapshot }
      const fingerprint = JSON.stringify(payload)
      if (command.current?.fingerprint !== fingerprint) command.current = { fingerprint, id:newCommandId() }
      await requestJson('/api/tickets', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...payload, commandId:command.current.id}) })
      window.dispatchEvent(new Event('agenda-form-linked'))
      window.dispatchEvent(new Event('tickets-changed'))
      onSaved?.()
    } catch (failure) {
      setError(failure.message)
      if (failure.status === 409) { setSelected(null); setReplace(false); setRetry(value => value + 1) }
    } finally { saving.current = false; setBusy(false); onBusyChange?.(false) }
  }
  return <section className="tickets-management registration-form-link">
    <h3>Vincular formulario con la agenda</h3>
    <p>Buscá la instalación por el nombre del cliente. También podés elegir una reserva que todavía no tiene PIG.</p>
    <form className="tickets-form" onSubmit={submit}>
      <label>Correo del formulario<input type="email" required readOnly={Boolean(info.email) || info.candidates?.length === 1} disabled={busy} value={email} onChange={event => { setEmail(event.target.value); setReplace(false) }} /></label>
      <label>Buscar servicio o reserva<input type="search" value={search} disabled={busy} placeholder="Nombre del cliente, PIG o CLI" onChange={event => { setSearch(event.target.value); setError('') }} /></label>
      {loading && <p role="status">Buscando instalaciones…</p>}
      {!loading && search.trim().length >= 2 && !items.length && <p role="status">No se encontraron instalaciones pendientes. Probá con otro nombre. Si todavía no está agendada, creá primero la reserva en Agenda semanal; este aviso seguirá pendiente.</p>}
      {!loading && items.length > 0 && <div className="registration-service-options" role="group" aria-label="Instalaciones encontradas">{items.map(item => <button type="button" key={item.id} className="secondary registration-service-option" aria-pressed={selected?.id === item.id} disabled={busy} onClick={() => { setSelected(item); setReplace(false); setError('') }}><span>{item.label}</span>{item.reservation && <small>Reserva · PIG pendiente</small>}</button>)}</div>}
      {!loading && total > items.length && <small>Se muestran {items.length} de {total} resultados. Completá el nombre para acotar la búsqueda.</small>}
      {selected && <div className="tickets-feedback"><b>Instalación elegida</b><p>{selected.label}</p><small>Se copiará el correo, se marcará el formulario completo y se resolverá este ticket.{selected.reservation ? ' Quedará sólo el aviso para vincular el PIG.' : ''} Esta acción no envía un correo al cliente.</small></div>}
      {conflict && <label className="tickets-checkbox"><input type="checkbox" checked={replace} disabled={busy} onChange={event => setReplace(event.target.checked)} />Confirmo reemplazar el correo existente: {conflictingEmails.join(', ')}.</label>}
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="tickets-form-footer"><button type="submit" className="primary" disabled={busy || !selected || !email.trim() || Boolean(conflict && !replace)} title="Copiá el correo a la instalación y resolvé el aviso del formulario en un solo paso.">{busy ? 'Vinculando…' : 'Vincular formulario'}</button></div>
    </form>
  </section>
}
