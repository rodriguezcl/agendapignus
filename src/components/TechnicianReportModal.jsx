import { useActionPermissions } from '../presentation/hooks/useActionPermissions.mjs'
import React, { useEffect, useRef, useState } from 'react'
import Attachments, { uploadAttachmentBatch } from './Attachments.jsx'
import Icon from './ui/Icon.jsx'
import RequiredLabel from '../presentation/components/forms/RequiredLabel.jsx'
import { captureCameraPhoto } from '../infrastructure/media/camera-capture.mjs'
import { compactVehiclePhoto } from '../infrastructure/media/image-upload.mjs'
import { requestJson } from '../infrastructure/http/json-request.mjs'
import { ticketDate, ticketNumber } from '../features/tickets/ticket-ui.mjs'
import './technician-report.css'
import workModel from '../../api/_lib/work-completion.cjs'
import './work-completion.css'
import alarmZoneModel from '../../api/_lib/alarm-zones.cjs'
import AlarmZonesEditor from './AlarmZonesEditor.jsx'
import '../features/followups/followups.css'

const attachmentUrl = (recordId, fileId) => `/api/attachments/service/${encodeURIComponent(String(recordId))}${fileId ? `/${encodeURIComponent(String(fileId))}` : ''}`
const supportedImage = file => /^image\/(jpeg|png|webp)$/.test(file?.mime || '')

export function TechnicalDuplicatePreview({ ticket }) {
  return <section className="followup-summary" aria-label="Detalle del caso seleccionado"><strong>{ticketNumber(ticket)} · {ticket.status}</strong><p><b>{ticket.title}</b></p><p>{ticket.priority} · Responsable: {ticket.assigneeName || 'Sin asignar'}</p>{(ticket.eventType || ticket.zone) && <p>{ticket.eventType}{ticket.zone && ` · Zona: ${ticket.zone}`}</p>}{ticket.description && <p style={{ whiteSpace: 'pre-wrap' }}>{ticket.description}</p>}
    {(ticket.messages || []).filter(message => message.visibility !== 'internal').map((message, index) => <div key={message.id || index}><small><b>{message.byName || message.authorName || 'Solicitante'}</b> · {ticketDate(message.at || message.createdAt)}</small><p style={{ whiteSpace: 'pre-wrap' }}>{message.body || message.text}</p></div>)}
  </section>
}

export default function TechnicianReportModal({ record, type, serviceLabel, initialAlarmZones, pendingAttachments = [], onPendingAttachmentsChange, attachmentsPreparing = false, onPreparingChange, onClose, onSubmit }) {
  const { can } = useActionPermissions()
  const workTypes = workModel.typesFor(record)
  const perWork = type === 'Completado' && !record.vehicleControl && workTypes.length > 1
  const [workResults, setWorkResults] = useState(() => workTypes.map(t => ({ id: t.id, status: '' })))
  const hasPendingWork = perWork && workResults.some(r => r.status === 'pending')
  const workValid = !perWork || workResults.every(r => ['completed','pending'].includes(r.status))
  const completedTypes = perWork ? workTypes.filter(t => workResults.some(r => String(r.id) === String(t.id) && r.status === 'completed')) : workTypes
  const zoneRecord = perWork ? { ...record, service: '', serviceTypes: completedTypes } : record
  const [needsFollowup, setNeedsFollowup] = useState(false)
  const [followupType, setFollowupType] = useState('Cotizar adicional')
  const [followupDescription, setFollowupDescription] = useState('')
  const automaticFollowup = useRef(false)
  useEffect(() => {
    if (!hasPendingWork) { if (automaticFollowup.current) { setNeedsFollowup(false); setFollowupDescription(''); automaticFollowup.current = false } return }
    setComplaintResolved(false)
    if (can('tickets.fromService') && !record.followup && !record.hasFollowup && !needsFollowup) { automaticFollowup.current = true; setNeedsFollowup(true); setFollowupType('Coordinar visita'); setFollowupDescription(previous => previous || 'Quedaron pendientes: ' + workTypes.filter(t => workResults.some(r => String(r.id) === String(t.id) && r.status === 'pending')).map(t => t.name).join(', ')) }
  }, [hasPendingWork])
  const [linkedTickets, setLinkedTickets] = useState([])
  const [linkedTicketsLoading, setLinkedTicketsLoading] = useState(false)
  const [linkedTicketsError, setLinkedTicketsError] = useState('')
  const [linkedTicketsRetry, setLinkedTicketsRetry] = useState(0)
  const [complaintResolved, setComplaintResolved] = useState(false)
  const checkLinkedTickets = type === 'Completado' && !record.vehicleControl && can('tickets.view')
  useEffect(() => {
    if (!checkLinkedTickets) return
    let active = true
    setLinkedTicketsLoading(true); setLinkedTicketsError('')
    requestJson('/api/tickets?' + new URLSearchParams({ view: 'list', serviceId: String(record.id), status: 'open' }))
      .then(data => { if (active) setLinkedTickets((data.items || []).filter(ticket => !['Resuelto', 'Fusionado'].includes(ticket.status))) })
      .catch(error => { if (active) setLinkedTicketsError(error.message || 'No se pudieron consultar los tickets vinculados.') })
      .finally(() => { if (active) setLinkedTicketsLoading(false) })
    return () => { active = false }
  }, [checkLinkedTickets, record.id, linkedTicketsRetry])
  const hasLinkedComplaint = Boolean(linkedTickets.length || record.sourceTicketId && (!checkLinkedTickets || linkedTicketsLoading || linkedTicketsError))
  const [ticketCandidates,setTicketCandidates]=useState([]), [ticketChoice,setTicketChoice]=useState(''), [ticketChecking,setTicketChecking]=useState(false), [ticketError,setTicketError]=useState(''), [ticketRetry,setTicketRetry]=useState(0), [duplicateToken,setDuplicateToken]=useState(''), [checkedTicketContext,setCheckedTicketContext]=useState('')
  const ticketContext = JSON.stringify([String(record.customerId || ''), String(record.id)])
  const ticketContextPending = Boolean(needsFollowup && record.id && checkedTicketContext !== ticketContext)
  useEffect(() => {
    setTicketCandidates([]); setTicketChoice(''); setDuplicateToken(''); setCheckedTicketContext(''); setTicketError('')
    if (!needsFollowup || !record.id) { setTicketChecking(false); return }
    let active = true; setTicketChecking(true)
    requestJson('/api/tickets?' + new URLSearchParams({ view: 'duplicates', customerId: String(record.customerId || ''), serviceId: String(record.id) }))
      .then(data => { if (active) { setTicketCandidates(data.candidates || []); setDuplicateToken(data.duplicateToken || ''); setCheckedTicketContext(ticketContext) } })
      .catch(failure => { if (active) setTicketError(failure.message) }).finally(() => { if (active) setTicketChecking(false) })
    return () => { active = false }
  }, [needsFollowup, record.customerId, record.id, ticketContext, ticketRetry])
  const followupCandidates = [...new Map([...ticketCandidates, ...linkedTickets].map(ticket => [String(ticket.id), ticket])).values()]
  useEffect(() => { if (needsFollowup && ticketChoice !== 'different') setComplaintResolved(false) }, [needsFollowup, ticketChoice])
  const [ticketPreview,setTicketPreview]=useState(null), [previewLoading,setPreviewLoading]=useState(false), [previewError,setPreviewError]=useState(''), [previewRetry,setPreviewRetry]=useState(0), [previewContext,setPreviewContext]=useState('')
  const selectedTicketContext = JSON.stringify([ticketChoice, ticketContext])
  useEffect(() => {
    setTicketPreview(null); setPreviewError(''); setPreviewContext('')
    if (!ticketChoice || ticketChoice === 'different' || ticketContextPending) { setPreviewLoading(false); return }
    let active = true; setPreviewLoading(true)
    requestJson('/api/tickets?' + new URLSearchParams({ view: 'duplicateDetail', id: ticketChoice, customerId: String(record.customerId || ''), serviceId: String(record.id) }))
      .then(data => { if (active) { setTicketPreview(data.ticket); setPreviewContext(selectedTicketContext) } }).catch(failure => { if (active) setPreviewError(failure.message) }).finally(() => { if (active) setPreviewLoading(false) })
    return () => { active = false }
  }, [ticketChoice, record.customerId, record.id, ticketContextPending, selectedTicketContext, previewRetry])
  const vehicleControl = Boolean(record.vehicleControl && type === 'Completado')
  const needsZones = alarmZoneModel.installation(zoneRecord) && ['Completado', 'Avance registrado'].includes(type)
  const [alarmZones, setAlarmZones] = useState(() => initialAlarmZones || alarmZoneModel.initialZones(record))
  const [zonesDirty, setZonesDirty] = useState(false)
  let zonesValid = true
  if (needsZones) { try { alarmZoneModel.validateZones(alarmZones, type === 'Completado') } catch { zonesValid = false } }
  const [observation, setObservation] = useState('')
  const [mileage, setMileage] = useState('')
  const [photo, setPhoto] = useState('')
  const [photoSource, setPhotoSource] = useState('')
  const [choosingPhoto, setChoosingPhoto] = useState(true)
  const [savedPhotos, setSavedPhotos] = useState([])
  const [photoLoading, setPhotoLoading] = useState(vehicleControl)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoRetry, setPhotoRetry] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const alive = useRef(true)
  const photoRequestRef = useRef(null)
  const pendingRef = useRef(pendingAttachments)
  pendingRef.current = pendingAttachments
  const dirty = Boolean(workResults.some(r => r.status) || zonesDirty || needsFollowup || complaintResolved || observation.trim() || mileage || photo || pendingAttachments.length)
  const busy = saving || photoBusy || attachmentsPreparing
  const valid = vehicleControl
    ? Boolean(photo) && /^\d+$/.test(mileage) && Number(mileage) > Number(record.vehicleMileageAtScheduling || 0)
    : workValid && zonesValid && Boolean(observation.trim()) && !linkedTicketsLoading && (!needsFollowup || Boolean(followupDescription.trim()) && !ticketChecking && !ticketContextPending && !ticketError && (!(followupCandidates.length || hasLinkedComplaint) || Boolean(ticketChoice)) && (!ticketChoice || ticketChoice === 'different' || Boolean(ticketPreview) && !previewLoading && !previewError && previewContext === selectedTicketContext))
  const requestClose = () => { if (!busy) dirty ? setDiscarding(true) : onClose() }

  useEffect(() => { alive.current = true; return () => { alive.current = false; photoRequestRef.current?.abort() } }, [])
  useEffect(() => {
    if (!dirty) return undefined
    const preventLoss = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [dirty])
  useEffect(() => {
    if (!vehicleControl) return undefined
    let current = true
    setPhotoLoading(true)
    requestJson(attachmentUrl(record.id)).then(result => {
      if (current) setSavedPhotos((result.attachments || []).filter(supportedImage))
    }).catch(() => {
      if (current) setPhotoError('No pudimos consultar las fotos guardadas. Podés reintentar o tomar una nueva.')
    }).finally(() => { if (current) setPhotoLoading(false) })
    return () => { current = false }
  }, [record.id, vehicleControl, photoRetry])

  const chooseSavedPhoto = async file => {
    if (busy) return
    setPhotoBusy(true); setPhotoError('')
    const controller = new AbortController()
    photoRequestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(attachmentUrl(record.id, file.id), { credentials: 'same-origin', signal: controller.signal })
      if (!response.ok) throw new Error('No pudimos abrir esa foto. Reintentá o tomá una nueva.')
      const data = await compactVehiclePhoto(await response.blob())
      if (alive.current) { setPhoto(data); setPhotoSource('Foto guardada de este control'); setChoosingPhoto(false) }
    } catch (failure) {
      if (alive.current) setPhotoError(failure.name === 'AbortError' ? 'La descarga de la foto demoró demasiado. Revisá la conexión y reintentá, o tomá una nueva.' : failure.message)
    } finally {
      window.clearTimeout(timeout)
      if (photoRequestRef.current === controller) photoRequestRef.current = null
      if (alive.current) setPhotoBusy(false)
    }
  }
  const capturePhoto = async () => {
    if (busy) return
    setPhotoBusy(true); setPhotoError('')
    try {
      const file = await captureCameraPhoto()
      if (!file) return
      const data = await compactVehiclePhoto(file)
      if (alive.current) { setPhoto(data); setPhotoSource('Nueva captura'); setChoosingPhoto(false) }
    } catch (failure) { if (alive.current) setPhotoError(failure.message) }
    finally { if (alive.current) setPhotoBusy(false) }
  }
  const save = async () => {
    if (savingRef.current || !valid || busy) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      // A failed upload leaves the unsaved selection intact. A successful one is
      // removed immediately so retrying the status does not upload it twice.
      await uploadAttachmentBatch('service', record.id, [...pendingRef.current], savedId => {
        pendingRef.current = pendingRef.current.filter(file => file.id !== savedId)
        onPendingAttachmentsChange(pendingRef.current)
      })
      await onSubmit({ observation, ...(perWork ? { workResults } : {}), vehicleMileage: mileage, vehiclePhoto: photo,
        ...(needsZones ? { alarmZones } : {}),
        ...(type === 'Completado' && hasLinkedComplaint ? { ticketResolution: { resolved: !hasPendingWork && complaintResolved && (!needsFollowup || ticketChoice === 'different') && !linkedTicketsError, ticketIds: linkedTickets.length ? linkedTickets.map(ticket => String(ticket.id)) : [String(record.sourceTicketId)].filter(Boolean) } } : {}),
        ...(needsFollowup ? { followup: { type: followupType, description: followupDescription, duplicateToken, relatedTicketId: ticketChoice === 'different' ? '' : ticketChoice, ...(ticketChoice && ticketChoice !== 'different' ? { relatedTicketVersion: ticketPreview.version } : {}), ...(ticketChoice === 'different' ? { relation: 'different' } : {}) } } : {}) })
    } catch (failure) {
      if (alive.current && failure.status === 409 && needsFollowup) { setTicketRetry(value => value + 1); setConfirming(false); setTicketChoice('') }
      if (alive.current) setError(failure.message || 'No se pudo guardar el informe. Los datos siguen disponibles para reintentar.')
    } finally {
      savingRef.current = false
      if (alive.current) setSaving(false)
    }
  }
  const pendingPhotos = pendingAttachments.filter(file => file.source === 'camera' && file.data?.startsWith('data:image/'))

  return <>
    <div className="modal-layer" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) requestClose() }}>
      <section className="modal technician-status-modal" role="dialog" aria-modal="true" aria-label="Informar servicio" aria-busy={busy}>
        <button type="button" className="close-modal" aria-label="Cerrar informe" title="Cerrá el informe; si hay cambios pendientes, podrás conservarlos o descartarlos." disabled={busy} onClick={requestClose}><Icon name="close" /></button>
        <p className="eyebrow">ACTUALIZAR SERVICIO</p><h2>{perWork ? 'Resultado de la visita' : type === 'Avance registrado' ? 'Registrar avance de la jornada' : type}</h2>
        <p>{record.client} · {serviceLabel}</p>
        {vehicleControl ? <>
          <p className="vehicle-control-report-help">Informá el kilometraje y elegí una foto del interior. Podés usar una foto de este control o tomar una nueva.</p>
          <div className="vehicle-control-report-fields">
            <label><RequiredLabel>Kilometraje actualizado</RequiredLabel><input type="number" required inputMode="numeric" min={Number(record.vehicleMileageAtScheduling || 0) + 1} step="1" value={mileage} disabled={saving} onChange={event => setMileage(event.target.value)} placeholder={`Mayor a ${Number(record.vehicleMileageAtScheduling || 0).toLocaleString('es-AR')} km`} /></label>
            <fieldset className="vehicle-report-photo"><legend><RequiredLabel>Foto del interior</RequiredLabel></legend>
              {photo && <div className="vehicle-report-selected"><img className="vehicle-control-photo-preview" src={photo} alt="Foto del interior elegida para el control" /><small>Foto elegida: {photoSource}</small></div>}
              {photo && !choosingPhoto && (pendingPhotos.length > 0 || savedPhotos.length > 0) && <button type="button" title="Revisá las capturas de este control y elegí otra foto para el informe." className="secondary vehicle-report-change-photo" disabled={busy} onClick={() => setChoosingPhoto(true)}>Elegir otra foto del control</button>}
              {choosingPhoto && (pendingPhotos.length > 0 || savedPhotos.length > 0) && <div className="vehicle-report-photo-options" aria-label="Fotos disponibles para este control">
                {pendingPhotos.map(file => <button key={file.id} type="button" title="Usá esta captura pendiente como foto del control; se guardará al confirmar el informe." disabled={busy} className="vehicle-report-photo-option" onClick={() => { setPhoto(file.data); setPhotoSource('Captura pendiente de este control'); setChoosingPhoto(false); setPhotoError('') }}><img src={file.data} alt="" /><span>Usar captura pendiente</span></button>)}
                {savedPhotos.map(file => <button key={file.id} type="button" title="Usá esta foto ya guardada en el mismo control vehicular, sin repetir la captura." disabled={busy} className="vehicle-report-photo-option" onClick={() => chooseSavedPhoto(file)}><img src={attachmentUrl(record.id, file.id)} alt="" loading="lazy" /><span>Usar foto guardada</span></button>)}
              </div>}
              {photoLoading && <p role="status">Consultando fotos de este control…</p>}
              <button type="button" title="Abrí la cámara para fotografiar el interior del vehículo en este control." className="secondary" disabled={busy} onClick={capturePhoto}><Icon name="camera" />{photo ? 'Tomar otra foto' : 'Abrir cámara'}</button>
              {photoBusy && <p role="status">Preparando foto…</p>}
              {photoError && <p className="field-error" role="alert">{photoError} <button type="button" title="Volvé a consultar las fotos guardadas de este control cuando recuperes la conexión." disabled={busy} onClick={() => { setPhotoError(''); setPhotoRetry(value => value + 1) }}>Reintentar fotos guardadas</button></p>}
            </fieldset>
          </div>
        </> : <>
          {perWork && <fieldset className="work-completion-fields"><legend>Resultado de cada trabajo</legend><p>Indicá qué se realizó. Los trabajos pendientes no se marcarán como completados.</p>{workTypes.map(t => <label key={t.id}>{t.name}<select required disabled={busy} value={workResults.find(r => String(r.id) === String(t.id))?.status || ''} onChange={e => setWorkResults(rows => rows.map(r => String(r.id) === String(t.id) ? { ...r, status: e.target.value } : r))}><option value="">Seleccionar resultado</option><option value="completed">Realizado</option><option value="pending">Quedó pendiente</option></select></label>)}{hasPendingWork && <p role="status">Detallá el motivo en la observación. Administración recibirá el pendiente para coordinarlo. El importe se ajustará según los trabajos realizados; si no está desglosado, quedará en revisión.</p>}</fieldset>}
          {needsZones && <AlarmZonesEditor value={alarmZones} onChange={value => { setAlarmZones(value); setZonesDirty(true) }} disabled={saving} complete={type === 'Completado'} />}
          <label><RequiredLabel>Observación</RequiredLabel><textarea required value={observation} disabled={saving} onChange={event => setObservation(event.target.value)} placeholder="Detallá el trabajo realizado, el resultado y cualquier recomendación para futuras visitas." /></label>
          {linkedTicketsLoading && <p role="status">Consultando el reclamo asociado…</p>}
          {linkedTicketsError && <p className="field-error" role="alert">{linkedTicketsError} El informe se puede guardar; el ticket quedará pendiente de revisión. <button type="button" className="secondary" title="Volvé a consultar los tickets asociados a este servicio." disabled={busy} onClick={() => setLinkedTicketsRetry(value => value + 1)}>Reintentar</button></p>}
          {type === 'Completado' && hasLinkedComplaint && <fieldset className="followup-request"><legend>Resultado del reclamo</legend>
            <p>{linkedTickets.length ? linkedTickets.map(ticket => ticket.displayNumber || `Ticket#${ticket.number}`).join(' · ') : `Ticket#${record.ticketNumber || 'asociado'}`}</p>
            <label><input type="checkbox" checked={complaintResolved} disabled={hasPendingWork || busy || linkedTicketsLoading || Boolean(linkedTicketsError) || (needsFollowup && ticketChoice !== 'different')} onChange={event => setComplaintResolved(event.target.checked)} />El reclamo asociado quedó resuelto</label>
            <small>Confirmalo únicamente si se resolvió el inconveniente. El ticket se cerrará cuando no queden visitas ni acciones pendientes del mismo caso.</small>
            {needsFollowup && ticketChoice !== 'different' && <p>El seguimiento pendiente mantiene abierto el reclamo. Si es otro pedido, identificá que se trata de un caso diferente.</p>}
          </fieldset>}
          {can('tickets.fromService') && !record.followup && !record.hasFollowup && <fieldset className="followup-request"><legend>Acciones posteriores</legend><label><input type="checkbox" checked={needsFollowup} disabled={saving || hasPendingWork} onChange={event => setNeedsFollowup(event.target.checked)} />Solicitar acción / seguimiento</label><small>Agrega información a un caso abierto o crea un ticket vinculado a este servicio.</small>{needsFollowup && <>
            {ticketChecking && <p role="status">Consultando tickets abiertos…</p>}{ticketError && <p role="alert" className="field-error">{ticketError} <button type="button" className="secondary" disabled={busy} onClick={() => setTicketRetry(value => value + 1)}>Reintentar consulta</button></p>}
            {!ticketContextPending && Boolean(followupCandidates.length || hasLinkedComplaint) && <label>Ya existen tickets abiertos: revisá si corresponden al mismo caso<select required value={ticketChoice} disabled={busy || ticketChecking} onChange={event=>setTicketChoice(event.target.value)}><option value="">Seleccionar</option>{followupCandidates.map(item=><option key={item.id} value={item.id}>{ticketNumber(item)} · {item.title}</option>)}<option value="different">Es un caso diferente: crear otro ticket</option></select><small>Si es el mismo problema, tu información se sumará al caso y podrás seguir su atención. Si es otro motivo, creá una solicitud nueva.</small></label>}
            {previewLoading && <p role="status">Consultando información del caso…</p>}{previewError && <p role="alert" className="field-error">{previewError} <button type="button" className="secondary" disabled={busy} onClick={() => setPreviewRetry(value => value + 1)}>Reintentar detalle</button><button type="button" className="secondary" disabled={busy} onClick={() => setTicketRetry(value => value + 1)}>Actualizar casos abiertos</button></p>}
            {ticketPreview && previewContext === selectedTicketContext && !ticketContextPending && <TechnicalDuplicatePreview ticket={ticketPreview} />}
            <label>Tipo de solicitud<select value={followupType} disabled={saving} onChange={event => { automaticFollowup.current = false; setFollowupType(event.target.value) }}>{['Cotizar adicional', 'Coordinar visita', 'Gestionar problema', 'Otra acción'].map(type => <option key={type}>{type}</option>)}</select></label><label>Acción solicitada<textarea required maxLength={2000} value={followupDescription} disabled={saving} onChange={event => { automaticFollowup.current = false; setFollowupDescription(event.target.value) }} placeholder="Por ejemplo: cotizar dos cámaras adicionales para el patio." /></label></>}</fieldset>}
          <Attachments entityId={record.id} pendingFiles={pendingAttachments} onPendingFilesChange={onPendingAttachmentsChange} onPreparingChange={onPreparingChange} disabled={saving} />
        </>}
        {pendingAttachments.length > 0 && <p className="technician-report-pending" role="status">Se guardarán {pendingAttachments.length} adjunto(s) pendiente(s) junto con el informe.</p>}
        {error && !confirming && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" title="Cerrá el informe; si hay cambios pendientes, podrás conservarlos o descartarlos." className="secondary" disabled={busy} onClick={requestClose}>Cancelar</button><button type="button" title="Revisá la confirmación antes de guardar el informe y actualizar el estado del servicio." className="primary" disabled={!valid || busy} onClick={() => { setError(''); setConfirming(true) }}>Continuar</button></div>
      </section>
    </div>
    {confirming && <div className="modal-layer technician-report-confirmation"><section className="modal confirm-modal" role="dialog" aria-modal="true" aria-label="Confirmar estado"><h2>Confirmar estado</h2><p>{hasPendingWork ? `Se registrarán ${completedTypes.length} trabajo(s) realizado(s) y ${workResults.filter(r => r.status === 'pending').length} pendiente(s). Los pendientes requerirán coordinación; la cobranza se ajustará o quedará en revisión.` : `¿Confirmás que querés informar “${type}”? Luego quedará registrado y cualquier cambio deberá ser revisado por Administración.`}</p>{error && <p className="field-error" role="alert">{error}</p>}<div className="confirm-actions"><button type="button" title="Volvé a revisar o corregir los datos sin perder el informe que estás preparando." className="secondary" disabled={saving} onClick={() => setConfirming(false)}>Volver al informe</button><button type="button" title="Guardá los adjuntos pendientes y luego registrá el informe y el estado del servicio." className="primary" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Sí, confirmar estado'}</button></div></section></div>}
    {discarding && <div className="modal-layer technician-report-discard"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Informe sin guardar"><h2>Informe sin guardar</h2><p>El informe y los adjuntos pendientes todavía no se guardaron. ¿Querés seguir editando o descartarlos? Las fotos ya guardadas se conservan.</p><div className="confirm-actions"><button type="button" title="Conservá todos los datos y adjuntos pendientes para continuar preparando el informe." className="secondary" onClick={() => setDiscarding(false)}>Seguir editando</button><button type="button" title="Descartá este borrador y los adjuntos pendientes; las fotos ya guardadas se conservan." className="danger-button" onClick={() => { onPendingAttachmentsChange([]); onClose() }}>Descartar informe</button></div></section></div>}
  </>
}
