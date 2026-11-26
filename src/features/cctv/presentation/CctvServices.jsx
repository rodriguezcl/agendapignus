import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import ModuleIntroduction from '../../../components/ModuleIntroduction.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import CctvRequirementSelect from '../../../components/CctvRequirementSelect.jsx'
import { ticketAuthorColors } from '../../tickets/ticket-author-colors.mjs'
import { normalizeSearchText } from '../../../domain/shared/normalization.mjs'
import { cctvRepository, createCctvCommandSession, cctvAttachmentUrl, encodeCctvFile } from '../../../infrastructure/repositories/cctv-repository.mjs'
import PlanimetryEditor from './PlanimetryEditor.jsx'
import EquipmentEditor from './EquipmentEditor.jsx'
import CctvAccountTickets from './CctvAccountTickets.jsx'
import './cctv.css'

const TABS = {
  general: {
    label: 'Datos generales',
    description: 'Acá se consultan la dirección, los datos de contacto y el historial de la cuenta, y se actualiza el requerimiento de CCTV.'
  },
  news: {
    label: 'Novedades',
    description: 'Acá se registran las novedades de la cuenta y se adjuntan los informes en PDF. Podés buscarlos por fecha.'
  },
  maintenance: {
    label: 'Poda y mantenimiento',
    description: 'Acá se anotan las tareas de poda y mantenimiento, por ejemplo, si hay ramas que tapan una cámara. También se indica la fecha de la próxima revisión.'
  },
  plans: {
    label: 'Planimetría',
    description: 'La ubicación de las cámaras se documenta con un dibujo o un croquis en imagen o PDF. Cada versión del plano queda guardada.'
  },
  improvements: {
    label: 'Mejoras',
    description: 'Acá se proponen mejoras para la cuenta, se indica su prioridad y se marcan las que ya se realizaron.'
  },
  equipment: {
    label: 'Ficha técnica',
    description: 'Inventario de cámaras, grabadores, alarmas, barreras infrarrojas y cercos eléctricos instalados, con la marca, el modelo y las características de cada equipo.'
  },
  tickets: {
    label: 'Tickets',
    description: 'Acá se da seguimiento a los reclamos y solicitudes de la cuenta. Los tickets creados desde esta ficha quedan vinculados automáticamente.'
  }
}
const ACTION_LABELS = { addNews: 'Novedad registrada', saveMaintenance: 'Mantenimiento actualizado', addPlan: 'Plano incorporado', addImprovement: 'Mejora propuesta', toggleImprovement: 'Estado de mejora actualizado', saveEquipment: 'Ficha técnica actualizada' }
const customerTitle = customer => [customer?.account, customer?.name].filter(Boolean).join(' · ')
const dateLabel = value => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : 'Sin fecha'
export const cctvTimestamp = value => {
  if (!value) return 'Sin registro'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' }) : 'Sin registro'
}
export const filterCctvCustomers = (customers, search, onlyPending = false) => {
  const query = normalizeSearchText(search)
  return (customers || []).filter(customer => (!onlyPending || Number(customer.pendingImprovements) > 0) && (!query || normalizeSearchText([customer.account, customer.name, customer.address].filter(Boolean).join(' ')).includes(query)))
}
export const filterCctvNews = (entries, { search = '', from = '', to = '' } = {}) => {
  const query = normalizeSearchText(search)
  return (entries || []).filter(item => {
    const date = item.at && Number.isFinite(new Date(item.at).getTime()) ? new Date(item.at).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : ''
    return (!query || normalizeSearchText([item.title, item.body, item.file?.fileName].filter(Boolean).join(' ')).includes(query)) && (!from || date >= from) && (!to || Boolean(date) && date <= to)
  }).sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')))
}
const emptyNews = () => ({ title: '', body: '', file: null })
const emptyPlan = () => ({ title: '', notes: '', file: null, drawing: null })
export const cctvPlanDraftFromVersion = item => ({ title: item.title || '', notes: item.notes || '', file: null, drawing: item.drawing ? structuredClone(item.drawing) : null })
const emptyImprovement = () => ({ title: '', description: '', priority: 'Normal' })
const draftsFor = dossier => ({ news: emptyNews(), maintenance: { observation: dossier?.maintenance?.observation || '', nextDate: dossier?.maintenance?.nextDate || '' }, plans: emptyPlan(), improvements: emptyImprovement(), equipment: structuredClone(dossier?.equipment || []) })
const serialize = value => JSON.stringify(value)
export const rebaseCctvDrafts = ({ drafts, baseline, dossier, savedSection }) => {
  const latest = draftsFor(dossier), nextDrafts = {}, nextBaseline = {}
  for (const section of Object.keys(latest)) {
    const replace = section === savedSection || serialize(drafts[section]) === serialize(baseline[section])
    nextDrafts[section] = structuredClone(replace ? latest[section] : drafts[section])
    nextBaseline[section] = structuredClone(replace ? latest[section] : baseline[section])
  }
  return { drafts: nextDrafts, baseline: nextBaseline }
}
const authorId = item => String(item?.author?.id || item?.author?.name || 'Sistema')
const authorName = item => item?.author?.name || 'Sistema'

export default function CctvServices({ initialCustomerId = '', allowBack = true, embedded = false, onClose, navigationGuardRef, repository = cctvRepository, persistRequirement = repository.saveRequirement, initialCustomers }) {
  const { can } = usePermissions()
  const [customers, setCustomers] = useState(initialCustomers || null), [selected, setSelected] = useState(initialCustomerId)
  const [search, setSearch] = useState(''), [onlyPending, setOnlyPending] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(!initialCustomers)
  const [reload, setReload] = useState(0), [leaveRequest, setLeaveRequest] = useState(null)
  const draftRef = useRef({ dirty: false, busy: false })
  const incomingCustomer = useRef(initialCustomerId)
  const stateChanged = useCallback(state => { draftRef.current = state }, [])
  const requestLeave = continuation => {
    if (draftRef.current.busy) return
    if (draftRef.current.dirty) { setLeaveRequest(() => continuation); return }
    continuation()
  }
  useEffect(() => {
    if (incomingCustomer.current === initialCustomerId) return
    incomingCustomer.current = initialCustomerId
    requestLeave(() => setSelected(initialCustomerId))
  }, [initialCustomerId])
  useEffect(() => {
    const guard = continuation => requestLeave(continuation)
    guard.hasDraft = () => draftRef.current.dirty || draftRef.current.busy
    if (navigationGuardRef) navigationGuardRef.current = guard
    const beforeUnload = event => { if (guard.hasDraft()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('beforeunload', beforeUnload); if (navigationGuardRef?.current === guard) navigationGuardRef.current = null }
  }, [navigationGuardRef])
  const canView = can('cctv.view')
  useEffect(() => {
    if (!canView || selected) return
    let alive = true
    setLoading(true); setError('')
    repository.list().then(result => { if (alive) setCustomers(result.customers || []) }).catch(cause => { if (alive) setError(cause.message) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [canView, selected, reload, repository])
  const visible = filterCctvCustomers(customers, search, onlyPending)
  if (!canView) return <section className="cctv-services"><p>No tenés permiso para consultar los servicios de CCTV.</p></section>
  return <section className={`cctv-services${embedded ? ' cctv-embedded' : ''}`} aria-label="Servicios de CCTV">
    {!embedded && <div className="module-intro"><ModuleIntroduction><h1>Servicios de CCTV</h1><p>Información, mantenimiento y mejoras de las cuentas con servicio de CCTV.</p></ModuleIntroduction></div>}
    {selected ? <CctvCustomerDetail key={selected} customerId={selected} repository={repository} persistRequirement={persistRequirement} onDraftStateChange={stateChanged} onOpenTicket={ticketId => requestLeave(() => window.dispatchEvent(new CustomEvent('open-ticket', { detail: { ticketId } })))} onSaved={() => setReload(value => value + 1)} onBack={allowBack ? () => requestLeave(() => { draftRef.current = { dirty: false, busy: false }; setSelected('') }) : undefined} onClose={onClose ? () => requestLeave(onClose) : undefined} /> : <>
      <div className="cctv-list-toolbar"><label>Buscar cuenta<input type="search" placeholder="Nombre, cuenta o dirección" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="cctv-check"><input type="checkbox" checked={onlyPending} onChange={event => setOnlyPending(event.target.checked)} />Con mejoras pendientes</label><button type="button" className="secondary" disabled={loading} onClick={() => setReload(value => value + 1)}><Icon name="refresh" />Actualizar</button></div>
      {error && <div className="cctv-alert" role="alert">{error} <button type="button" className="secondary" disabled={loading} onClick={() => setReload(value => value + 1)}>Reintentar</button></div>}
      {loading && <p role="status">Cargando cuentas de CCTV…</p>}
      {!loading && !error && <><p className="cctv-muted">{visible.length} cuenta(s){onlyPending && ' con mejoras pendientes'}</p><div className="cctv-table-wrap"><table className="cctv-table"><thead><tr><th scope="col">Cuenta y cliente</th><th scope="col">Dirección</th><th scope="col">Mejoras pendientes</th><th scope="col">Equipos</th><th scope="col">Última actualización</th><th scope="col">Acciones</th></tr></thead><tbody>{visible.map(customer => <tr key={customer.customerId}><td data-label="Cuenta y cliente"><strong>{customerTitle(customer)}</strong></td><td data-label="Dirección">{customer.address || 'Sin dirección'}</td><td data-label="Mejoras pendientes"><span className={customer.pendingImprovements ? 'cctv-badge cctv-badge-pending' : 'cctv-badge'}>{Number(customer.pendingImprovements || 0)}</span></td><td data-label="Equipos">{Number(customer.equipmentCount || 0)}</td><td data-label="Última actualización">{cctvTimestamp(customer.updatedAt)}</td><td><button type="button" className="secondary" aria-label={`Abrir ficha de ${customerTitle(customer)}`} onClick={() => setSelected(customer.customerId)}><Icon name="eye" size={16} />Ver ficha</button></td></tr>)}</tbody></table>{!visible.length && <p className="cctv-empty">{customers?.length ? 'No hay cuentas que coincidan con los filtros.' : 'No hay cuentas de CCTV disponibles para tu usuario.'}</p>}</div></>}
    </>}
    {leaveRequest && <div className="modal-layer"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="cctv-discard-title"><h2 id="cctv-discard-title">Cambios sin guardar</h2><p>Tu borrador todavía no se guardó. Podés seguir editándolo o descartarlo para salir.</p><div className="confirm-actions"><button type="button" className="secondary" onClick={() => setLeaveRequest(null)}>Seguir editando</button><button type="button" className="danger-button" onClick={() => { const continuation = leaveRequest; setLeaveRequest(null); draftRef.current = { dirty: false, busy: false }; continuation() }}>Descartar y salir</button></div></section></div>}
  </section>
}

export function CctvCustomerDetail({ customerId, repository = cctvRepository, persistRequirement = repository.saveRequirement, onBack, onClose, onSaved, onDraftStateChange, onOpenTicket, initialData = null, initialTab = 'general' }) {
  const { can } = usePermissions()
  const [data, setData] = useState(initialData), [loading, setLoading] = useState(!initialData), [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState(initialTab), [drafts, setDrafts] = useState(() => draftsFor(initialData?.dossier))
  const [newsSearch, setNewsSearch] = useState(''), [newsFrom, setNewsFrom] = useState(''), [newsTo, setNewsTo] = useState('')
  const [planToReplace, setPlanToReplace] = useState(null)
  const [requirementDraft, setRequirementDraft] = useState(null)
  const planForm = useRef(null)
  const [busy, setBusy] = useState(false), [fileBusy, setFileBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false)
  const baseline = useRef(draftsFor(initialData?.dossier)), busyRef = useRef(false), alive = useRef(true), attempts = useRef(null)
  const tabId = useId()
  if (!attempts.current) attempts.current = createCctvCommandSession()
  const dirty = Boolean(requirementDraft) || serialize(drafts) !== serialize(baseline.current)
  useEffect(() => { onDraftStateChange?.({ dirty, busy: busy || fileBusy || loading }); return () => onDraftStateChange?.({ dirty: false, busy: false }) }, [dirty, busy, fileBusy, loading, onDraftStateChange])
  const load = async (preserveDraft = false) => {
    if (busyRef.current) return
    busyRef.current = true; setLoading(true); setLoadError('')
    try {
      const result = await repository.detail(customerId)
      if (!alive.current) return
      setData(result); setConflict(false); setError('')
      const currentRequirement = result.customer.cctvRequirement || ''
      const currentDetail = result.customer.cctvRequirementDetail || ''
      setRequirementDraft(previous => preserveDraft && previous &&
        (previous.value !== currentRequirement || previous.detail.trim() !== currentDetail)
        ? { ...previous, expected: currentRequirement, expectedDetail: currentDetail } : null)
      if (!preserveDraft) { const next = draftsFor(result.dossier); baseline.current = structuredClone(next); setDrafts(next) }
      else {
        const next = rebaseCctvDrafts({ drafts, baseline: baseline.current, dossier: result.dossier })
        baseline.current = next.baseline; setDrafts(next.drafts)
        setNotice('La ficha se actualizó. Tus cambios sin guardar se conservaron y los demás apartados muestran la información actual. Revisá tu borrador antes de guardar nuevamente.')
      }
    } catch (cause) { if (alive.current) setLoadError(cause.message) }
    finally { busyRef.current = false; if (alive.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; if (!initialData) void load(); return () => { alive.current = false } }, [customerId, repository])
  const edit = (section, patch) => setDrafts(previous => ({ ...previous, [section]: Array.isArray(patch) ? patch : { ...previous[section], ...patch } }))
  const save = async (action, payload, section) => {
    if (busyRef.current || fileBusy || conflict || !can('cctv.edit') || data?.capabilities?.edit === false) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    const command = attempts.current.prepare({ customerId, expectedVersion: Number(data.dossier.version || 0), action, payload })
    try {
      const result = await repository.save(command)
      if (!alive.current) return
      attempts.current.accepted(command); setData(result)
      const next = rebaseCctvDrafts({ drafts, baseline: baseline.current, dossier: result.dossier, savedSection: section })
      baseline.current = next.baseline; setDrafts(next.drafts)
      setNotice('La información se guardó correctamente.'); onSaved?.(result)
    } catch (cause) {
      if (!alive.current) return
      const stale = cause.status === 409 || cause.payload?.code === 'CCTV_VERSION_CONFLICT'
      setConflict(stale); setError(stale ? 'La ficha cambió mientras estabas editando. Actualizala para revisar los cambios; tu borrador se conserva.' : cause.message || 'No se pudo guardar. Tu borrador se conserva para reintentar.')
    } finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  const dossier = data?.dossier || {}, customer = data?.customer || {}
  const canEdit = can('cctv.edit') && data?.capabilities?.edit !== false
  const canDownload = can('cctv.download') && data?.capabilities?.download !== false
  const pending = (dossier.improvements || []).filter(item => !item.completed).length
  const visibleNews = filterCctvNews(dossier.news, { search: newsSearch, from: newsFrom, to: newsTo })
  const colorByAuthor = useMemo(() => {
    const entries = [...(dossier.activity || []), ...(dossier.news || []), ...(dossier.plans || []), ...(dossier.improvements || []), dossier.maintenance].filter(Boolean)
    const styles = ticketAuthorColors(entries.map(item => ({ byId: authorId(item), byName: authorName(item) })))
    return new Map(entries.map((item, index) => [authorId(item), styles[index]]))
  }, [data])
  const disabled = busy || fileBusy || loading
  const saveDisabled = disabled || conflict
  const saveRequirement = async event => {
    event.preventDefault()
    if (!canEdit || saveDisabled || busyRef.current || !requirementDraft) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await persistRequirement({
        customerId,
        expectedRequirement: requirementDraft.expected,
        expectedDetail: requirementDraft.expectedDetail,
        cctvRequirement: requirementDraft.value,
        cctvRequirementDetail: requirementDraft.detail.trim()
      })
      if (!alive.current) return
      setData(previous => ({ ...previous, customer: result.customer }))
      setRequirementDraft(null)
      setNotice('El requerimiento de CCTV se guardó en la cuenta.')
      onSaved?.()
    } catch (cause) {
      if (!alive.current) return
      const stale = cause.status === 409
      setConflict(stale)
      setError(stale ? 'El requerimiento cambió. Actualizá la ficha para revisar el valor guardado antes de volver a guardar.' : cause.message || 'No se pudo guardar el requerimiento.')
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  const usePlan = item => {
    if (!canEdit || disabled) return
    edit('plans', cctvPlanDraftFromVersion(item)); setPlanToReplace(null)
    setNotice('El esquema se cargó como base. Al guardar se creará una nueva versión y se conservará la anterior.')
    planForm.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    planForm.current?.querySelector('input')?.focus({ preventScroll: true })
  }
  const requestPlan = item => {
    if (!canEdit || disabled) return
    if (serialize(drafts.plans) !== serialize(baseline.current.plans)) setPlanToReplace(item)
    else usePlan(item)
  }
  const currentRequirement = customer.cctvRequirement || ''
  const currentDetail = currentRequirement === 'Otro' ? (customer.cctvRequirementDetail || '') : ''
  const selectedRequirement = requirementDraft?.value ?? currentRequirement
  const editRequirement = (value, detail) => {
    setRequirementDraft(value === currentRequirement && detail === currentDetail ? null : {
      value, detail,
      expected: requirementDraft?.expected ?? currentRequirement,
      expectedDetail: requirementDraft?.expectedDetail ?? currentDetail
    })
    setNotice('')
  }
  const generalFields = [['Cuenta', customer.account], ['Cliente', customer.name], ['Dirección', customer.address], ['Teléfono', customer.phone], ['Correo electrónico', customer.email], ...[['Contacto', customer.contact], ['Nombre del contacto', customer.contactName], ['Teléfono del contacto', customer.contactPhone]].filter(([, value]) => typeof value === 'string' && value.trim())]
  if (!canEdit) {
    generalFields.push(['Requerimiento de CCTV', currentRequirement || 'Sin especificar'])
    if (currentDetail) generalFields.push(['Detalle del requerimiento', currentDetail])
  }
  const submit = (event, action, payload, section) => { event.preventDefault(); void save(action, payload, section) }
  return <div className="cctv-detail" aria-busy={disabled || undefined}>
    <div className="cctv-detail-toolbar"><div className="cctv-inline-actions">{onBack && <button type="button" className="secondary" disabled={disabled} onClick={onBack}>← Volver a cuentas</button>}{onClose && <button type="button" className="secondary" disabled={disabled} onClick={onClose}><Icon name="close" />Cerrar</button>}</div>{data && <span className="cctv-muted">Última actualización: {cctvTimestamp(dossier.updatedAt)}</span>}</div>
    {loading && <p role="status">Cargando ficha de CCTV…</p>}
    {loadError && <div className="cctv-alert" role="alert">{loadError}<button type="button" className="secondary" disabled={disabled} onClick={() => load(Boolean(data))}>Reintentar</button></div>}
    {data && <>
      <header className="cctv-customer-heading"><div><p className="eyebrow">{customer.account || 'CUENTA CCTV'}</p><h2>{customer.name || 'Ficha de CCTV'}</h2><p>{customer.address || 'Sin dirección registrada'}</p></div><span className={`cctv-badge${pending ? ' cctv-badge-pending' : ''}`}>{pending} mejora(s) pendiente(s)</span></header>
      {!canEdit && <p className="cctv-readonly"><Icon name="lock" size={15} />Ficha de consulta</p>}
      {error && <div className="cctv-alert" role="alert"><p>{error}</p>{conflict && <button type="button" className="secondary" disabled={disabled} onClick={() => load(true)}>Actualizar ficha conservando borrador</button>}</div>}
      {notice && <p className="cctv-success" role="status">{notice}</p>}
      {busy && <p role="status">Guardando cambios…</p>}
      <div className="cctv-tab-navigation">
        <div className="cctv-tabs" role="tablist" aria-label="Secciones de la ficha CCTV">{Object.entries(TABS).map(([key, { label }]) => <button key={key} type="button" role="tab" id={`${tabId}-${key}`} aria-controls={`${tabId}-panel-${key}`} aria-selected={tab === key} className={tab === key ? 'active' : ''} disabled={disabled} onClick={() => setTab(key)}>{label}</button>)}</div>
        <p className="cctv-tab-description" id={`${tabId}-description`}>{TABS[tab].description}</p>
      </div>
      <section className="cctv-panel" role="tabpanel" id={`${tabId}-panel-${tab}`} aria-labelledby={`${tabId}-${tab}`} aria-describedby={`${tabId}-description`}>
        {tab === 'tickets' && (can('tickets.view') ? <CctvAccountTickets key={customerId} customer={customer} onOpenTicket={onOpenTicket} /> : <p>No tenés permiso para consultar los tickets de esta cuenta.</p>)}
        {tab === 'general' && <>
          <h3>Datos generales</h3>
          <dl className="cctv-data-grid">{generalFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Sin registrar'}</dd></div>)}</dl>
          {canEdit && <form className="cctv-form" onSubmit={saveRequirement}>
            <CctvRequirementSelect value={selectedRequirement} detail={requirementDraft?.detail ?? currentDetail} disabled={disabled}
              onChange={event => editRequirement(event.target.value, event.target.value === 'Otro' ? currentDetail : '')}
              onDetailChange={event => editRequirement(selectedRequirement, event.target.value)} />
            {requirementDraft && <small>Valor guardado en la cuenta: {[currentRequirement || 'Sin especificar', currentDetail].filter(Boolean).join(' · ')}</small>}
            <button type="submit" className="primary" disabled={saveDisabled || !requirementDraft}><Icon name="check" />Guardar requerimiento</button>
          </form>}
          <h3>Actividad de la cuenta</h3>
          <ActivityTimeline entries={dossier.activity || []} colors={colorByAuthor} />
        </>}
        {tab === 'news' && <><h3>Novedades</h3>{canEdit && <form className="cctv-form" onSubmit={event => submit(event, 'addNews', drafts.news, 'news')}><fieldset disabled={disabled}><label>Título<input required maxLength={160} value={drafts.news.title} onChange={event => edit('news', { title: event.target.value })} /></label><label>Observación<textarea aria-label="Observación" required rows={4} maxLength={10000} value={drafts.news.body} onChange={event => edit('news', { body: event.target.value })} /></label><CctvFileField value={drafts.news.file} onChange={file => edit('news', { file })} onBusyChange={setFileBusy} disabled={disabled} /><button className="primary" disabled={saveDisabled || !drafts.news.title.trim() || !drafts.news.body.trim()}><Icon name="plus" />Guardar novedad</button></fieldset></form>}<div className="cctv-news-filters"><label>Buscar novedad<input type="search" placeholder="Título, observación o archivo" value={newsSearch} onChange={event => setNewsSearch(event.target.value)} /></label><label>Desde<input type="date" value={newsFrom} onChange={event => setNewsFrom(event.target.value)} /></label><label>Hasta<input type="date" value={newsTo} min={newsFrom || undefined} onChange={event => setNewsTo(event.target.value)} /></label></div>{newsFrom && newsTo && newsFrom > newsTo && <p className="field-error">La fecha hasta debe ser igual o posterior a la fecha desde.</p>}<div className="cctv-entries">{visibleNews.map(item => <Entry key={item.id} item={item} colors={colorByAuthor}><h4>{item.title}</h4><p className="cctv-text">{item.body}</p><Attachment file={item.file} customerId={customerId} allowed={canDownload} /></Entry>)}{!visibleNews.length && <p className="cctv-empty">{dossier.news?.length ? 'No hay novedades que coincidan con los filtros.' : 'Todavía no hay novedades registradas.'}</p>}</div></>}
        {tab === 'maintenance' && <><h3>Poda y mantenimiento</h3><div className="cctv-maintenance-summary"><p className="cctv-text">{dossier.maintenance?.observation || 'Sin observaciones de mantenimiento.'}</p><p><strong>Próxima revisión:</strong> {dateLabel(dossier.maintenance?.nextDate)}</p>{dossier.maintenance?.at && <AuthorLine item={dossier.maintenance} />}</div>{canEdit && <form className="cctv-form" onSubmit={event => submit(event, 'saveMaintenance', drafts.maintenance, 'maintenance')}><fieldset disabled={disabled}><label>Observaciones<textarea aria-label="Observaciones" required rows={5} maxLength={10000} value={drafts.maintenance.observation} onChange={event => edit('maintenance', { observation: event.target.value })} /></label><label>Próxima revisión (opcional)<input type="date" value={drafts.maintenance.nextDate} onChange={event => edit('maintenance', { nextDate: event.target.value })} /></label><button className="primary" disabled={saveDisabled || !drafts.maintenance.observation.trim() || serialize(drafts.maintenance) === serialize(baseline.current.maintenance)}><Icon name="check" />Guardar mantenimiento</button></fieldset></form>}<h4>Historial de mantenimiento</h4><ActivityTimeline entries={(dossier.activity || []).filter(item => item.action === 'saveMaintenance')} colors={colorByAuthor} /></>}
        {tab === 'plans' && <><h3>Planimetría</h3>
          {canEdit && <form ref={planForm} className="cctv-form" onSubmit={event => submit(event, 'addPlan', drafts.plans, 'plans')}><fieldset disabled={disabled}>
            <label>Nombre del plano<input required maxLength={160} value={drafts.plans.title} onChange={event => edit('plans', { title: event.target.value })} /></label>
            <label>Notas (opcional)<textarea aria-label="Notas (opcional)" rows={3} maxLength={10000} value={drafts.plans.notes} onChange={event => edit('plans', { notes: event.target.value })} /></label>
            <CctvFileField value={drafts.plans.file} onChange={file => edit('plans', { file })} onBusyChange={setFileBusy} disabled={disabled} allowImages />
            <PlanimetryEditor value={drafts.plans.drawing} onChange={drawing => edit('plans', { drawing })} disabled={disabled} allowDownload={canDownload} />
            <button className="primary" disabled={saveDisabled || !drafts.plans.title.trim() || !(drafts.plans.file || drafts.plans.drawing?.elements?.length)}><Icon name="check" />Guardar nueva versión</button>
          </fieldset></form>}
          {planToReplace && <div className="cctv-alert" role="alertdialog" aria-label="Reemplazar borrador del plano"><p>Ya tenés un plano sin guardar. Para usar «{planToReplace.title}» como base, se reemplazará ese borrador. Las versiones guardadas se conservan.</p><div className="cctv-inline-actions"><button type="button" className="secondary" disabled={disabled} onClick={() => setPlanToReplace(null)}>Conservar borrador</button><button type="button" className="primary" disabled={disabled} onClick={() => usePlan(planToReplace)}>Reemplazar borrador</button></div></div>}
          <h4>Versiones guardadas</h4><div className="cctv-entries">{[...(dossier.plans || [])].reverse().map((item, index) => <PlanVersion key={item.id} item={item} version={item.version || (dossier.plans.length - index)} colors={colorByAuthor} customerId={customerId} canDownload={canDownload} onUseAsBase={canEdit ? () => requestPlan(item) : undefined} disabled={disabled} />)}{!dossier.plans?.length && <p className="cctv-empty">Todavía no hay planos guardados.</p>}</div></>}
        {tab === 'improvements' && <><h3>Mejoras</h3>{canEdit && <form className="cctv-form" onSubmit={event => submit(event, 'addImprovement', drafts.improvements, 'improvements')}><fieldset disabled={disabled}><label>Mejora propuesta<input required maxLength={160} value={drafts.improvements.title} onChange={event => edit('improvements', { title: event.target.value })} /></label><label>Detalle<textarea aria-label="Detalle" required rows={4} maxLength={10000} value={drafts.improvements.description} onChange={event => edit('improvements', { description: event.target.value })} /></label><label>Prioridad<select aria-label="Prioridad" value={drafts.improvements.priority} onChange={event => edit('improvements', { priority: event.target.value })}>{['Normal', 'Alta', 'Baja'].map(priority => <option key={priority}>{priority}</option>)}</select></label><button className="primary" disabled={saveDisabled || !drafts.improvements.title.trim() || !drafts.improvements.description.trim()}><Icon name="plus" />Agregar mejora</button></fieldset></form>}<div className="cctv-entries">{[...(dossier.improvements || [])].sort((left, right) => Number(Boolean(left.completed)) - Number(Boolean(right.completed)) || String(right.at || '').localeCompare(String(left.at || ''))).map(item => <Entry key={item.id} item={item} colors={colorByAuthor} className={item.completed ? 'cctv-completed' : ''}><div className="cctv-improvement-title"><label className="cctv-check"><input type="checkbox" checked={Boolean(item.completed)} disabled={!canEdit || saveDisabled} aria-label={`${item.completed ? 'Marcar pendiente' : 'Marcar realizada'}: ${item.title}`} onChange={event => save('toggleImprovement', { id: item.id, completed: event.target.checked })} /><strong>{item.completed ? <s>{item.title}</s> : item.title}</strong></label><span className="cctv-badge">{item.priority || 'Normal'}</span></div><p className="cctv-text">{item.description}</p>{item.completed && <p className="cctv-completion">Realizada por {item.completedBy?.name || 'Usuario registrado'} · {cctvTimestamp(item.completedAt)}</p>}</Entry>)}{!dossier.improvements?.length && <p className="cctv-empty">Todavía no hay mejoras propuestas.</p>}</div></>}
        {tab === 'equipment' && <><h3>Ficha técnica</h3>{canEdit ? <form className="cctv-form" onSubmit={event => submit(event, 'saveEquipment', { items: drafts.equipment }, 'equipment')}><EquipmentEditor value={drafts.equipment} onChange={items => edit('equipment', items)} disabled={disabled} /><button className="primary" disabled={saveDisabled || serialize(drafts.equipment) === serialize(baseline.current.equipment)}><Icon name="check" />Guardar ficha técnica</button></form> : <EquipmentEditor value={dossier.equipment || []} readOnly />}<details className="cctv-history"><summary>Historial de la ficha técnica</summary><ActivityTimeline entries={(dossier.activity || []).filter(item => item.action === 'saveEquipment')} colors={colorByAuthor} /></details></>}
      </section>
    </>}
  </div>
}

function AuthorLine({ item }) { return <div className="cctv-author-line"><strong>{authorName(item)}</strong><time dateTime={item.at || undefined}>{cctvTimestamp(item.at)}</time></div> }
function Entry({ item, colors, children, className = '' }) { return <article className={`cctv-entry ${className}`} style={colors?.get(authorId(item))}><AuthorLine item={item} />{children}</article> }
function Attachment({ file, customerId, allowed }) {
  if (!file) return null
  return allowed ? <a className="cctv-attachment" href={cctvAttachmentUrl(customerId, file.id)} target="_blank" rel="noopener noreferrer" download={file.fileName}><Icon name="download" size={16} />{file.fileName || 'Descargar archivo'}</a> : <span className="cctv-muted">Archivo adjunto: {file.fileName || 'Documento'}</span>
}
function PlanVersion({ item, version, colors, customerId, canDownload, onUseAsBase, disabled }) {
  const [showDrawing, setShowDrawing] = useState(false)
  return <Entry item={item} colors={colors}><h4>{item.title} <span className="cctv-badge">Versión {version}</span></h4>{item.notes && <p className="cctv-text">{item.notes}</p>}<div className="cctv-inline-actions"><Attachment file={item.file} customerId={customerId} allowed={canDownload} />{item.drawing?.elements?.length > 0 && <><button type="button" className="secondary" onClick={() => setShowDrawing(value => !value)}>{showDrawing ? 'Ocultar esquema' : 'Ver esquema'}</button>{onUseAsBase && <button type="button" className="secondary" disabled={disabled} onClick={onUseAsBase}>Usar como base</button>}</>}</div>{showDrawing && <PlanimetryEditor value={item.drawing} readOnly allowDownload={canDownload} />}</Entry>
}
function ActivityTimeline({ entries, colors }) {
  if (!entries.length) return <p className="cctv-empty">Todavía no hay gestiones registradas.</p>
  return <ol className="cctv-timeline">{[...entries].reverse().map(item => <li key={item.id}><Entry item={item} colors={colors}><h4>{item.summary || ACTION_LABELS[item.action] || 'Gestión registrada'}</h4>{item.action === 'saveMaintenance' && <><p className="cctv-text">{item.details?.after?.observation}</p>{item.details?.after?.nextDate && <p>Próxima revisión: {dateLabel(item.details.after.nextDate)}</p>}{item.details?.before?.observation && <details><summary>Observación anterior</summary><p className="cctv-text">{item.details.before.observation}</p>{item.details.before.nextDate && <p>Próxima revisión anterior: {dateLabel(item.details.before.nextDate)}</p>}</details>}</>}{item.action === 'saveEquipment' && <><details><summary>Inventario registrado</summary><EquipmentEditor value={item.details?.after || []} readOnly /></details><details><summary>Inventario anterior</summary><EquipmentEditor value={item.details?.before || []} readOnly /></details></>}</Entry></li>)}</ol>
}
export function CctvFileField({ value, onChange, onBusyChange, disabled, allowImages = false }) {
  const [error, setError] = useState('')
  const input = useRef(null), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const choose = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(''); onBusyChange?.(true)
    try { const encoded = await encodeCctvFile(file, { allowImages }); if (alive.current) onChange(encoded) }
    catch (cause) { if (alive.current) setError(cause.message) }
    finally { if (input.current) input.current.value = ''; onBusyChange?.(false) }
  }
  return <div className="cctv-file-field"><label>Archivo adjunto (opcional)<input ref={input} type="file" accept={allowImages ? '.pdf,.jpg,.jpeg,.png,.webp' : '.pdf'} disabled={disabled} onChange={choose} /></label><small>{allowImages ? 'PDF, JPG, PNG o WEBP' : 'PDF'} · Hasta 3 MB</small>{value && <div className="cctv-inline-actions"><span>{value.fileName}</span><button type="button" className="secondary" disabled={disabled} onClick={() => { onChange(null); setError('') }}>Quitar archivo del borrador</button></div>}{error && <p className="field-error" role="alert">{error}</p>}</div>
}
