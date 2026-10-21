import React, { useCallback, useEffect, useRef, useState } from 'react'
import { usePermissions } from '../../presentation/contexts/permissions-context.jsx'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import ModuleIntroduction from '../../components/ModuleIntroduction.jsx'
import './followups.css'

const types = ['Cotizar adicional', 'Coordinar visita', 'Gestionar problema', 'Otra acción']
export default function Followups({ openRequest, onChanged }) {
  const { can } = usePermissions()
  const [cases, setCases] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [status, setStatus] = useState('Pendiente'), [search, setSearch] = useState(''), [type, setType] = useState(''), [responsible, setResponsible] = useState('')
  const [selected, setSelected] = useState(null), [note, setNote] = useState(''), [assignee, setAssignee] = useState(''), [busy, setBusy] = useState(false)
  const lock = useRef(false), command = useRef(null), detail = useRef(null)
  const reload = useCallback(async () => {
    try { const data = await requestJson('/api/followups'); setCases(data.cases); setError('') }
    catch (error) { if ([401, 403].includes(error.status)) setCases([]); setError(error.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { reload(); const refresh = () => { if (!document.hidden && !lock.current) reload() }; const timer = setInterval(refresh, 30000); window.addEventListener('focus', refresh); return () => { clearInterval(timer); window.removeEventListener('focus', refresh) } }, [reload])
  useEffect(() => { if (openRequest?.recordId) { setSelected(String(openRequest.recordId)); setNote(''); setAssignee('') } }, [openRequest])
  const current = cases.find(item => String(item.recordId) === selected)
  useEffect(() => { if (current) detail.current?.focus() }, [selected, Boolean(current)])
  const manage = async action => {
    if (!current || lock.current) return
    lock.current = true; setBusy(true); setError('')
    const payload = { recordId: current.recordId, version: current.followup.version, action, note, assigneeId: assignee }
    const key = JSON.stringify(payload)
    if (command.current?.key !== key) command.current = { key, id: globalThis.crypto?.randomUUID?.() || `followup-${Date.now()}-${Math.random().toString(36).slice(2)}` }
    try {
      await requestJson('/api/followups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, commandId: command.current.id }) })
      setNote(''); command.current = null; if (action === 'assign') setStatus('En gestión'); if (action === 'resolve') setStatus('Resuelto'); await reload(); await onChanged?.()
    } catch (error) { setError(error.message) } finally { lock.current = false; setBusy(false) }
  }
  const query = search.trim().toLocaleLowerCase('es-AR')
  const filtered = cases.filter(item => item.followup.status === status && (!type || item.followup.type === type) && (!responsible || (responsible === 'unassigned' ? !item.followup.assigneeId : String(item.followup.assigneeId) === responsible)) && (!query || `${item.client} ${item.followup.description} ${item.followup.createdByName}`.toLocaleLowerCase('es-AR').includes(query)))
  const owners = [...new Map(cases.filter(item => item.followup.assigneeId).map(item => [String(item.followup.assigneeId), item.followup.assigneeName])).entries()]
  if (!can('followups.view')) return <p>No tenés permiso para consultar seguimientos.</p>
  return <div className="followups-page"><ModuleIntroduction><p className="eyebrow">OPERACIÓN</p><h1>Seguimientos</h1><p>Acciones solicitadas por técnicos, responsables y resultados.</p></ModuleIntroduction>
    {error && <p role="alert" className="field-error">{error} <button type="button" className="secondary" disabled={busy} onClick={reload}>Actualizar casos</button></p>}
    <div className="followups-toolbar"><div className="followups-tabs" role="group" aria-label="Estado de los casos">{['Pendiente', 'En gestión', 'Resuelto'].map(value => <button type="button" key={value} className={status === value ? 'primary' : 'secondary'} aria-pressed={status === value} onClick={() => setStatus(value)}>{value === 'Pendiente' ? 'Pendientes' : value === 'Resuelto' ? 'Resueltos' : value} ({cases.filter(item => item.followup.status === value).length})</button>)}</div>
    <div className="followups-filters"><label>Buscar<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cliente, acción o técnico" /></label><label>Tipo<select value={type} onChange={event => setType(event.target.value)}><option value="">Todos</option>{types.map(value => <option key={value}>{value}</option>)}</select></label><label>Responsable<select value={responsible} onChange={event => setResponsible(event.target.value)}><option value="">Todos</option><option value="unassigned">Sin asignar</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
    </div>
    {loading ? <p role="status">Cargando seguimientos…</p> : <div className="followups-list">{filtered.sort((a, b) => a.followup.createdAt.localeCompare(b.followup.createdAt)).map(item => <article className="data-card" key={item.recordId}><h2>{item.client || 'Cliente del servicio'}</h2><b>{item.followup.type}</b><p>{item.followup.description}</p><small>{item.followup.createdByName} · {new Date(item.followup.createdAt).toLocaleDateString('es-AR')} · {Math.max(0, Math.floor((Date.now() - Date.parse(item.followup.createdAt)) / 86400000))} días desde la solicitud</small><p>Responsable: {item.followup.assigneeName || 'Sin asignar'}</p><button type="button" className="secondary" disabled={busy} onClick={() => { setSelected(String(item.recordId)); setNote(''); setAssignee(''); command.current = null }}>Ver seguimiento</button></article>)}{!filtered.length && <p className="empty-state">No hay casos para estos filtros.</p>}</div>}
    {current && <section className="data-card followup-detail" ref={detail} tabIndex={-1} aria-label="Detalle del seguimiento"><button type="button" className="secondary" disabled={busy} onClick={() => setSelected(null)}>Cerrar detalle</button><h2>{current.client} · {current.followup.status}</h2><p><b>Servicio de origen:</b> {current.service} · {current.date?.split('-').reverse().join('/')}</p><p><b>Informe técnico:</b> {current.technicalObservation || 'Sin observación'}</p><p><b>Acción solicitada:</b> {current.followup.type} · {current.followup.description}</p><p>Responsable: {current.followup.assigneeName || 'Sin asignar'}</p><h3>Cronología de gestiones</h3><ol>{current.followup.events.map((event, index) => <li key={index}><b>{event.action}</b> · {event.byName} · {new Date(event.at).toLocaleString('es-AR')}<p>{event.note}</p></li>)}</ol>
      {current.writable && current.followup.status !== 'Resuelto' && <div className="followup-management">{can('followups.assign') && <label>Asignar responsable<select value={assignee} onChange={event => setAssignee(event.target.value)} disabled={busy}><option value="">Tomar el caso (yo)</option>{current.assignees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}{(can('followups.assign') || can('followups.resolve')) && <label>Avance o resultado<textarea maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="Indicá qué gestión se realizó. Obligatorio para resolver." /></label>}<div className="followups-tabs">{can('followups.assign') && <><button className="secondary" disabled={busy} onClick={() => manage('assign')}>Tomar / asignar</button><button className="secondary" disabled={busy || !note.trim()} onClick={() => manage('note')}>Registrar avance</button></>}{can('followups.resolve') && <button className="primary" disabled={busy || !note.trim() || !current.followup.assigneeId} onClick={() => manage('resolve')}>{busy ? 'Guardando…' : 'Resolver caso'}</button>}</div></div>}
    </section>}
  </div>
}
