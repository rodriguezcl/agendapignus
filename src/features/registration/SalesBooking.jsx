import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { usePermissions } from '../../presentation/contexts/permissions-context.jsx'
import { Confirm } from '../../presentation/components/Confirm.jsx'
import ModuleIntroduction from '../../components/ModuleIntroduction.jsx'
import './sales-booking.css'

const endpoint = '/api/sales/bookings'
const post = input => requestJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
const initial = () => ({ client: '', phone: '', address: '', installationZone: 'docta', estimatedMinutes: 150, date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()), coordinates: null, locationConfirmed: false, detail: '' })
function LocationPicker({ value, onChange }) {
  const root = useRef(null), map = useRef(null), marker = useRef(null), change = useRef(onChange)
  const [error, setError] = useState('')
  change.current = onChange
  useEffect(() => {
    map.current = L.map(root.current, { center: [-31.4167, -64.1833], zoom: 11, scrollWheelZoom: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map.current).on('tileerror', () => setError('No se pudo cargar parte del mapa. Podés ingresar las coordenadas debajo.'))
    map.current.on('click', e => change.current([Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))]))
    const resize = new ResizeObserver(() => map.current?.invalidateSize()); resize.observe(root.current)
    return () => { resize.disconnect(); map.current.remove(); map.current = null }
  }, [])
  useEffect(() => {
    if (marker.current) { marker.current.remove(); marker.current = null }
    if (value?.every(Number.isFinite) && Math.abs(value[0]) <= 85 && Math.abs(value[1]) <= 180) {
      marker.current = L.circleMarker(value, { radius: 10, color: '#fff', weight: 3, fillColor: '#7842d8', fillOpacity: 1 }).addTo(map.current)
      map.current.panTo(value)
    }
  }, [value])
  return <><div ref={root} className="sales-location-map" aria-label="Seleccioná el punto de instalación en el mapa" />{error && <p role="status">{error}</p>}<div className="sales-grid">{['Latitud', 'Longitud'].map((label, index) => <label key={label}>{label}<input inputMode="decimal" type="number" step="any" min={index ? -180 : -85} max={index ? 180 : 85} value={value?.[index] ?? ''} onChange={e => { const next = [...(value || [null, null])]; next[index] = e.target.value === '' ? null : Number(e.target.value); onChange(next) }} /></label>)}</div></>
}
export default function SalesBooking({ onSaved, navigationGuardRef }) {
  const { can } = usePermissions()
  const [draft, setDraft] = useState(initial), [items, setItems] = useState([]), [slots, setSlots] = useState([]), [choice, setChoice] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reason, setReason] = useState(''), [saved, setSaved] = useState(null)
  const requestId = useRef(crypto.randomUUID()), sending = useRef(false), version = useRef(0)
  const [leave, setLeave] = useState(null)
  const dirty = !saved && Boolean(draft.client || draft.phone || draft.address || draft.coordinates || draft.detail)
  useEffect(() => {
    const guard = action => { if (sending.current) { setNotice('Esperá a que termine la operación.'); return }; if (dirty) setLeave(() => action); else action() }
    guard.hasDraft = () => dirty || sending.current
    if (navigationGuardRef) navigationGuardRef.current = guard
    const beforeUnload = event => { if (dirty || sending.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { if (navigationGuardRef?.current === guard) navigationGuardRef.current = null; window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty, navigationGuardRef])
  const load = () => requestJson(endpoint).then(data => setItems(data.items))
  useEffect(() => { let live = true; requestJson(endpoint).then(data => { if (live) setItems(data.items) }).catch(e => { if (live) setError(e.message) }); return () => { live = false } }, [])
  const update = patch => { version.current++; setDraft(old => ({ ...old, ...patch })); setSlots([]); setChoice(''); setReason(''); setError(''); setNotice('') }
  async function search(event) {
    event.preventDefault(); if (sending.current) return
    sending.current = true; setBusy(true); setError(''); setSlots([]); setChoice(''); const expected = version.current
    try { const data = await post({ ...draft, action: 'slots' }); if (expected === version.current) { setSlots(data.slots); setReason(data.reason) } }
    catch (e) { setError(e.message) } finally { sending.current = false; setBusy(false) }
  }
  async function reserve() {
    const selected = slots.find(slot => `${slot.teamId}|${slot.time}` === choice)
    if (!selected || sending.current) return
    sending.current = true; setBusy(true); setError('')
    try {
      const data = await post({ ...draft, action: 'reserve', requestId: requestId.current, teamId: selected.teamId, time: selected.time })
      setSaved(data.reservation); setSlots([]); setChoice(''); setItems(old => [data.reservation, ...old.filter(r => r.id !== data.reservation.id)])
      Promise.resolve().then(() => onSaved?.()).catch(() => setNotice('Reserva guardada. Actualizá la agenda para ver el cambio.'))
      setNotice('Reserva guardada en la agenda. Coordinación debe confirmar la visita. Ya podés compartir el formulario.')
    } catch (e) { setError(e.message); if (e.status === 409) { setSlots([]); setChoice('') } }
    finally { sending.current = false; setBusy(false) }
  }
  async function copy(link) {
    try { await navigator.clipboard.writeText(new URL(link, location.origin).href); setNotice('Enlace copiado.') }
    catch { setNotice('Seleccioná y copiá el enlace del campo.') }
  }
  const linkControls = item => item.link && <div className="sales-link"><input aria-label={`Enlace de ${item.client}`} value={new URL(item.link, location.origin).href} readOnly onFocus={e => e.target.select()} /><button type="button" className="secondary" onClick={() => copy(item.link)}>Copiar enlace</button><a className="secondary" href={item.link} target="_blank" rel="noopener noreferrer">Abrir formulario</a></div>
  const selected = slots.find(slot => `${slot.teamId}|${slot.time}` === choice)
  return <section className="sales-booking">
    {leave && <Confirm title="Salir de la reserva" detail="Los datos que completaste todavía no se guardaron. ¿Querés salir y descartarlos?" confirmLabel="Descartar y salir" action={() => { const action = leave; setLeave(null); action() }} close={() => setLeave(null)} />}
    <ModuleIntroduction><p>Reservá una instalación para revisión de Coordinación. La visita queda A confirmar y ocupa el horario propuesto.</p></ModuleIntroduction>
    {notice && <p className="sales-feedback" role="status">{notice}</p>}{error && <p className="field-error" role="alert">{error}</p>}
    {saved ? <article className="panel sales-panel"><h2>Formulario de {saved.client}</h2><p>Propuesta: {saved.date.split('-').reverse().join('/')} · {saved.time} hs · {saved.team}</p>{linkControls(saved)}<button className="primary" onClick={() => { setSaved(null); setDraft(initial()); requestId.current = crypto.randomUUID(); setNotice('') }}>Crear otra reserva</button></article> : can('sales.reserve') && <form className="panel sales-panel" onSubmit={search}>
      <fieldset disabled={busy}><legend>1. Datos de la instalación</legend><div className="sales-grid">
        <label>Nombre y apellido<input required maxLength={160} autoComplete="section-sale name" value={draft.client} onChange={e => update({ client: e.target.value })} /></label>
        <label>Teléfono de contacto<input required type="tel" maxLength={60} autoComplete="section-sale tel" value={draft.phone} onChange={e => update({ phone: e.target.value })} /></label>
        <label>Tipo de formulario<select value={draft.installationZone} onChange={e => update({ installationZone: e.target.value })}><option value="docta">Docta Urbanización</option><option value="nobu-town">Nobu Town</option><option value="residencial">Residencial</option></select></label>
        <label>Duración estimada de instalación<select value={draft.estimatedMinutes} onChange={e => update({ estimatedMinutes: Number(e.target.value) })}>{Array.from({ length: 45 }, (_, i) => 60 + i * 15).map(n => <option key={n} value={n}>{Math.floor(n / 60)} h {n % 60 ? `${n % 60} min` : ''}</option>)}</select></label>
      </div><label>Dirección completa<input required maxLength={300} autoComplete="section-sale street-address" value={draft.address} onChange={e => update({ address: e.target.value, locationConfirmed: false })} /></label><label>Detalle de la instalación<textarea maxLength={2000} value={draft.detail} onChange={e => update({ detail: e.target.value })} /></label>
      <h3>2. Ubicación</h3><p>Acercá el mapa y tocá el lugar de la instalación. La dirección escrita no mueve el punto automáticamente.</p><LocationPicker value={draft.coordinates} onChange={coordinates => update({ coordinates, locationConfirmed: false })} />
      <label className="sales-check"><input type="checkbox" required checked={draft.locationConfirmed} disabled={!draft.coordinates?.every(Number.isFinite)} onChange={e => update({ locationConfirmed: e.target.checked })} />Confirmé que el punto corresponde a esta dirección.</label>
      <h3>3. Equipo y horario</h3><label>Fecha propuesta<input required type="date" min={initial().date} value={draft.date} onChange={e => update({ date: e.target.value })} /></label><p>Los traslados se estiman por distancia en línea recta con un margen. No contemplan calles ni tránsito. Coordinación revisará la propuesta.</p><button className="secondary" type="submit" disabled={busy}>{busy ? 'Procesando…' : 'Consultar horarios'}</button>
      {reason && <p role="status">{reason}</p>}{slots.length > 0 && <><label>Horarios compatibles según estimación<select required value={choice} onChange={e => setChoice(e.target.value)}><option value="">Seleccionar equipo y horario</option>{slots.map(slot => <option key={`${slot.teamId}|${slot.time}`} value={`${slot.teamId}|${slot.time}`}>{slot.time}–{slot.end} · {slot.teamLabel} · {slot.members.join(' / ')}{slot.reviewLocation ? ' · Revisar ubicación contigua' : ''}</option>)}</select></label>{selected && <div className="sales-feedback"><p>Traslado anterior: {selected.noPrevious ? 'sin visita previa registrada; revisar punto de salida' : selected.beforeMinutes == null ? 'ubicación pendiente de revisión' : `${selected.beforeMinutes} min estimados`}. Traslado siguiente: {selected.noFollowing ? 'sin visita siguiente registrada' : selected.afterMinutes == null ? 'ubicación pendiente de revisión' : `${selected.afterMinutes} min estimados`}.</p><p>El cliente verá la fecha propuesta como pendiente de confirmación. El correo de confirmación se enviará cuando Coordinación confirme y el formulario esté completo.</p></div>}<button type="button" className="primary" disabled={!selected || busy} onClick={reserve}>Reservar a confirmar y generar enlace</button></>}
      </fieldset>
    </form>}
    <section className="panel sales-panel"><div className="sales-heading"><h2>Reservas registradas</h2><button className="secondary" disabled={busy} onClick={() => load().catch(e => setError(e.message))}>Actualizar listado</button></div>{!items.length && <p>Todavía no hay reservas para mostrar.</p>}{items.map(item => <article key={item.id} className="sales-reservation"><strong>{item.client}</strong><p>{item.address}</p><p>{item.date.split('-').reverse().join('/')} · {item.time} hs · {item.team}</p><p><strong>{item.status === 'Cancelado' ? 'Cancelado' : item.awaitingConfirmation ? 'A confirmar por Coordinación' : 'Visita confirmada'}</strong> · Formulario: {item.form === 'Completo' ? 'recibido' : 'pendiente'}</p>{item.reviewLocation && item.awaitingConfirmation && <p>Coordinación debe revisar las ubicaciones de las visitas contiguas.</p>}{linkControls(item)}</article>)}</section>
  </section>
}
