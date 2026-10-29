import addressChange from '../../../../api/_lib/address-change.cjs'
import AddressChangeFields from '../../../components/AddressChangeFields.jsx'
import RegistrationForms from '../../registration/RegistrationForms.jsx'
import { useActionPermissions } from '../../../presentation/hooks/useActionPermissions.mjs'
import { canWriteRecord } from '../../../domain/access/record-scope.mjs'
import { canCompleteHistoryRecord, historyStatusPermission, permittedHistoryEditPatch } from '../application/history-action-permissions.mjs'
import FollowupSummary from '../../followups/FollowupSummary.jsx'
import React, { useState, useRef, useEffect } from "react";
import { ServiceJourneysContext, JourneyIdentityField, JourneyHistory, journeyReportType } from "../../../components/ServiceJourneys.jsx";
import { completeRescheduleSlot } from "../../../domain/agenda/reschedule-availability.mjs";
import { serviceRecordFingerprint, serviceRecordChangedFields } from "../../../domain/history/service-concurrency.mjs";
import { requiresDifferentRescheduleDay } from "../../../domain/history/history-edit-policy.mjs";
import { appendTraceElement } from "../../../presentation/service-trace-dom.mjs";
import { serviceEstimateForTask, resolveServiceForTask, normalizeInternalChecklist } from "../../services/application/service-fields.mjs";
import useDiscardGuard from "../../../components/ui/useDiscardGuard.jsx";
import { stampServiceRecord, technicalReporter, prettyReportDateTime } from "../../agenda/application/agenda-model.mjs";
import { customerLinkPatch } from "../../agenda/application/customer-linking.mjs";
import { servicePhotoUrl } from "../../attachments/application/service-photo.mjs";
import ServiceCompletionCorrection from "../../../components/ServiceCompletionCorrection.jsx";
import ServiceCategoryCorrection from "../../../components/ServiceCategoryCorrection.jsx";
import HistoryRescheduleModal from "../../../components/HistoryRescheduleModal.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import { prettyDate, currentLocalDate } from "../../../presentation/formatting.mjs";
import { historyStatusLabel } from "../../../domain/dashboard/dashboard-metrics.mjs";
import { CustomerAutocomplete, ServiceEstimatedDurationField, InternalPreparationFields, ServiceConfirmationButton } from "../../agenda/presentation/AgendaFields.jsx";
import ServiceTypesField from "../../../components/ServiceTypesField.jsx";
import { serviceTypesLabel } from "../../../domain/services/multi-service.mjs";
import { durationLabel } from "../../../domain/agenda/duration-label.mjs";
import ServiceCustomerMap from "../../../components/ServiceCustomerMap.jsx";
import Attachments from "../../../components/Attachments.jsx";
import { Confirm } from "../../../presentation/components/Confirm.jsx";

export function HistoryManagementDetail({ record, setHistory, close, customers, services, employees, authUser, persistHistoryRecord, persistHistoryRecordRemoval, historyScheduling }) {
  const { can: canAction, user, granular } = useActionPermissions()
  const writable = canWriteRecord(record, user, customers)
  const can = (key, legacy = true) => canAction(key, legacy) && (key.startsWith('records.') || key.endsWith('.read') || writable)
  const canEdit = ['history.edit', 'planning.notes', 'planning.checklist', 'planning.linkAccount', 'planning.reservation.link'].some(key => can(key))
  const canComplete = (record.serviceTypes || []).length < 2 && (granular ? canCompleteHistoryRecord(record, can) : true)
  const [registrationBusy, setRegistrationBusy] = useState(false)
  const [correctingCompletion, setCorrectingCompletion] = useState(false)
  const canCorrectCompletion = Boolean(record.workCompletion || record.technicalStatus || record.technicianRequest || record.serviceTypes?.length > 1) && authUser?.roleCode === 'administrator' && can('history.complete') && !record.vehicleControl && !record.serviceJourney && !record.awaitingConfirmation && ['Pendiente', 'Requiere revisión', 'En proceso'].includes(record.status) && record.technicalStatus !== 'Completado' && Boolean(persistHistoryRecord)
  const [correctingCategory, setCorrectingCategory] = useState(false)
  const completedRecord = record.status === 'Completado' || record.technicalStatus === 'Completado'
  const canCorrectCategory = completedRecord && can('history.category', authUser?.roleCode === 'administrator') && !record.subscriberReservation && !record.vehicleControl && !record.serviceJourney && Boolean(persistHistoryRecord)
  const journeyHistory = React.useContext(ServiceJourneysContext)?.history || [record]
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleTeam, setRescheduleTeam] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [rescheduleError, setRescheduleError] = useState('')
  const [reschedulePrompt, setReschedulePrompt] = useState(null)
  const rescheduleSlotComplete = completeRescheduleSlot(rescheduleDate, rescheduleTime)
  const destinationTeams = rescheduleSlotComplete ? historyScheduling?.teamsForDate(rescheduleDate, rescheduleTime, record) || [] : []
  const confirmReschedule = async () => {
    if (!can('planning.reschedule') || interactionBlocked || !rescheduleReady) return
    setSaving(true); setRescheduleError('')
    try {
      await historyScheduling.save(record, rescheduleDate, rescheduleTeam, rescheduleTime)
      close()
    } catch (error) { setRescheduleError(error.message || 'No se pudo reprogramar. Intentá nuevamente.') }
    finally { setSaving(false) }
  }
  const minimumRescheduleDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const recordFingerprint = serviceRecordFingerprint(record)
  const acceptedRecordRef = useRef(record)
  const [acceptedFingerprint, setAcceptedFingerprint] = useState(recordFingerprint)
  const [historySaveError, setHistorySaveError] = useState('')
  const remotelyUpdated = recordFingerprint !== acceptedFingerprint
  const changedFields = remotelyUpdated ? serviceRecordChangedFields(acceptedRecordRef.current, record) : []
  const interactionBlocked = remotelyUpdated || saving || registrationBusy
  const selectedRescheduleTeam = destinationTeams.find(team => String(team.teamId) === String(rescheduleTeam))
  const hasRescheduleDraft = rescheduling && Boolean(rescheduleDate || rescheduleTime || rescheduleTeam)
  const rescheduleReady = Boolean(rescheduleDate >= minimumRescheduleDate && (!requiresDifferentRescheduleDay(record) || rescheduleDate !== record.date) && selectedRescheduleTeam && /^([01]\d|2[0-3]):[0-5]\d$/.test(rescheduleTime))
  const requestClose = () => {
    if (saving || registrationBusy) return
    if (hasRescheduleDraft) { setReschedulePrompt('leave'); return }
    requestDiscardClose()
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = document.querySelector('.history-detail .history-edit-grid, .history-detail .history-detail-grid')
      appendTraceElement(container, record)
      container?.querySelector(':scope > .service-trace')?.classList.add('history-modal-trace')
    })
    return () => cancelAnimationFrame(frame)
  }, [record, editing, rescheduling])
  const assignedDayTeams = historyScheduling?.assignedTeamsForDate?.(record.date) || []
  const assignedDayTeam = assignedDayTeams.find(team => String(team.teamId) === String(record.teamId))
  const assignedTeamLabel = assignedDayTeam ? `${assignedDayTeam.label} · ${assignedDayTeam.members.join(' / ')}` : `${record.team || 'Sin equipo'} · ${record.technicians?.join(' / ') || 'Sin técnicos asignados'}`
  const editableDraft = value => ({ serviceTypes: value.serviceTypes, service: value.service, estimatedMinutes: serviceEstimateForTask(value, resolveServiceForTask(value, services)), estimatedMinutesCustomized: Boolean(value.estimatedMinutesCustomized), customerId: value.customerId || '', serviceId: value.serviceId || '', technicianIds: value.technicianIds || [], teamId: value.teamId || '', team: value.team || '', address: value.address || '', newAddress: value.newAddress || '', phone: value.phone || '', detail: value.detail || '', internalNote: value.internalNote || '', internalChecklist: normalizeInternalChecklist(value.internalChecklist) })
  const [draft, setDraft] = useState(() => editableDraft(record))
  const draftChanged = editing && JSON.stringify(draft) !== JSON.stringify(editableDraft(acceptedRecordRef.current))
  const { requestClose: requestDiscardClose, discardDialog } = useDiscardGuard({ dirty: draftChanged, busy: saving || registrationBusy, onDiscard: close, title: 'Servicio sin guardar' })
  const cancelEditing = () => requestDiscardClose(() => {
    setDraft(editableDraft(record))
    setEditing(false)
    setHistorySaveError('')
  })
  const reviewCurrentVersion = () => {
    acceptedRecordRef.current = record
    setAcceptedFingerprint(recordFingerprint)
    setEditing(false)
    setConfirmDelete(false)
    setPendingAction(null)
    setDraft(editableDraft(record))
  }
  useEffect(() => {
    const heading = document.querySelector('.history-detail .history-detail-heading')
    if (!heading || !remotelyUpdated) return undefined
    const notice = document.createElement('div')
    notice.className = 'history-version-notice'
    notice.setAttribute('role', 'status')
    notice.setAttribute('aria-live', 'polite')
    const copy = document.createElement('div')
    const title = document.createElement('b')
    title.textContent = 'Hay una versión más reciente de este servicio.'
    const detail = document.createElement('span')
    detail.textContent = `${changedFields.length ? `Cambió: ${changedFields.join(', ')}. ` : 'Se actualizaron datos del registro. '}${editing ? 'Tu borrador permanece visible y no fue reemplazado.' : 'Revisá la versión actual antes de continuar.'}`
    const review = document.createElement('button'); review.title = "Revisá la versión del servicio que fue actualizada desde otra sesión antes de continuar."
    review.type = 'button'
    review.className = 'secondary'
    review.textContent = 'Revisar versión actual'
    review.onclick = reviewCurrentVersion
    copy.append(title, detail)
    notice.append(copy, review)
    heading.insertAdjacentElement('afterend', notice)
    return () => notice.remove()
  }, [remotelyUpdated, changedFields.join('|'), editing, recordFingerprint, rescheduling])
  const update = async patch => {
    if (interactionBlocked || !writable) return
    if (patch.status && !can(historyStatusPermission(patch.status))) return
    if (granular && ['Completado', 'Avance registrado'].includes(patch.status) && !canComplete) return
    if (Object.hasOwn(patch, 'awaitingConfirmation') && !can('planning.confirm')) return
    // Al elegir una nueva fecha, el servicio deja de pertenecer al día original y vuelve
    // a Pendiente para quedar disponible en la agenda de la fecha reprogramada.
    const isReschedule = patch.status === 'Reprogramado' && patch.scheduledDate
    const changes = isReschedule
      ? { ...patch, date: patch.scheduledDate, status: 'Pendiente', scheduledDate: '', rescheduledFrom: record.date, reprogrammedAt: new Date().toISOString() }
      : patch.technicalReportedAt === '' ? { ...patch, technicalReportedById: '', technicalReportedByName: '' } : patch
    const tracedRecord = stampServiceRecord({ ...record, ...changes }, authUser)
    if (isReschedule) {
      window.dispatchEvent(new CustomEvent('pignus:reschedule-service', { detail: { record: tracedRecord, nextDate: patch.scheduledDate, sourceDate: record.date } }))
      setHistory(previous => previous.map(item => item.id === record.id ? tracedRecord : item)); close(); return
    }
    if (!persistHistoryRecord) { setHistory(previous => previous.map(item => item.id === record.id ? tracedRecord : item)); close(); return }
    setSaving(true)
    setHistorySaveError('')
    try { await persistHistoryRecord(record, tracedRecord); close() }
    catch (error) { setHistorySaveError(error.message || 'No se guardaron los cambios.') }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (!can('history.delete') || (record.vehicleControl && !can('vehicle.controls.delete')) || interactionBlocked) return
    if (!persistHistoryRecordRemoval) { setHistory(previous => previous.filter(item => item.id !== record.id)); close(); return }
    setSaving(true)
    try { await persistHistoryRecordRemoval(record); close() } finally { setSaving(false) }
  }
  const saveChanges = () => {
    if (!canEdit || interactionBlocked) return
    const customer = customers.find(item => String(item.customerId) === String(draft.customerId))
    const service = services.find(item => String(item.id) === String(draft.serviceId))
    if ((draft.customerId !== (record.customerId || '') && !customer) || (draft.serviceId !== (record.serviceId || '') && !service)) return
    let patch = { ...draft, ...(record.vehicleControl ? { estimatedMinutes: 15, estimatedMinutesCustomized: false } : {}), ...(customer ? customerLinkPatch(record, customer, authUser) : {}), ...(service ? { serviceId: service.id, service: service.name } : {}), address: customer ? customer.address || '' : draft.address, phone: customer ? customer.phone || '' : draft.phone, teamId: record.teamId || '', team: record.team || '', technicianIds: record.technicianIds || [], technicians: record.technicians || [] }
    if (granular) patch = permittedHistoryEditPatch({
      record, initialDraft: editableDraft(record), draft,
      customerPatch: customer && String(draft.customerId) !== String(record.customerId || '') ? customerLinkPatch(record, customer, authUser) : {},
      servicePatch: service && String(draft.serviceId) !== String(record.serviceId || '') ? { serviceId: service.id, service: service.name } : {}
    }, can)
    if (addressChange.isAddressChange(record) && String(draft.customerId) === String(record.customerId)) patch.address = record.address
    if (!persistHistoryRecord) window.dispatchEvent(new CustomEvent('pignus:sync-agenda-service', { detail: { record, patch: patch } }))
    update(patch)
  }
  const status = record.status || 'Pendiente'
  const setField = field => event => {
    const value = event.target.value
    const customer = field === 'customerId' ? customers.find(item => String(item.customerId) === String(value)) : null
    setDraft(previous => ({ ...previous, [field]: value, ...(customer ? { address: customer.address || '', phone: customer.phone || '' } : {}) }))
  }
  useEffect(() => {
    if (!can('service.documents.read') || (!record.technicalObservation && !record.technicalReportedAt)) return
    const grid = document.querySelector('.history-detail .history-detail-grid')
    if (!grid || grid.querySelector('.technician-report-detail')) return
    const report = document.createElement('div')
    report.className = 'detail-notes technician-report-detail'
    const title = document.createElement('b'); title.textContent = `${technicalReporter(record)} indicó · ${record.technicalStatus || 'Estado informado'}`
    const message = document.createElement('span'); message.textContent = record.technicalObservation || 'Servicio marcado como completado por el técnico.'
    report.append(title, message)
    if (record.technicalReportedAt) {
      const time = document.createElement('small')
      time.textContent = `Informado el ${prettyReportDateTime(record.technicalReportedAt)}`
      report.append(time)
    }
    grid.append(report)
    return () => report.remove()
  }, [record, editing, rescheduling])
  useEffect(() => {
    if (!can('vehicle.controls.read') || editing || !record.vehicleControl) return undefined
    const grid = document.querySelector('.history-detail .history-detail-grid')
    if (!grid || grid.querySelector('.vehicle-control-detail')) return undefined
    const detail = document.createElement('div')
    detail.className = 'detail-notes vehicle-control-detail'
    const title = document.createElement('b'); title.textContent = 'Control del vehículo'
    const mileage = document.createElement('span'); mileage.textContent = record.vehicleMileage != null ? `Kilometraje informado: ${Number(record.vehicleMileage).toLocaleString('es-AR')} km` : `Kilometraje al programar: ${Number(record.vehicleMileageAtScheduling || 0).toLocaleString('es-AR')} km`
    detail.append(title, mileage)
    if (record.vehiclePhotoUrl) { const photo = document.createElement('img'); photo.src = record.vehiclePhotoUrl; photo.alt = `Estado interior de ${record.client}`; photo.className = 'vehicle-control-history-photo'; detail.append(photo) }
    grid.append(detail)
    return () => detail.remove()
  }, [record, editing, rescheduling])
  useEffect(() => {
    if (!can('service.documents.read') || editing || record.vehicleControl || !servicePhotoUrl(record)) return undefined
    const grid = document.querySelector('.history-detail .history-detail-grid')
    if (!grid || grid.querySelector('.history-service-photo-detail')) return undefined
    const detail = document.createElement('div'); detail.className = 'detail-notes history-service-photo-detail'
    const title = document.createElement('b'); title.textContent = 'Foto de referencia del servicio'
    const link = document.createElement('a'); link.className = 'service-photo history-service-photo'; link.href = servicePhotoUrl(record); link.target = '_blank'; link.rel = 'noreferrer'; link.title = 'Abrir foto en tamaño completo'
    const photo = document.createElement('img'); photo.src = servicePhotoUrl(record); photo.alt = `Foto de referencia de ${record.client || 'servicio'}`; photo.onerror = () => detail.remove()
    link.append(photo); detail.append(title, link); grid.append(detail)
    return () => detail.remove()
  }, [record, editing, rescheduling])
  useEffect(() => {
    if (editing || !record.vehicleControl || record.status !== 'Pendiente') return undefined
    const button = [...document.querySelectorAll('.history-detail .history-actions button')].find(item => item.textContent.includes('Marcar completado'))
    if (!button) return undefined
    button.disabled = true
    button.title = 'Este control debe completarlo el técnico asignado con foto y kilometraje.'
    return () => { button.disabled = false; button.removeAttribute('title') }
  }, [record, editing, rescheduling])
  useEffect(() => {
    if (!pendingAction) return undefined
    const layer = document.createElement('div')
    layer.className = 'modal-layer history-action-confirmation'
    const modal = document.createElement('div'); modal.className = 'modal confirm-modal'
    const icon = document.createElement('span'); icon.className = `confirm-icon ${pendingAction.destructive ? 'danger' : ''}`; icon.textContent = pendingAction.icon
    const title = document.createElement('h2'); title.textContent = pendingAction.title
    const detail = document.createElement('p'); detail.textContent = pendingAction.detail
    const actions = document.createElement('div'); actions.className = 'confirm-actions'
    const cancel = document.createElement('button'); cancel.title = "Volvé al servicio sin aplicar el cambio de estado."; cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Volver'
    const confirm = document.createElement('button'); confirm.title = "Confirmá el cambio de estado del servicio indicado en este aviso."; confirm.type = 'button'; confirm.className = pendingAction.destructive ? 'danger-button' : 'primary'; confirm.textContent = pendingAction.confirmLabel
    cancel.onclick = () => setPendingAction(null)
    confirm.onclick = () => { const patch = pendingAction.patch; setPendingAction(null); update(patch) }
    actions.append(cancel, confirm); modal.append(icon, title, detail, actions); layer.append(modal)
    layer.onclick = event => { if (event.target === layer) setPendingAction(null) }
    document.body.append(layer)
    return () => layer.remove()
  }, [pendingAction])
  useEffect(() => {
    // Intercepta las acciones de estado antes de los manejadores legados para confirmar la decisión.
    const actions = document.querySelector('.history-detail .history-actions')
    if (!actions || editing) return undefined
    const intercept = event => {
      const button = event.target.closest('button')
      if (!button || button.classList.contains('delete-history')) return
      const text = button.textContent.trim().toLowerCase()
      let action = null
      if (text.includes('registrar avance')) action = { title: 'Registrar avance de la jornada', detail: 'Se cerrará esta visita, pero el servicio seguirá abierto hasta la última jornada.', confirmLabel: 'Registrar avance', icon: '✓', patch: { status: 'Avance registrado', scheduledDate: '' } }
      if (text.includes('marcar completado')) action = { title: 'Marcar servicio como completado', detail: '¿Confirmás que el servicio fue realizado?', confirmLabel: 'Sí, marcar completado', icon: '✓', patch: { status: 'Completado', scheduledDate: '' } }
      if (text.includes('marcar pendiente')) action = { title: 'Volver el servicio a pendiente', detail: '¿Confirmás que este servicio todavía no fue completado? Volverá a incluirse entre los trabajos pendientes.', confirmLabel: 'Sí, marcar pendiente', icon: '↶', patch: { status: 'Pendiente', scheduledDate: '', technicalStatus: '', technicalObservation: '', technicalReportedAt: '', completedAt: '' } }
      if (text.includes('cancelar servicio')) action = { title: 'Cancelar servicio', detail: '¿Confirmás la cancelación de este servicio?', confirmLabel: 'Sí, cancelar servicio', icon: '!', destructive: true, patch: { status: 'Cancelado', scheduledDate: '' } }
      if (!action) return
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      setPendingAction(action)
    }
    actions.addEventListener('click', intercept, true)
    return () => actions.removeEventListener('click', intercept, true)
  }, [editing, rescheduling, rescheduleDate, minimumRescheduleDate])
  if (correctingCompletion && canCorrectCompletion) return <ServiceCompletionCorrection record={record} close={() => setCorrectingCompletion(false)} onSave={(correction, base) => persistHistoryRecord(base, null, correction)} onSaved={close} />
  if (correctingCategory && canCorrectCategory) return <ServiceCategoryCorrection record={record} services={services} close={close} onSave={correction => persistHistoryRecord(record, null, correction)} />
  if (rescheduling && can('planning.reschedule')) return <HistoryRescheduleModal record={record} estimatedMinutes={serviceEstimateForTask(record, resolveServiceForTask(record, services))} scheduling={historyScheduling} minimumDate={minimumRescheduleDate} blocked={remotelyUpdated} onSaved={close} onCancel={() => setRescheduling(false)} />
return <><div className="modal-layer"><div className="modal detail-modal history-detail"><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="close-modal" disabled={saving} onClick={requestClose}><Icon name="close" /></button><p className="eyebrow">{prettyDate(record.date)} · {historyStatusLabel(record).toUpperCase()}</p><div className="history-detail-heading"><h2>{editing ? 'Editar servicio' : record.client}</h2>{canCorrectCategory ? <button type="button" className="secondary detail-edit" title="Corregí la categoría de este servicio sin modificar los demás datos." disabled={interactionBlocked} onClick={() => setCorrectingCategory(true)}><Icon name="edit" size={15} />Corregir categoría</button> : canEdit && !editing && (!completedRecord || record.subscriberReservation) && <button title='Habilitá la edición de los datos de este servicio.' className="secondary detail-edit" disabled={interactionBlocked} onClick={() => setEditing(true)}><Icon name="edit" size={15} />Editar datos</button>}</div>{historySaveError && <p className="field-error" role="alert">{historySaveError}</p>}{!editing && record.awaitingConfirmation === true && <div className="history-confirmation-actions"><p className="service-confirmation-label">(A CONFIRMAR)</p>{record.date < currentLocalDate() ? <p>El día del servicio ya pasó. Reprogramalo antes de confirmarlo.</p> : null}</div>}{record.subscriberReservation && <p className="history-reservation-notice"><Icon name="alert" size={17} />Esta es una reserva de nuevo abonado. Presioná Editar datos y vinculá el PIG importado; el turno, equipo y duración se conservarán.</p>}{can('records.contact') && record.reservationLinkedAt && <p className="history-reservation-linked"><Icon name="check" size={17} />Reserva vinculada el {prettyReportDateTime(record.reservationLinkedAt)}. Datos provisorios originales: {record.reservationOriginal?.name || 'sin nombre'} · {record.reservationOriginal?.address || 'sin dirección'} · {record.reservationOriginal?.phone || 'sin contacto'}.</p>}{editing ? <div className="history-edit-grid"><JourneyIdentityField record={record} customer><CustomerAutocomplete disabled={!can(record.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')} value={draft.client || record.client} customerId={draft.customerId} customers={customers} subscriberReservation={record.subscriberReservation} onCustomerSelect={customer => setDraft(previous => ({ ...previous, customerId: customer.customerId, client: `${customer.account} ${customer.name}`, address: customer.address || '', phone: customer.phone || '' }))} /></JourneyIdentityField><JourneyIdentityField record={record}><ServiceTypesField disabled={!can('history.edit')} task={draft} services={services} onChange={patch => setDraft(previous => ({ ...previous, ...patch }))} /></JourneyIdentityField>{record.vehicleControl ? <label>Tiempo estimado<input value="15 minutos" readOnly /></label> : <ServiceEstimatedDurationField disabled={!can('history.edit')} value={draft.estimatedMinutes} onChange={estimatedMinutes => setDraft(previous => ({ ...previous, estimatedMinutes, estimatedMinutesCustomized: true }))} />}<label>Equipo y técnicos<select disabled value={record.teamId || ''} aria-label="Equipo y técnicos asignados"><option value={record.teamId || ''}>{assignedTeamLabel}</option>{assignedDayTeams.filter(team => String(team.teamId) !== String(record.teamId)).map(team => <option key={team.teamId} value={team.teamId}>{team.label} · {team.members.join(' / ')}</option>)}</select><small>La asignación se conserva. Para elegir otro día, horario y equipo, utilizá Reprogramar.</small></label>{can('records.contact') && <label>{addressChange.isAddressChange(draft) ? 'Domicilio actual' : 'Dirección'}<input readOnly={Boolean(draft.customerId)} disabled={!can('history.edit')} value={draft.address} onChange={setField('address')} /></label>}{can('records.contact') && <label>Contacto<input readOnly={Boolean(draft.customerId)} disabled={!can('history.edit')} value={draft.phone} onChange={setField('phone')} /></label>}{can('records.contact') && <AddressChangeFields record={draft} disabled={!can('history.edit')} onChange={newAddress => setDraft(previous => ({ ...previous, newAddress }))} />}<label className="detail-notes">Detalle / observaciones<textarea disabled={!can('history.edit')} value={draft.detail} onChange={setField('detail')} /></label></div> : <div className="history-detail-grid"><div><b>Servicio</b><span>{serviceTypesLabel(record)}</span></div><div><b>Tiempo estimado</b><span>{durationLabel(serviceEstimateForTask(record, resolveServiceForTask(record, services)))}</span></div><div><b>Equipo</b><span>{record.team}</span></div><div><b>Técnicos asignados</b><span>{record.technicians?.join(' / ') || 'Sin técnicos asignados'}</span></div><div><b>Hora asignada</b><span>{record.time || record.scheduledTime || 'Sin horario'}</span></div>{record.completedAt && <div><b>Finalización real</b><span>{prettyReportDateTime(record.completedAt)}</span></div>}{can('records.contact') && <div><b>{addressChange.isAddressChange(record) ? 'Domicilio actual · retiro' : 'Dirección'}</b><span>{record.address || 'Sin dirección'}</span></div>}{can('records.contact') && <div><b>Contacto</b><span>{record.phone || 'Sin contacto'}</span></div>}{can('records.financial') && record.formEmail && <div><b>Email del formulario</b><span>{record.formEmail}</span></div>}<div className="detail-notes"><b>Detalle / observaciones</b><span>{record.detail || 'Sin observaciones'}</span></div></div>}{!editing && <>{can('records.contact') && <AddressChangeFields record={record} readOnly />}<RegistrationForms record={record} onBusyChange={setRegistrationBusy} /><ServiceCustomerMap record={record} customers={customers} /><Attachments key={record.id} entityId={record.id} /><JourneyHistory record={record} /></>}<InternalPreparationFields task={editing ? draft : record} readOnly={!editing} onChange={patch => setDraft(previous => ({ ...previous, ...patch }))} /><FollowupSummary record={record} />{canCorrectCompletion && <button type="button" className="primary" disabled={interactionBlocked} onClick={() => setCorrectingCompletion(true)} title="Corregí un resultado equivocado, confirmando los trabajos realizados y dejando el motivo.">Corregir resultado</button>}{editing ? <div className="history-actions"><button title="Guardá los datos modificados de este servicio." className="primary" disabled={interactionBlocked} onClick={saveChanges}><Icon name="check" />Guardar cambios</button><button title="Cancelá esta operación sin aplicar los cambios del formulario." className="secondary" disabled={interactionBlocked} onClick={cancelEditing}><Icon name="close" size={16} />Cancelar</button></div> : <div className="history-actions">{record.awaitingConfirmation === true && <ServiceConfirmationButton task={{ ...record, historyId: record.id }} day={record.date} history={[record]} disabled={interactionBlocked} persist={command => update({ awaitingConfirmation: command.awaitingConfirmation })} />}{(status === 'Pendiente' || (status === 'Avance registrado' && journeyReportType(record, journeyHistory) === 'Completado')) ? (can('history.complete') && !canCorrectCompletion && <button title="Registrá el avance de la jornada o la finalización del servicio, según corresponda." className="primary" disabled={interactionBlocked || !canComplete} onClick={() => update({ status: journeyReportType(record, journeyHistory), scheduledDate: '', ...(journeyReportType(record, journeyHistory) === 'Completado' ? { completedAt: new Date().toISOString() } : {}) })}><Icon name="check" />{journeyReportType(record, journeyHistory) === 'Avance registrado' ? 'Registrar avance' : 'Marcar completado'}</button>) : (can('history.reopen') && <button title="Volvé el servicio a pendiente y limpiá el estado, la observación técnica y la fecha de finalización actuales." className="pending-button" disabled={interactionBlocked} onClick={() => update({ status: 'Pendiente', scheduledDate: '', technicalStatus: '', technicalObservation: '', technicalReportedAt: '', completedAt: '' })}><Icon name="history" />Marcar pendiente</button>)}{can('history.cancel') && <button title="Cambiá el servicio a cancelado; se solicitará confirmar la acción." className="secondary" disabled={interactionBlocked} onClick={() => update({ status: 'Cancelado', scheduledDate: '' })}><Icon name="close" />Cancelar servicio</button>}{can('planning.reschedule') && <button title="Elegí una nueva fecha y un equipo disponible para reprogramar este servicio." className="secondary reschedule-trigger" aria-expanded={rescheduling} disabled={interactionBlocked || (rescheduling && Boolean(rescheduleDate) && !rescheduleReady)} onClick={() => { if (!rescheduling) setRescheduling(true); else if (rescheduleReady) { setRescheduleError(''); setReschedulePrompt('confirm') } }}><Icon name="calendar" />{saving && rescheduling ? 'Guardando…' : rescheduling && rescheduleDate ? 'Confirmar reprogramación' : 'Reprogramar'}</button>}{can('history.delete') && (!record.vehicleControl || can('vehicle.controls.delete')) && <button className="danger-button delete-history" disabled={interactionBlocked || Boolean(record.serviceJourney)} title={record.serviceJourney ? 'Cancelá esta jornada conservando su historial y las jornadas vinculadas.' : 'Solicitá eliminar este registro del historial; se pedirá confirmación.'} onClick={() => setConfirmDelete(true)}><Icon name="trash" />Eliminar registro</button>}</div>}{!editing && rescheduling && <div className="history-reschedule-fields"><label>Reprogramar para<input type="date" min={minimumRescheduleDate} disabled={interactionBlocked} value={rescheduleDate} onChange={event => { setRescheduleDate(event.target.value); setRescheduleTeam(''); setRescheduleError('') }} /></label><label>Hora<input type="time" disabled={interactionBlocked} value={rescheduleTime} onChange={event => { setRescheduleTime(event.target.value); setRescheduleTeam(''); setRescheduleError('') }} /></label><label>Equipo<select disabled={interactionBlocked || !rescheduleSlotComplete || !destinationTeams.length} value={selectedRescheduleTeam ? rescheduleTeam : ''} onChange={event => setRescheduleTeam(event.target.value)}><option value="">{rescheduleSlotComplete ? 'Seleccionar equipo disponible' : 'Completá día y hora'}</option>{destinationTeams.map(team => <option key={team.teamId} value={team.teamId}>{team.label} · {team.members.join(' / ')}</option>)}</select></label>{rescheduleDate === record.date && requiresDifferentRescheduleDay(record) && <p className="field-error">La reprogramación pendiente requiere una fecha distinta del día original.</p>}{rescheduleSlotComplete && !destinationTeams.length && <p className="field-error">No hay equipos disponibles para ese día, horario y duración del servicio. Elegí otro día u horario.</p>}{rescheduleError && <p className="field-error" role="alert">{rescheduleError}</p>}</div>}</div></div>{reschedulePrompt && <div className="modal-layer history-reschedule-confirmation"><section className="modal confirm-modal" role="dialog" aria-modal="true" aria-label={reschedulePrompt === 'leave' ? 'Reprogramación sin guardar' : 'Confirmar reprogramación'}><button title="Volvé al formulario para seguir editando sin descartar los cambios." className="close-modal" disabled={saving} onClick={() => setReschedulePrompt(null)} aria-label="Seguir editando"><Icon name="close" /></button><h2>{reschedulePrompt === 'leave' ? 'Reprogramación sin guardar' : 'Confirmar reprogramación'}</h2><p>{reschedulePrompt === 'leave' ? 'Cargaste datos de reprogramación que todavía no se guardaron. Podés confirmarlos, seguir editando o cancelar esta reprogramación y cerrar.' : 'Revisá el destino antes de confirmar el cambio del servicio.'}</p><p><b>{record.client}</b><br />Día: {rescheduleDate ? prettyDate(rescheduleDate) : 'Sin seleccionar'}<br />Hora: {rescheduleTime || 'Sin seleccionar'}<br />Equipo: {selectedRescheduleTeam ? `${selectedRescheduleTeam.label} · ${selectedRescheduleTeam.members.join(' / ')}` : 'Sin seleccionar'}</p>{!rescheduleReady && <p>Completá una fecha válida, hora y equipo para poder confirmar.</p>}{remotelyUpdated && <p role="alert">El servicio cambió desde otra sesión. Volvé y revisá su versión actual.</p>}{rescheduleError && <p className="field-error" role="alert">{rescheduleError}</p>}<div className="confirm-actions"><button title="Volvé al formulario para seguir editando sin descartar los cambios." className="secondary" disabled={saving} onClick={() => setReschedulePrompt(null)}><Icon name="edit" size={16} />Seguir editando</button>{reschedulePrompt === 'leave' && <button title="Cerrá la reprogramación sin aplicar una nueva fecha al servicio." className="danger-button" disabled={saving} onClick={close}><Icon name="close" size={16} />Cancelar reprogramación</button>}<button title="Confirmá la nueva fecha y el equipo elegidos para reprogramar el servicio." className="primary" disabled={interactionBlocked || !rescheduleReady} onClick={confirmReschedule}><Icon name="calendar" size={16} />{saving ? 'Guardando…' : 'Confirmar reprogramación'}</button></div></section></div>}{confirmDelete && can('history.delete') && <Confirm title="Eliminar registro" detail="¿Querés eliminar este servicio del historial? Esta acción no se puede deshacer." destructive action={remove} close={() => setConfirmDelete(false)} />}{discardDialog}</> }
