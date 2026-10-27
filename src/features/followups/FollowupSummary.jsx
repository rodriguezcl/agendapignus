import React, { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { usePermissions } from '../../presentation/contexts/permissions-context.jsx'
import { canWriteRecord } from '../../domain/access/record-scope.mjs'
import { collectionMoney } from '../../domain/collections/collections.mjs'
import './followups.css'
import '../../components/work-completion.css'

export default function FollowupSummary({ record }) {
  const { can, user } = usePermissions()
  const [items, setItems] = useState([])
  const [managed, setManaged] = useState(null)
  const [note, setNote] = useState('')
  const [managing, setManaging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  useEffect(() => { setManaged(null); setNote(''); setManaging(false); setError('') }, [record?.id, record?.workCompletion?.at])
  const report = managed || record?.workCompletion
  const manage = async () => {
    if (savingRef.current || !note.trim()) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      const data = await requestJson('/api/history/work-completion', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId: record.id, reportedAt: report.at, note }) })
      setManaged(data.report); setManaging(false); setNote('')
      window.dispatchEvent(new Event('focus'))
    } catch (failure) { setError(failure.message || 'No se pudo registrar la gestión.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const root = useRef(null)
  const [visible, setVisible] = useState(false)
  const enabled = Boolean(record?.id && !record.vehicleControl && can('tickets.view'))
  useEffect(() => {
    if (!enabled || !root.current) return
    if (!globalThis.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '80px' })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [enabled, record?.id])
  useEffect(() => {
    setItems([])
    if (!enabled || !visible) return
    let disposed = false
    const refresh = () => requestJson(`/api/tickets?${new URLSearchParams({ serviceId: record.id })}`, { credentials: 'same-origin' })
      .then(data => { if (!disposed) setItems(data.items || []) }).catch(() => { if (!disposed) setItems([]) })
    refresh()
    window.addEventListener('tickets-changed', refresh)
    return () => { disposed = true; window.removeEventListener('tickets-changed', refresh) }
  }, [enabled, visible, record?.id, user?.id])
  const create = can('tickets.fromService') && !record?.vehicleControl ? <button type="button" className="secondary" title="Registrá una nueva solicitud vinculada a este servicio." onClick={()=>window.dispatchEvent(new CustomEvent('open-ticket',{detail:{create:true,serviceId:String(record.id),customerId:String(record.customerId||''),customer:record.customerId?{id:String(record.customerId),name:record.client,account:record.clientAccount}:null}}))}>Nueva solicitud</button> : null
  const results = report?.items?.length ? <section className="work-result-summary" aria-label="Resultado por trabajo">
    <strong>Resultado por trabajo</strong><ul>{report.items.map(item => <li key={item.id}>{item.name}: <b>{item.status === 'completed' ? 'Realizado' : 'Pendiente en esta visita'}</b>{can('records.financial') && report.originalCharges?.some(row => String(row.id) === String(item.id)) && <span> · Importe previsto: {collectionMoney(report.originalCharges.find(row => String(row.id) === String(item.id)).amount)}</span>}</li>)}</ul>
    {can('records.financial') && Number(report.originalAmount) > 0 && <small>Importe original de la visita: {collectionMoney(report.originalAmount)}. Es un antecedente; el saldo vigente se consulta en Cobranzas.</small>}
    {report.corrections?.map((entry, index) => <details key={index}><summary>Corrección administrativa · {entry.actor.name} · {new Date(entry.at).toLocaleString('es-AR')}</summary><p>{entry.reason}</p><p>Informe anterior: {entry.previous.technicalStatus || entry.previous.status} · {entry.previous.technicalReportedByName || 'Sin autor registrado'}</p><p>{entry.previous.technicalObservation}</p>{entry.previousResult?.items?.map(item => <p key={item.id}>{item.name}: {item.status === 'completed' ? 'Realizado' : 'Pendiente'}</p>)}{entry.previousResult?.management && <p>Gestión anterior: {entry.previousResult.management.note} · {entry.previousResult.management.byName}</p>}</details>)}
    {report.management ? <p><b>Gestión de pendientes:</b> {report.management.note}<br /><small>{report.management.byName} · {new Date(report.management.at).toLocaleString('es-AR')}</small></p> : report.items.some(item => item.status === 'pending') && <>
      <p>Conservá este informe y coordiná los trabajos pendientes desde el ticket. La gestión no marca esos trabajos como realizados.</p>
      {can('history.edit') && canWriteRecord(record, user) && (managing ? <div className="work-management">
        <label>Cómo se gestionaron los pendientes<textarea rows={2} maxLength={1000} value={note} disabled={saving} onChange={e => setNote(e.target.value)} placeholder="Indicá el ticket o la nueva visita coordinada y su fecha." /></label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" title="Cerrá la gestión sin guardar." disabled={saving} onClick={() => setManaging(false)}>Cancelar</button><button type="button" className="primary" title="Registrá cómo se coordinaron los trabajos pendientes; se conserva el informe original." disabled={saving || !note.trim()} onClick={manage}>{saving ? 'Guardando…' : 'Registrar gestión'}</button></div>
      </div> : <button type="button" className="secondary" title="Dejá constancia de cómo se coordinó el trabajo pendiente." onClick={() => setManaging(true)}>Registrar gestión de pendientes</button>)}
    </>}
  </section> : null
  if (!enabled) return <>{results}{create}</>
  return <>{results}<section ref={root} className={items.length ? 'followup-summary' : ''} aria-label="Tickets del servicio">{create}{items.map(item => <div key={item.id}><strong>{item.displayNumber} · {item.status}</strong><p>{item.title}</p><small>Responsable: {item.assigneeName || 'Sin asignar'}</small><button type="button" className="secondary" title="Consultá la conversación y las gestiones del ticket." onClick={() => window.dispatchEvent(new CustomEvent('open-ticket', { detail: { ticketId: item.id } }))}>Ver ticket</button></div>)}</section></>
}
