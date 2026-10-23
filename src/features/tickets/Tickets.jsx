import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { usePermissions } from '../../presentation/contexts/permissions-context.jsx'
import useDiscardGuard from '../../components/ui/useDiscardGuard.jsx'
import ModuleIntroduction from '../../components/ModuleIntroduction.jsx'
import Icon from '../../components/ui/Icon.jsx'
import RequiredLabel from '../../presentation/components/forms/RequiredLabel.jsx'
import { submitModalFromEnter } from '../../infrastructure/browser/modal-submit.mjs'
import { automaticTicketSubject, ticketLocalDateTime } from './ticket-ui.mjs'
import TicketSlaSummary, { TicketServiceSchedule } from './TicketSlaSummary.jsx'
import { TICKET_STATES, TICKET_PRIORITIES, TICKET_ORIGINS, TICKET_RESOLUTION_METHODS, ticketNumber, ticketDate, ticketCustomer, ticketAccount, ticketRule, newCommandId, validateTicketFiles, encodeTicketFiles } from './ticket-ui.mjs'
import { prepareTicketCommand } from './ticket-command-retry.mjs'
import './tickets.css'

const get = params => requestJson(`/api/tickets?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null))}`)
const post = payload => requestJson('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
const valueOf = item => String(item?.id ?? '')
const active = items => (items || []).filter(item => item.active !== false)
const useDebounced = (value, delay = 300) => { const [result, setResult] = useState(value); useEffect(() => { const timer = setTimeout(() => setResult(value), delay); return () => clearTimeout(timer) }, [value, delay]); return result }

function TicketDialog({ title, onClose, busy, children, wide = false, inactive = false, restoreFocusTo }) {
  const root = useRef(null), latestClose = useRef(onClose), busyRef = useRef(busy)
  latestClose.current = onClose
  busyRef.current = busy
  useEffect(() => {
    const opener = restoreFocusTo || document.activeElement
    const element = root.current
    element?.focus()
    const trap = event => {
      if (event.defaultPrevented || element?.closest('[inert]')) return
      if (!element?.contains(document.activeElement)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) latestClose.current?.() }
      if (!busyRef.current) submitModalFromEnter(event, element)
      if (event.key !== 'Tab') return
      const controls = [...element.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(item => item.getClientRects().length)
      if (!controls.length) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === element)) { event.preventDefault(); controls.at(-1).focus() }
      else if (!event.shiftKey && (document.activeElement === controls.at(-1) || document.activeElement === element)) { event.preventDefault(); controls[0].focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); if (opener?.isConnected) opener.focus() }
  }, [])
  return <div className="modal-layer tickets-dialog-layer" onClick={event => { if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); if (!busy && !inactive) onClose?.() } }}><section className={`modal tickets-dialog ${wide ? 'tickets-dialog--wide' : ''}`} role="dialog" aria-modal={!inactive} aria-hidden={inactive || undefined} inert={inactive ? '' : undefined} aria-label={title} tabIndex={-1} ref={root}>
    <header className="tickets-dialog-heading"><h2>{title}</h2><button title="Cerrá esta ventana; si hay cambios pendientes, podrás conservarlos o descartarlos." type="button" className="secondary tickets-icon-button modal-dismiss" aria-label={`Cerrar ${title}`} disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></header>{children}
  </section></div>
}

function FilePicker({ files, onChange, disabled }) {
  const [error, setError] = useState('')
  return <div className="tickets-file-picker"><label>Adjuntos <span className="tickets-muted">(opcional)</span><input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => {
    try { const selected = validateTicketFiles([...files, ...event.target.files]); onChange(selected); setError('') } catch (failure) { setError(failure.message) }
    event.target.value = ''
  }} /></label><small>PDF, JPG, PNG o WEBP · hasta 5 archivos, 2 MB por archivo y 2,5 MB en total.</small>
    {error && <p className="field-error" role="alert">{error}</p>}{Boolean(files.length) && <ul>{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button title="Quitá este archivo de los adjuntos pendientes del mensaje." type="button" className="secondary" disabled={disabled} onClick={() => onChange(files.filter((_, at) => at !== index))} aria-label={`Quitar ${file.name}`}>Quitar</button></li>)}</ul>}
  </div>
}

function CategoryFields({ config, value, onChange, disabled, includePriority = false }) {
  const category = config.categories?.find(item => item.id === value.categoryId)
  return <><label>Categoría<select required value={value.categoryId || ''} disabled={disabled} onChange={event => onChange({ categoryId: event.target.value, subcategoryId: '' })}><option value="">Seleccionar categoría</option>{active(config.categories).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    {Boolean(active(category?.subcategories).length) && <label>Subcategoría<select value={value.subcategoryId || ''} disabled={disabled} onChange={event => onChange({ subcategoryId: event.target.value })}><option value="">General</option>{active(category.subcategories).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
    {includePriority && <label>Prioridad<select value={value.priority || 'Media'} disabled={disabled} onChange={event => onChange({ priority: event.target.value })}>{TICKET_PRIORITIES.map(item => <option key={item}>{item}</option>)}</select></label>}
  </>
}

export function DuplicateTicketContent({ ticket, config = {} }) {
  const messages = (ticket.messages || []).filter(message => message.visibility !== 'internal')
  return <div className="tickets-detail"><header><div className="tickets-actions"><span className={`tickets-priority tickets-priority--${ticket.priority?.toLowerCase()}`}>{ticket.priority}</span><span className="tickets-status">{ticket.status}</span></div><h3>{ticket.title}</h3></header>
    <dl className="tickets-facts"><div><dt>Responsable</dt><dd>{ticket.assigneeName || 'Sin asignar'}</dd></div><div><dt>Creado</dt><dd>{ticketDate(ticket.createdAt)}</dd></div>{ticket.categoryId && <div><dt>Categoría</dt><dd>{config.categories?.find(item => item.id === ticket.categoryId)?.name || ticket.categoryId}</dd></div>}{ticket.eventType && <div><dt>Evento</dt><dd>{config.events?.find(item => item.id === ticket.eventType)?.name || ticket.eventType}</dd></div>}{ticket.zone && <div><dt>Zona</dt><dd>{ticket.zone}</dd></div>}</dl>
    {ticket.description && <p className="tickets-text">{ticket.description}</p>}
    <section aria-label="Información pública del caso"><h3>Información y respuestas del caso</h3><ol className="tickets-timeline">{messages.map((message, index) => <li className="tickets-timeline-message" key={message.id || index}><div className="tickets-timeline-heading"><strong>{message.byName || message.authorName || 'Solicitante'}</strong><time>{ticketDate(message.at || message.createdAt)}</time></div><p className="tickets-text">{message.body || message.text}</p></li>)}</ol>{!messages.length && <p className="tickets-muted">Todavía no hay aportes adicionales.</p>}</section>
  </div>
}

function DuplicateTicketReview({ candidate, customerId, serviceId, config, onClose, onSelect, selected, restoreFocusTo }) {
  const [ticket, setTicket] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true; setLoading(true); setError(''); setTicket(null)
    get({ view: 'duplicateDetail', id: candidate.id, customerId, serviceId }).then(data => { if (current) setTicket(data.ticket) }).catch(failure => { if (current) setError(failure.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [candidate.id, customerId, serviceId, retry])
  return <TicketDialog title={`Revisar ${ticketNumber(ticket || candidate)}`} onClose={onClose} restoreFocusTo={restoreFocusTo} wide>
    <p className="tickets-muted">Si es el mismo problema, sumá tu información al caso existente. Si es otro motivo, conservá la solicitud nueva.</p>
    {loading ? <p role="status">Cargando información del caso…</p> : error ? <p role="alert" className="field-error">{error} <button type="button" className="secondary" onClick={() => setRetry(value => value + 1)}>Reintentar</button></p> : ticket && <DuplicateTicketContent ticket={ticket} config={config} />}
    <div className="tickets-form-footer"><button type="button" className="secondary" onClick={onClose}>Volver a la solicitud</button><button type="button" className="primary" disabled={loading || Boolean(error) || !ticket} onClick={() => onSelect(String(candidate.id))}>{selected ? 'Conservar este caso' : 'Es el mismo caso'}</button></div>
  </TicketDialog>
}

function NewTicket({ metadata, initial, onClose, onSaved }) {
  const { can } = usePermissions()
  const [draft, setDraft] = useState(() => ({ scope: 'customer', origin: initial?.serviceId ? 'technical' : 'phone', description: initial?.description || '', categoryId: initial?.categoryId || '', subcategoryId: '', customerId: initial?.customerId || '', eventType: '', zone: '', occurredAt: ticketLocalDateTime(), requesterName: '', requesterEmail: '', serviceId: initial?.serviceId || '' }))
  const initialDraft = useRef(draft)
  const [customer, setCustomer] = useState(initial?.customer || null), [search, setSearch] = useState(''), [customers, setCustomers] = useState([]), [searching, setSearching] = useState(false)
  const [duplicates, setDuplicates] = useState([]), [duplicateToken, setDuplicateToken] = useState(''), [checking, setChecking] = useState(false), [duplicateError, setDuplicateError] = useState('')
  const [checkedAccount, setCheckedAccount] = useState(''), [reviewing, setReviewing] = useState(null), [duplicateRetry, setDuplicateRetry] = useState(0)
  const [decision, setDecision] = useState(''), [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const command = useRef(null), lock = useRef(false), query = useDebounced(search), rule = ticketRule(metadata.config, draft.categoryId, draft.subcategoryId)
  const reviewOpener = useRef(null)
  const accountContext = draft.customerId ? JSON.stringify([String(draft.customerId), String(draft.serviceId)]) : ''
  const accountPending = Boolean(draft.customerId && checkedAccount !== accountContext)
  const patch = changes => { setDraft(previous => ({ ...previous, ...changes })); setError(''); command.current = null }
  const chooseDecision = value => { if (value !== decision) command.current = null; setDecision(value) }
  const changeFiles = value => { command.current = null; setFiles(value) }
  const subjectCategory = metadata.config.categories?.find(item => item.id === draft.categoryId)
  const subject = automaticTicketSubject({ customer, category: subjectCategory, subcategory: subjectCategory?.subcategories?.find(item => item.id === draft.subcategoryId), event: rule.showEvent ? metadata.config.events?.find(item => item.id === draft.eventType) : null, requesterName: draft.requesterName })
  const dirty = Boolean(JSON.stringify(draft) !== JSON.stringify(initialDraft.current) || draft.description || search || files.length)
  const guard = useDiscardGuard({ dirty, busy, onDiscard: onClose, confirmAlways: true, title: 'Cancelar creación del ticket' })
  useEffect(() => {
    if (query.trim().length < 2) { setCustomers([]); setSearching(false); return }
    let cancelled = false; setSearching(true)
    get({ view: 'customers', search: query.trim(), pageSize: 10 }).then(data => { if (!cancelled) { setCustomers(data.items || []); setError('') } }).catch(failure => { if (!cancelled) setError(failure.message) }).finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [query])
  useEffect(() => {
    command.current = null
    setDuplicates([]); setDuplicateToken(''); setDecision(''); setReviewing(null); setCheckedAccount(''); setDuplicateError('')
    if (!draft.customerId) { setChecking(false); return }
    let cancelled = false; setChecking(true)
    get({ view: 'duplicates', customerId: draft.customerId, serviceId: draft.serviceId }).then(data => { if (!cancelled) { setDuplicates(data.candidates || data.tickets || []); setDuplicateToken(data.duplicateToken || ''); setCheckedAccount(accountContext) } }).catch(failure => { if (!cancelled) setDuplicateError(failure.message) }).finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [draft.customerId, draft.serviceId, accountContext, duplicateRetry])
  const selectCustomer = item => { setCustomer(item); setSearch(''); setCustomers([]); patch({ customerId: valueOf(item) }) }
  const clearCustomer = () => { setCustomer(null); patch({ customerId: '' }); setDecision('') }
  const chooseScope = scope => { patch({ scope, origin: scope === 'internal' ? 'internal' : 'phone', customerId: '', categoryId: '', subcategoryId: '' }); setCustomer(null); setDecision(''); setSearch('') }
  const needsCustomer = draft.scope === 'customer' || rule.customerPolicy === 'required'
  const appendTarget = duplicates.find(item => String(item.id) === decision)
  const submit = async event => {
    event.preventDefault()
    if (lock.current || checking || accountPending || duplicateError) return
    if (needsCustomer && !draft.customerId) { setError('Seleccioná el abonado o cliente del reclamo.'); return }
    if (!draft.description.trim()) { setError('Ingresá la observación del caso.'); return }
    if (duplicates.length && !decision) { setError('Revisá los tickets abiertos e indicá si es el mismo caso o uno diferente.'); return }
    lock.current = true; setBusy(true); setError('')
    try {
      const attachments = await encodeTicketFiles(files)
      command.current = await prepareTicketCommand(command.current, { draft, decision, duplicateToken, attachments }, async () => {
        if (appendTarget) {
          const current = await get({ view: 'duplicateDetail', id: appendTarget.id, customerId: draft.customerId, serviceId: draft.serviceId })
          const context = [`Asunto informado: ${subject}`, rule.showEvent && draft.eventType && `Evento: ${metadata.config.events?.find(item => item.id === draft.eventType)?.name || draft.eventType}`, rule.showZone && draft.zone && `Zona: ${draft.zone}`, rule.showEvent && draft.occurredAt && `Fecha del evento: ${ticketDate(draft.occurredAt)}`].filter(Boolean).join('\n')
          return { action: 'contribute', id: current.ticket.id, version: current.ticket.version, customerId: draft.customerId, note: [draft.description.trim(), context].filter(Boolean).join('\n\n'), origin: draft.origin, serviceId: draft.serviceId, attachments, context:{categoryId:draft.categoryId,subcategoryId:draft.subcategoryId,eventId:rule.showEvent ? draft.eventType : '',zone:rule.showZone ? draft.zone : '',occurredAt:rule.showEvent && draft.occurredAt ? new Date(draft.occurredAt).toISOString() : ''} }
        }
        return { action: 'create', ...draft, automaticTitle: true, title: subject, eventType: rule.showEvent ? draft.eventType : '', occurredAt: rule.showEvent && draft.occurredAt ? new Date(draft.occurredAt).toISOString() : undefined, description: draft.description.trim(), allowDuplicate: decision === 'different', duplicateToken, attachments }
      }, newCommandId)
      const result = await post({ ...command.current.payload, commandId: command.current.id })
      onSaved(result.ticket || result, appendTarget ? 'Se agregó la información al caso existente.' : 'Ticket creado.')
    } catch (failure) {
      const collision = failure.payload?.details || failure.payload
      if (failure.status === 409 && (collision?.candidates || collision?.tickets)) { setDuplicates(collision.candidates || collision.tickets); setDuplicateToken(collision.duplicateToken || ''); setDecision(''); command.current = null }
      else if ([404, 409].includes(failure.status)) { setDuplicateRetry(value => value + 1); command.current = null }
      setError(failure.message)
    } finally { lock.current = false; setBusy(false) }
  }
  return <><TicketDialog title="Nuevo ticket" onClose={guard.requestClose} busy={busy} inactive={guard.confirming || Boolean(reviewing && !accountPending)} wide><form onSubmit={submit} className="tickets-form">
    <fieldset className="tickets-kind-picker" disabled={busy}><legend>Tipo de solicitud</legend><label><input type="radio" name="ticket-scope" checked={draft.scope === 'customer'} onChange={() => chooseScope('customer')} />Reclamo de abonado o cliente</label><label><input type="radio" name="ticket-scope" checked={draft.scope === 'internal'} onChange={() => chooseScope('internal')} />Solicitud interna</label></fieldset>
    <div className="tickets-fields"><CategoryFields config={metadata.config} value={draft} onChange={patch} disabled={busy} />{draft.categoryId && <div className="tickets-rule-summary"><span>Prioridad predeterminada</span><strong className={`tickets-priority tickets-priority--${rule.priority?.toLowerCase()}`}>{rule.priority}</strong>{rule.areaId && <small>Área: {metadata.config.areas?.find(item => item.id === rule.areaId)?.name || 'Sin asignar'}</small>}</div>}</div>
    {(rule.customerPolicy !== 'none' || needsCustomer) && <div className="tickets-customer-search">{customer ? <div className="tickets-account-card"><div><strong>{ticketAccount(customer)} {customer.name}</strong><p>{customer.address || 'Domicilio no informado'}</p>{customer.phone && <small>{customer.phone}</small>}</div><button title="Buscá otra cuenta para asociarla a esta solicitud." type="button" className="secondary" disabled={busy} onClick={clearCustomer}>Cambiar cuenta</button></div> : <><label>Abonado o cliente {needsCustomer ? '*' : '(opcional)'}<input type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="Buscar por PIG, CLI, nombre o teléfono" autoComplete="off" /></label>{searching && <p role="status">Buscando cuentas…</p>}{query.trim().length >= 2 && !searching && <div className="tickets-search-results">{customers.map(item => <button title="Seleccioná esta cuenta para completar sus datos y revisar los tickets abiertos." className="secondary" type="button" key={item.id} onClick={() => selectCustomer(item)}><strong>{ticketAccount(item)} · {item.name}</strong><small>{item.address}</small></button>)}{!customers.length && <p>No se encontraron cuentas para esta búsqueda.</p>}</div>}</>}
      {checking && <p role="status">Consultando tickets abiertos de la cuenta…</p>}{duplicateError && <p role="alert" className="field-error">No se pudieron verificar los tickets de la cuenta. {duplicateError} <button type="button" className="secondary" disabled={busy} onClick={() => setDuplicateRetry(value => value + 1)}>Reintentar consulta</button></p>}
      {!accountPending && Boolean(duplicates.length) && <section className="tickets-duplicates" aria-label="Tickets abiertos de esta cuenta"><h3>Esta cuenta tiene {duplicates.length} ticket{duplicates.length === 1 ? '' : 's'} abierto{duplicates.length === 1 ? '' : 's'}</h3><p>Si es el mismo problema, sumá tu información al caso existente. Si es otro motivo, creá una solicitud nueva.</p>{duplicates.map(item => <article key={item.id} className={decision === String(item.id) ? 'is-selected' : ''}><div><strong>{ticketNumber(item)} · {item.title}</strong><small>{item.status} · {item.assigneeName || 'Sin asignar'} · {ticketDate(item.updatedAt || item.createdAt)}</small>{(item.eventType || item.zone) && <small>{item.eventType} {item.zone && `· Zona: ${item.zone}`}</small>}</div><div className="tickets-actions"><button title="Consultá la información pública del ticket antes de decidir si corresponde al mismo caso." type="button" className="secondary" disabled={busy} onClick={event => { reviewOpener.current = event.currentTarget; setReviewing(item) }}>Revisar caso</button>{(can('tickets.create') || can('tickets.fromService')) && <button title="Sumá la observación a este ticket y conservá su número y conversación." type="button" className={decision === String(item.id) ? 'primary' : 'secondary'} disabled={busy} aria-pressed={decision === String(item.id)} onClick={() => chooseDecision(String(item.id))}>Es el mismo caso</button>}</div></article>)}<label className="tickets-checkbox"><input type="checkbox" checked={decision === 'different'} disabled={busy} onChange={event => chooseDecision(event.target.checked ? 'different' : '')} />Es un caso diferente: crear un ticket nuevo</label></section>}
    </div>}
    {draft.scope === 'internal' && <div className="tickets-fields"><label>Solicitante (opcional)<input maxLength={160} value={draft.requesterName} disabled={busy} onChange={event => patch({ requesterName: event.target.value })} placeholder="Si informás el pedido de otra persona" /></label><label>Correo de contacto (opcional)<input type="email" maxLength={254} value={draft.requesterEmail} disabled={busy} onChange={event => patch({ requesterEmail: event.target.value })} /></label></div>}
    <label>Asunto <span className="tickets-muted">(generado automáticamente)</span><textarea readOnly rows={2} value={subject} /></label>
    <div className="tickets-fields">{rule.showEvent && <label>Evento<select value={draft.eventType} disabled={busy} onChange={event => patch({ eventType: event.target.value })}><option value="">No corresponde / sin informar</option>{active(metadata.config.events).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{rule.showZone && <label>Zona (si corresponde)<input maxLength={200} value={draft.zone} disabled={busy} onChange={event => patch({ zone: event.target.value })} placeholder="Ej.: 1 · Puerta de ingreso" /></label>}{rule.showEvent && <label>Fecha y hora del evento (opcional)<input type="datetime-local" value={draft.occurredAt} disabled={busy} onChange={event => patch({ occurredAt: event.target.value })} /></label>}</div>
    <label><RequiredLabel>{appendTarget ? `Información para sumar a ${ticketNumber(appendTarget)}` : 'Observaciones'}</RequiredLabel><textarea required maxLength={10000} value={draft.description} disabled={busy} onChange={event => patch({ description: event.target.value })} placeholder="Describí qué ocurrió y qué gestión se necesita." /></label>
    <FilePicker files={files} onChange={changeFiles} disabled={busy} />
    {error && <p role="alert" className="field-error">{error}</p>}<div className="tickets-form-footer"><button title="Cancelá la carga del ticket; podrás confirmar si querés descartar el borrador." type="button" className="secondary" disabled={busy} onClick={guard.requestClose}>Cancelar</button><button title="Guardá la solicitud o agregá este aporte al caso existente seleccionado." type="submit" className="primary" disabled={busy || checking || accountPending || Boolean(duplicateError) || !draft.categoryId || (needsCustomer && !draft.customerId) || !draft.description.trim() || (duplicates.length > 0 && !decision)}>{busy ? 'Guardando…' : appendTarget ? 'Agregar información al caso' : 'Crear ticket'}</button></div>
  </form></TicketDialog>{reviewing && !accountPending && <DuplicateTicketReview candidate={reviewing} customerId={draft.customerId} serviceId={draft.serviceId} config={metadata.config} restoreFocusTo={reviewOpener.current} onClose={() => setReviewing(null)} selected={decision === String(reviewing.id)} onSelect={id => { chooseDecision(id); setReviewing(null) }} />}{guard.discardDialog}</>
}

export function TicketResolutionFields({ ticket, value, onChange, disabled = false }) {
  const services = Array.isArray(ticket.serviceSchedule) ? ticket.serviceSchedule : ticket.serviceSchedule ? [ticket.serviceSchedule] : []
  const pendingServices = services.filter(service => (!Array.isArray(ticket.resolutionServiceIds) || ticket.resolutionServiceIds.map(String).includes(String(service.id || service.serviceId))) && !['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(service.status))
  return <><label>Medio de resolución *<select value={value} onChange={event => onChange(event.target.value)} required disabled={disabled}><option value="" disabled>Seleccionar medio</option>{Object.entries(TICKET_RESOLUTION_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>Podés resolver el caso por llamada, chat o correo, sin coordinar una visita.</small></label>{pendingServices.length > 0 && <p className="tickets-feedback" role="status">Hay servicios programados pendientes. Cerrar el ticket no los cancela; si la visita ya no es necesaria, actualizá la agenda.</p>}</>
}

function TicketDetail({ id, metadata, onClose, onChanged, onCoordinateService }) {
  const { can } = usePermissions()
  const [ticket, setTicket] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [mode, setMode] = useState('comment'), [note, setNote] = useState(''), [visibility, setVisibility] = useState(can('tickets.internal') ? 'internal' : 'public'), [files, setFiles] = useState([])
  const [resolutionMethod, setResolutionMethod] = useState('')
  const [assignee, setAssignee] = useState(''), [area, setArea] = useState(''), [reviewAt, setReviewAt] = useState(''), [classification, setClassification] = useState({}), [mergeSearch, setMergeSearch] = useState(''), [targets, setTargets] = useState([]), [target, setTarget] = useState(null), [mergeConfirmed, setMergeConfirmed] = useState(false)
  const [linkSearch, setLinkSearch] = useState(''), [linkCustomers, setLinkCustomers] = useState([]), [linkCustomer, setLinkCustomer] = useState(null), [services, setServices] = useState([]), [serviceId, setServiceId] = useState(''), [linkLoading, setLinkLoading] = useState(false)
  const command = useRef(null), lock = useRef(false), query = useDebounced(mergeSearch)
  const customerQuery = useDebounced(linkSearch)
  const load = useCallback(async () => { setLoading(true); try { const data = await get({ id }); setTicket(data.ticket); setAssignee(data.ticket.assigneeId || ''); setArea(data.ticket.areaId || ''); setClassification({ categoryId: data.ticket.categoryId, subcategoryId: data.ticket.subcategoryId || '', priority: data.ticket.priority }); setError(''); post({ action: 'markNotificationsRead', id: data.ticket.id, commandId: newCommandId() }).then(() => window.dispatchEvent(new Event('tickets-changed'))).catch(() => {}) } catch (failure) { setError(failure.message) } finally { setLoading(false) } }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (mode !== 'merge' || query.trim().length < 2) { setTargets([]); return }; let cancelled = false; get({ view: 'list', search: query, status: 'open', pageSize: 10 }).then(data => { if (!cancelled) setTargets((data.items || data.tickets || []).filter(item => String(item.id) !== String(id))) }).catch(failure => { if (!cancelled) setError(failure.message) }); return () => { cancelled = true } }, [query, mode, id])
  useEffect(() => {
    if (mode !== 'linkCustomer' || customerQuery.trim().length < 2) { setLinkCustomers([]); return }
    let cancelled = false; setLinkLoading(true)
    get({ view: 'customers', search: customerQuery, pageSize: 10 }).then(data => { if (!cancelled) setLinkCustomers(data.items || []) }).catch(failure => { if (!cancelled) setError(failure.message) }).finally(() => { if (!cancelled) setLinkLoading(false) })
    return () => { cancelled = true }
  }, [mode, customerQuery])
  useEffect(() => {
    if (mode !== 'linkService') return
    let cancelled = false; setLinkLoading(true)
    get({ view: 'services', customerId: ticket?.customerId, pageSize: 50 }).then(data => { if (!cancelled) setServices(data.items || []) }).catch(failure => { if (!cancelled) setError(failure.message) }).finally(() => { if (!cancelled) setLinkLoading(false) })
    return () => { cancelled = true }
  }, [mode, ticket?.customerId])
  const dirty = Boolean(note || files.length || resolutionMethod || (ticket && (String(assignee) !== String(ticket.assigneeId || '') || area !== (ticket.areaId || '') || classification.categoryId !== ticket.categoryId || classification.subcategoryId !== (ticket.subcategoryId || '') || classification.priority !== ticket.priority)) || target || reviewAt || linkCustomer || serviceId)
  const guard = useDiscardGuard({ dirty, busy, onDiscard: onClose })
  const mailEnabled = metadata.config?.mail?.enabled === true && metadata.config?.mail?.outboundEnabled === true && ticket?.mailMode !== 'test'
  const merged = Boolean(ticket?.mergedIntoId || ticket?.mergedInto || ticket?.status === 'Fusionado')
  const run = async event => {
    event.preventDefault()
    if (!ticket || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const attachments = await encodeTicketFiles(files)
      const payload = { action: mode, id: ticket.id, version: ticket.version, note: note.trim() }
      if (mode === 'resolve') {
        if (!Object.hasOwn(TICKET_RESOLUTION_METHODS, resolutionMethod)) throw new Error('Seleccioná cómo se resolvió el caso.')
        payload.resolutionMethod = resolutionMethod
      }
      if (mode === 'comment') Object.assign(payload, { visibility, attachments })
      if (mode === 'reply') Object.assign(payload, { attachments })
      if (mode === 'assign') Object.assign(payload, { assigneeId: assignee, areaId: area })
      if (mode === 'classify') Object.assign(payload, classification, { reason: note.trim() })
      if (mode === 'wait') payload.nextReviewAt = reviewAt ? new Date(reviewAt).toISOString() : null
      if (mode === 'linkCustomer') payload.customerId = linkCustomer?.id || linkCustomer?.customerId
      if (mode === 'linkService') payload.serviceId = serviceId
      if (mode === 'merge') {
        if (!target || !mergeConfirmed) throw new Error('Seleccioná el ticket principal y confirmá la fusión.')
        const latest = await get({ id: target.id })
        Object.assign(payload, { targetId: latest.ticket.id, targetVersion: latest.ticket.version })
      }
      const fingerprint = JSON.stringify(payload)
      if (command.current?.fingerprint !== fingerprint) command.current = { fingerprint, id: newCommandId() }
      await post({ ...payload, commandId: command.current.id })
      onChanged?.(mode === 'reply' ? 'La respuesta quedó en cola de envío. Podés consultar su estado en la conversación del ticket.' : 'Gestión registrada.')
      onClose()
    } catch (failure) { setError(failure.message) } finally { lock.current = false; setBusy(false) }
  }
  const modeOptions = [can('tickets.comment') && ['comment', 'Agregar observación'], can('tickets.reply') && ['reply', 'Responder al cliente'], can('tickets.assign') && ['assign', 'Asignar responsable'], can('tickets.classify') && ['classify', 'Clasificar / priorizar'], can('tickets.classify') && ['linkCustomer', 'Vincular cuenta de abonado o cliente'], can('tickets.linkService') && ['linkService', 'Vincular servicio existente'], can('tickets.assign') && ticket?.status !== 'Resuelto' && ['wait', 'Poner en espera'], can('tickets.assign') && ticket?.status === 'En espera' && ['resume', 'Retomar gestión'], can('tickets.resolve') && ticket?.status !== 'Resuelto' && ['resolve', 'Resolver y cerrar'], can('tickets.reopen') && ticket?.status === 'Resuelto' && ['reopen', 'Reabrir'], can('tickets.merge') && ['merge', 'Fusionar con otro ticket']].filter(Boolean).filter(([key]) => ticket?.status !== 'Resuelto' || ['reopen', 'merge'].includes(key))
  const needsNote = ['comment', 'reply', 'classify', 'wait', 'resolve', 'reopen', 'merge', 'linkCustomer'].includes(mode)
  const selectableAssignees = metadata.assignees || []
  const events = useMemo(() => [...(ticket?.messages || []).map(item => ({ ...item, timelineType: 'message' })), ...(ticket?.events || []).map(item => ({ ...item, timelineType: 'event' }))].sort((a, b) => String(a.at || a.createdAt || '').localeCompare(String(b.at || b.createdAt || ''))), [ticket])
  const labels = { create: 'Ticket creado', comment: 'Observación agregada', assign: 'Asignación', classify: 'Clasificación actualizada', wait: 'En espera', resume: 'Gestión retomada', resolve: 'Resuelto', reopen: 'Reabierto', merge: 'Tickets fusionados', reply: 'Respuesta por correo', linkService: 'Servicio vinculado', importFollowup: 'Seguimiento incorporado' }
  return <><TicketDialog title={ticket ? ticketNumber(ticket) : 'Detalle del ticket'} onClose={guard.requestClose} busy={busy} wide>{error && <p className="field-error" role="alert">{error} {<button title="Consultá la última versión del ticket conservando el texto y los archivos pendientes." type="button" className="secondary" onClick={load} disabled={busy}>{dirty ? 'Actualizar conservando texto y adjuntos' : 'Actualizar'}</button>}</p>}{loading ? <p role="status">Cargando ticket…</p> : ticket && <div className="tickets-detail">
    <header><div className="tickets-actions"><span className={`tickets-priority tickets-priority--${ticket.priority?.toLowerCase()}`}>{ticket.priority}</span><span className="tickets-status">{ticket.status}</span></div><h3>{ticket.title}</h3>{ticket.mailMode === 'test' && <small>Correo de prueba</small>}{ticket.mailReviewRequired && <p className="tickets-feedback">Este correo requiere revisar el mensaje original en el buzón. El detalle indica el motivo.</p>}<p>{ticketCustomer(ticket)}{ticket.customerSnapshot?.account && ` · ${ticket.customerSnapshot.account}`}</p></header>
    <dl className="tickets-facts"><div><dt>Origen</dt><dd>{TICKET_ORIGINS[ticket.origin] || (ticket.origin === 'technical' ? 'Informe técnico' : ticket.origin)}</dd></div><div><dt>Responsable</dt><dd>{ticket.assigneeName || selectableAssignees.find(item => String(item.id) === String(ticket.assigneeId))?.name || 'Sin asignar'}</dd></div><div><dt>Área</dt><dd>{metadata.config.areas?.find(item => item.id === ticket.areaId)?.name || 'Sin asignar'}</dd></div><div><dt>Creado</dt><dd>{ticketDate(ticket.createdAt)}</dd></div>{ticket.eventType && <div><dt>Evento</dt><dd>{metadata.config.events?.find(item => item.id === ticket.eventType)?.name || ticket.eventType}</dd></div>}{ticket.zone && <div><dt>Zona</dt><dd>{ticket.zone}</dd></div>}{ticket.nextReviewAt && <div><dt>Próxima revisión</dt><dd>{ticketDate(ticket.nextReviewAt)}</dd></div>}</dl>
    {ticket.customerSnapshot?.address && <p><b>Domicilio:</b> {ticket.customerSnapshot.address}{ticket.customerSnapshot.phone && ` · ${ticket.customerSnapshot.phone}`}</p>}
    <TicketSlaSummary summary={ticket.slaSummary} />
    <TicketServiceSchedule ticket={ticket} />
    {ticket.status === 'Resuelto' && TICKET_RESOLUTION_METHODS[ticket.resolutionMethod] && <p className="tickets-feedback"><b>Medio de resolución:</b> {TICKET_RESOLUTION_METHODS[ticket.resolutionMethod]}</p>}
    {ticket.description && !ticket.messages?.length && <p className="tickets-text">{ticket.description}</p>}
    {Boolean(ticket.aliases?.length) && <p className="tickets-muted">Referencias conservadas: {ticket.aliases.map(item => typeof item === 'object' ? ticketNumber(item) : String(item).startsWith('Ticket#') ? item : `Ticket#${item}`).join(', ')}</p>}
    {Boolean(ticket.serviceIds?.length) && <p className="tickets-muted">{ticket.serviceIds.length} servicio{ticket.serviceIds.length === 1 ? '' : 's'} vinculado{ticket.serviceIds.length === 1 ? '' : 's'}</p>}
    {onCoordinateService && can('tickets.linkService') && can('planning.create') && can('weekly.view') && !merged && ticket.status !== 'Resuelto' && <button title="Abrí la agenda semanal para coordinar una visita relacionada con este caso." type="button" className="secondary" disabled={busy} onClick={() => guard.requestClose(() => onCoordinateService(ticket))}>Coordinar servicio en la agenda</button>}
    {merged && <p className="tickets-feedback">Este ticket se fusionó con otro caso. Sus referencias e información se conservan.</p>}
    <section aria-label="Cronología del ticket"><h3>Conversación y gestiones</h3><ol className="tickets-timeline">{events.map((item, index) => <li key={`${item.timelineType}-${item.id || index}`} className={`tickets-timeline-${item.timelineType}`}><div className="tickets-timeline-heading"><strong>{item.byName || item.authorName || item.createdByName || 'Sistema'}</strong><time>{ticketDate(item.at || item.createdAt)}</time><span>{item.timelineType === 'message' ? item.visibility === 'internal' ? 'Nota interna' : item.channel === 'email' ? 'Correo' : 'Información del caso' : labels[item.action || item.type] || item.label || 'Gestión registrada'}</span></div>{(item.body || item.note || item.text) && <p className="tickets-text">{item.body || item.note || item.text}</p>}{item.truncated && <small>Mensaje extenso: se muestra el contenido hasta el límite admitido.</small>}{(item.deliveryStatus || item.sendStatus) && <small>Envío: {({ queued: 'Pendiente', sent: 'Enviado', failed: 'Error de envío', sending: 'Enviando', retry: 'Reintento pendiente', uncertain: 'Entrega por verificar' })[item.deliveryStatus || item.sendStatus] || item.deliveryStatus || item.sendStatus}</small>}{Boolean(item.attachments?.length) && <ul className="tickets-attachment-links">{item.attachments.map(file => <li key={file.id}><a href={`/api/tickets/attachments?${new URLSearchParams({ id: ticket.id, attachmentId: file.id })}`} target="_blank" rel="noreferrer">{file.fileName || file.name || 'Adjunto'}</a></li>)}</ul>}</li>)}</ol>{!events.length && <p className="tickets-muted">Todavía no se registraron gestiones.</p>}</section>
    {!merged && Boolean(modeOptions.length) && <form className="tickets-management" onSubmit={run}><h3>Registrar gestión</h3><label>Acción<select value={modeOptions.some(([key]) => key === mode) ? mode : ''} disabled={busy} onChange={event => setMode(event.target.value)}><option value="" disabled>Seleccionar acción</option>{modeOptions.map(([key, label]) => <option key={key} value={key} disabled={key === 'reply' && !mailEnabled}>{label}{key === 'reply' && !mailEnabled ? ' · correo no habilitado' : ''}</option>)}</select></label>
      {mode === 'comment' && can('tickets.internal') && <label>Visibilidad<select value={visibility} disabled={busy} onChange={event => setVisibility(event.target.value)}><option value="internal">Nota interna · sólo equipo autorizado</option><option value="public">Información visible para el solicitante</option></select><small>Agregar una observación no envía un correo.</small></label>}
      {mode === 'resolve' && !ticket.assigneeId && <p className="tickets-feedback">Se te asignará como responsable al cerrar este ticket.</p>}
      {mode === 'resolve' && <TicketResolutionFields ticket={ticket} value={resolutionMethod} onChange={setResolutionMethod} disabled={busy} />}
      {mode === 'reply' && <p className="tickets-feedback">Se enviará al correo de contacto del ticket: {ticket.requesterEmail || ticket.requester?.email || 'No informado'}. Revisá el destinatario antes de enviar.</p>}
      {mode === 'assign' && <div className="tickets-fields"><label>Área<select value={area} disabled={busy} onChange={event => { setArea(event.target.value); setAssignee('') }}><option value="">Sin área</option>{active(metadata.config.areas).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Responsable<select value={assignee} disabled={busy} onChange={event => setAssignee(event.target.value)}><option value="">Sin asignar</option>{selectableAssignees.filter(person => !area || !metadata.config.areas?.find(item => item.id === area)?.memberIds?.length || metadata.config.areas.find(item => item.id === area).memberIds.map(String).includes(String(person.id))).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>}
      {mode === 'classify' && <div className="tickets-fields"><CategoryFields config={metadata.config} value={classification} disabled={busy} includePriority onChange={changes => setClassification(previous => { const next = { ...previous, ...changes }; return changes.categoryId || Object.hasOwn(changes, 'subcategoryId') ? { ...next, priority: ticketRule(metadata.config, next.categoryId, next.subcategoryId).priority } : next })} /></div>}
      {mode === 'wait' && <label>Próxima revisión (opcional)<input type="datetime-local" value={reviewAt} disabled={busy} onChange={event => setReviewAt(event.target.value)} /></label>}
      {mode === 'linkCustomer' && <div className="tickets-merge"><label>Buscar cuenta<input type="search" value={linkSearch} disabled={busy} onChange={event => { setLinkSearch(event.target.value); setLinkCustomer(null) }} placeholder="PIG, CLI, nombre o teléfono" /></label>{linkLoading && <p role="status">Buscando cuentas…</p>}<div className="tickets-search-results">{linkCustomers.map(item => <button title="Seleccioná esta cuenta para vincularla al ticket y conservar sus gestiones." key={item.id} type="button" className={linkCustomer?.id === item.id ? 'primary' : 'secondary'} disabled={busy} onClick={() => setLinkCustomer(item)}>{ticketAccount(item)} · {item.name}</button>)}</div>{linkCustomer && <p className="tickets-feedback">Se vinculará con {ticketAccount(linkCustomer)} · {linkCustomer.name}. Las observaciones y el historial se conservarán.</p>}</div>}
      {mode === 'linkService' && <label>Servicio existente<select value={serviceId} disabled={busy || linkLoading} onChange={event => setServiceId(event.target.value)}><option value="">{linkLoading ? 'Buscando servicios…' : 'Seleccionar servicio'}</option>{services.filter(item => !(ticket.serviceIds || []).map(String).includes(String(item.id))).map(item => <option key={item.id} value={item.id}>{item.label || item.service || item.client} {item.date && `· ${item.date.split('-').reverse().join('/')}`}</option>)}</select>{!linkLoading && !services.length && <small>No hay servicios disponibles dentro de tu alcance.</small>}</label>}
      {mode === 'merge' && <div className="tickets-merge"><label>Buscar el ticket que conservará el caso<input type="search" value={mergeSearch} disabled={busy} onChange={event => { setMergeSearch(event.target.value); setTarget(null); setMergeConfirmed(false) }} placeholder="Número, asunto o cliente" /></label><div className="tickets-search-results">{targets.map(item => <button title="Seleccioná el ticket principal que conservará los aportes de ambos casos." className={target?.id === item.id ? 'primary' : 'secondary'} key={item.id} type="button" disabled={busy} onClick={() => { setTarget(item); setMergeConfirmed(false) }}>{ticketNumber(item)} · {item.title} · {ticketCustomer(item)}</button>)}</div>{target && <label className="tickets-checkbox"><input type="checkbox" checked={mergeConfirmed} disabled={busy} onChange={event => setMergeConfirmed(event.target.checked)} />Confirmo que es el mismo caso. {ticketNumber(target)} será el principal y conservará los aportes de ambos tickets.</label>}</div>}
      <label>{mode === 'resolve' ? 'Resultado del cierre' : mode === 'wait' ? 'Motivo de la espera' : ['classify', 'reopen', 'merge'].includes(mode) ? 'Motivo de la gestión' : mode === 'reply' ? 'Respuesta al cliente' : 'Observación'}{needsNote ? ' *' : ' (opcional)'}<textarea value={note} maxLength={10000} required={needsNote} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
      {['comment', 'reply'].includes(mode) && <FilePicker files={files} onChange={setFiles} disabled={busy} />}
      {mode === 'reply' && metadata.config?.mail?.signatureEnabled && <p className="tickets-muted">Se agregará la firma común del correo de soporte al final de esta respuesta.</p>}
      <div className="tickets-form-footer"><button title="Guardá la gestión elegida con su observación y los datos indicados." type="submit" className={mode === 'merge' ? 'danger-button' : 'primary'} disabled={busy || !modeOptions.some(([key]) => key === mode) || (needsNote && !note.trim()) || (mode === 'resolve' && !resolutionMethod) || (mode === 'merge' && (!target || !mergeConfirmed)) || (mode === 'linkCustomer' && !linkCustomer) || (mode === 'linkService' && !serviceId) || (mode === 'reply' && (!mailEnabled || !(ticket.requesterEmail || ticket.requester?.email)))}>{busy ? 'Guardando…' : mode === 'reply' ? 'Enviar respuesta al cliente' : mode === 'merge' ? 'Confirmar fusión' : mode === 'resolve' ? 'Resolver y cerrar' : 'Guardar gestión'}</button></div>
    </form>}
  </div>}</TicketDialog>{guard.discardDialog}</>
}

export default function Tickets({ openRequest, onChanged, onCoordinateService }) {
  const { can } = usePermissions()
  const [metadata, setMetadata] = useState(null), [data, setData] = useState({ items: [], total: 0, counts: {} }), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [status, setStatus] = useState('Nuevo'), [search, setSearch] = useState(''), [priority, setPriority] = useState(''), [origin, setOrigin] = useState(''), [assignee, setAssignee] = useState(''), [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false), [initial, setInitial] = useState(null), [selected, setSelected] = useState(null), [revision, setRevision] = useState(0)
  const query = useDebounced(search), lastRequest = useRef(null)
  useEffect(() => { if (!can('tickets.view')) return; let cancelled = false; get({ view: 'metadata' }).then(result => { if (!cancelled) setMetadata(result) }).catch(failure => { if (!cancelled) setError(failure.message) }); return () => { cancelled = true } }, [can])
  useEffect(() => {
    if (!can('tickets.view')) return
    let cancelled = false; setLoading(true)
    get({ view: 'list', status, search: query, priority, origin, assigneeId: assignee, page, pageSize: 20 }).then(result => { if (!cancelled) { setData({ ...result, items: result.items || result.tickets || [] }); setError('') } }).catch(failure => { if (!cancelled) { if ([401, 403].includes(failure.status)) setData({ items: [], total: 0, counts: {} }); setError(failure.message) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [status, query, priority, origin, assignee, page, revision, can])
  useEffect(() => { setPage(1) }, [status, query, priority, origin, assignee])
  useEffect(() => { if (!openRequest || lastRequest.current === openRequest) return; lastRequest.current = openRequest; if (openRequest.id || openRequest.ticketId) setSelected(String(openRequest.id || openRequest.ticketId)); else if (openRequest.create || openRequest.serviceId) { setInitial(openRequest); setCreating(true) } }, [openRequest])
  useEffect(() => { const refresh = () => { if (!document.hidden && !creating && !selected) setRevision(value => value + 1) }; const timer = setInterval(refresh, 60000); window.addEventListener('focus', refresh); return () => { clearInterval(timer); window.removeEventListener('focus', refresh) } }, [creating, selected])
  const changed = message => { if (message) setNotice(message); window.dispatchEvent(new Event('tickets-changed')); setRevision(value => value + 1); onChanged?.() }
  if (!can('tickets.view')) return <p className="empty-state">No tenés permiso para consultar tickets.</p>
  return <div className="tickets-page"><ModuleIntroduction><p className="eyebrow">OPERACIÓN</p><h1>Tickets</h1><p>Reclamos, solicitudes y gestiones en un mismo lugar.</p></ModuleIntroduction>
    <div className="tickets-topbar"><div className="tickets-tabs" role="group" aria-label="Estado de los tickets">{TICKET_STATES.map(value => <button title="Filtrá la bandeja para consultar los tickets del estado seleccionado." type="button" key={value} className={status === value ? 'primary' : 'secondary'} aria-pressed={status === value} onClick={() => setStatus(value)}>{value === 'Nuevo' ? 'Nuevos' : value === 'Resuelto' ? 'Resueltos' : value}{data.counts?.[value] !== undefined && ` (${data.counts[value]})`}</button>)}</div>{can('tickets.create') && <button title="Abrí el formulario para registrar un reclamo o una solicitud interna." type="button" className="primary" disabled={!metadata} onClick={() => { setInitial(null); setCreating(true); setNotice('') }}><Icon name="plus" size={17} />Nuevo ticket</button>}</div>
    <div className="tickets-filters"><label>Buscar<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Número de ticket, cliente o asunto" /></label><label>Prioridad<select value={priority} onChange={event => setPriority(event.target.value)}><option value="">Todas</option>{TICKET_PRIORITIES.map(item => <option key={item}>{item}</option>)}</select></label><label>Origen<select value={origin} onChange={event => setOrigin(event.target.value)}><option value="">Todos</option><option value="phone">Llamadas</option><option value="internal">Solicitudes internas</option><option value="technical">Solicitudes de técnicos</option><option value="email">Correo</option></select></label><label>Responsable<select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">Todos los autorizados</option><option value="me">Asignados a mí</option><option value="unassigned">Sin asignar</option>{metadata?.assignees?.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
    {error && <p role="alert" className="field-error">{error} <button title="Volvé a consultar los tickets y la configuración necesarios para esta pantalla." className="secondary" type="button" onClick={() => { if (!metadata) get({ view: 'metadata' }).then(setMetadata).catch(failure => setError(failure.message)); setRevision(value => value + 1) }}>Reintentar</button></p>}{notice && <p role="status" className="tickets-feedback">{notice}</p>}
    <section className="data-card tickets-results" aria-label="Listado de tickets" aria-busy={loading}>{loading ? <p className="empty-state" role="status">Cargando tickets…</p> : !data.items.length ? <p className="empty-state">No hay tickets para estos filtros.</p> : <><div className="tickets-table-wrapper"><table><thead><tr><th>Ticket y solicitud</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Última actividad</th><th><span className="tickets-sr-only">Acciones</span></th></tr></thead><tbody>{data.items.map(ticket => <tr key={ticket.id}><td><button title="Abrí el ticket para consultar su conversación, adjuntos y gestiones." className="tickets-ticket-link" type="button" onClick={() => setSelected(String(ticket.id))}>{ticketNumber(ticket)} · {ticket.title}</button><small>{ticketCustomer(ticket)}</small><small>{TICKET_ORIGINS[ticket.origin] || (ticket.origin === 'technical' ? 'Informe técnico' : ticket.origin)}</small></td><td><span className={`tickets-priority tickets-priority--${ticket.priority?.toLowerCase()}`}>{ticket.priority}</span><TicketSlaSummary summary={ticket.slaSummary} compact /></td><td>{ticket.status}<TicketServiceSchedule ticket={ticket} compact /></td><td>{ticket.assigneeName || metadata?.assignees?.find(item => String(item.id) === String(ticket.assigneeId))?.name || 'Sin asignar'}</td><td>{ticketDate(ticket.updatedAt || ticket.createdAt)}</td><td><button title="Consultá el detalle del ticket y las acciones habilitadas para tu rol." type="button" className="secondary" onClick={() => setSelected(String(ticket.id))} aria-label={`Ver ${ticketNumber(ticket)}`}>Ver</button></td></tr>)}</tbody></table></div><footer className="tickets-pagination"><span>{data.total} ticket{data.total === 1 ? '' : 's'} · página {page} de {Math.max(1, Math.ceil(data.total / (data.pageSize || 20)))}</span><div className="tickets-actions"><button title="Mostrá la página anterior conservando los filtros de la bandeja." type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button><button title="Mostrá la página siguiente conservando los filtros de la bandeja." type="button" className="secondary" disabled={page * (data.pageSize || 20) >= data.total} onClick={() => setPage(value => value + 1)}>Siguiente</button></div></footer></>}
    </section>
    {creating && metadata && <NewTicket metadata={metadata} initial={initial} onClose={() => setCreating(false)} onSaved={(ticket, message) => { setCreating(false); setNotice(message); if (ticket?.id) setSelected(String(ticket.id)); changed() }} />}
    {selected && metadata && <TicketDetail key={selected} id={selected} metadata={metadata} onClose={() => setSelected(null)} onChanged={changed} onCoordinateService={onCoordinateService} />}
  </div>
}
