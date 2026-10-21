import { isGranular } from '../../../domain/access/permissions.mjs'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { canReadRecord, canWriteRecord } from '../../../domain/access/record-scope.mjs'
import FollowupSummary from '../../followups/FollowupSummary.jsx'
import Followups from '../../followups/Followups.jsx'
import React, { useState, useRef, useEffect, Suspense, lazy } from "react";
import { TechnicianPortalErrorBoundary } from "../../../presentation/components/TechnicianPortalErrorBoundary.jsx";
import { fetchWithTimeout } from "../../../infrastructure/http/fetch-timeout.mjs";
import { currentLocalDate, prettyDate } from "../../../presentation/formatting.mjs";
import { technicianRecordResolved, technicianAgendaServices, filterTechnicianHistory, overdueVehicleControls, technicianTeamLabel, blockingOverdueVehicleControl, technicianAgendaGroups } from "../../../domain/technicians/technician-history.mjs";
import { setVehicleControlAssignedRecords, vehicleControlIsOpen, vehicleControlWindowLabel } from "../../../domain/vehicles/vehicle-control-window.mjs";
import { servicePhotoUrl } from "../../attachments/application/service-photo.mjs";
import { manageDrawerFocus } from "../../../infrastructure/browser/drawer-focus.mjs";
import { vehicleLabel } from "../../../domain/vehicles/vehicle-controls.mjs";
import { serviceHasStarted } from "../../../domain/agenda/service-start.mjs";
import { serviceDirections } from "../../../domain/customers/customer-location.mjs";
import Icon, { createIconElement } from "../../../components/ui/Icon.jsx";
import { startTechnicianService } from "../../../infrastructure/http/technician-start.mjs";
import { prettyReportDateTime } from "../../agenda/application/agenda-model.mjs";
import { isAdvanceRequestActive } from "../../../domain/agenda/advance-request-active.mjs";
import { submitTechnicianStatus } from "../../../infrastructure/http/technician-status.mjs";
import RefreshButton from "../../../components/ui/RefreshButton.jsx";
import SystemState from "../../../components/ui/SystemState.jsx";
import { Confirm } from "../../../presentation/components/Confirm.jsx";
import VehicleInsuranceDownload from "../../../components/VehicleInsuranceDownload.jsx";
import Attachments from "../../../components/Attachments.jsx";
import { technicianVisibleServiceExtras, formatCurrencyAmount } from "../../services/application/service-fields.mjs";
import { serviceTypesLabel } from "../../../domain/services/multi-service.mjs";
import { journeyLabel, journeyReportType } from "../../../components/ServiceJourneys.jsx";
import TechnicianServiceMap from "../../../components/TechnicianServiceMap.jsx";
import { technicianCrewLabel } from "../../../domain/agenda/technician-crew-label.mjs";
import ReschedulingHistory from "../../../components/ReschedulingHistory.jsx";
import TechnicianReportModal from "../../../components/TechnicianReportModal.jsx";
import { CustomerServiceHistory } from "../../customers/presentation/CustomerServiceHistory.jsx";
import { serviceAdvanceRepository } from "../../../infrastructure/repositories/service-advance-repository.mjs";

export const TechnicianHelpCenter = lazy(() => import('../../../HelpCenter.jsx').then(module => ({ default: module.TechnicianHelpCenter })))

export function showAdvanceRequestConfirmation(record, onRequested) {
  const layer = document.createElement('div'); layer.className = 'modal-layer'; layer.setAttribute('role', 'presentation')
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Confirmar inicio anticipado')
  const icon = document.createElement('span'); icon.className = 'confirm-icon'; icon.textContent = '↥'
  const title = document.createElement('h2'); title.textContent = 'Adelantar servicio'
  const detail = document.createElement('p'); detail.textContent = `¿Querés iniciar ahora el servicio de ${record.client}? Se registrará la hora real de inicio. El horario original es ${record.time || record.scheduledTime}.`
  const error = document.createElement('div'); error.className = 'notice confirm-error'; error.hidden = true; error.setAttribute('role', 'alert')
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const cancel = document.createElement('button'); cancel.title = "Volvé sin iniciar el servicio."; cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Cancelar'
  const confirm = document.createElement('button'); confirm.title = "Confirmá el inicio anticipado del servicio."; confirm.type = 'button'; confirm.className = 'primary'; confirm.textContent = 'Adelantar e iniciar'
  const close = () => layer.remove()
  cancel.onclick = close
  confirm.onclick = async () => {
    confirm.disabled = true; cancel.disabled = true; confirm.textContent = 'Enviando…'; error.hidden = true
    try {
      const data = await serviceAdvanceRepository.request(record.id)
      await onRequested(data.record)
      close()
    } catch (requestError) {
      error.textContent = requestError.message || 'No se pudo enviar la solicitud.'
      error.hidden = false; confirm.disabled = false; cancel.disabled = false; confirm.textContent = 'Adelantar e iniciar'
    }
  }
  layer.addEventListener('mousedown', event => { if (event.target === layer) close() })
  const escape = event => { if (event.key === 'Escape') { close(); document.removeEventListener('keydown', escape) } }
  document.addEventListener('keydown', escape)
  const observer = new MutationObserver(() => { if (!layer.isConnected) { document.removeEventListener('keydown', escape); observer.disconnect() } })
  observer.observe(document.body, { childList: true })
  actions.append(cancel, confirm); modal.append(icon, title, detail, error, actions); layer.append(modal); document.body.append(layer)
}

export function PersonalTechnicalServices({ user, logout, sessionInvalidated, onBack }) {
  // Keep technical snapshots isolated from management autosave and permissions.
  const [history, setHistory] = useState([])
  const [vehicles, setVehicles] = useState([])
  return <TechnicianPortalErrorBoundary logout={logout}><TechnicianPortal {...{ user, history, setHistory, vehicles, setVehicles, logout, sessionInvalidated, onBack }} /></TechnicianPortalErrorBoundary>
}

export async function loadPersonalTechnicalState(revision, day) {
  const response = await fetchWithTimeout('/api/technician/state' + (revision == null ? '' : `?${new URLSearchParams({ revision: String(revision), day })}`), { credentials: 'same-origin' })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudieron cargar los servicios.'), { status: response.status })
  return data
}

export function TechnicianPortal({ user, history, setHistory, vehicles = [], setVehicles, logout, sessionInvalidated, onBack }) {
  const { can, user: permissionUser } = usePermissions()
  const permissionSubject = permissionUser || user
  const canViewVehicles = can('vehicle.insurance.read') || can('vehicle.documents.read')
  const canReport = (record, type) => canWriteRecord(record, permissionSubject) && can(record.vehicleControl ? 'technical.vehicleControl' : type === 'Avance registrado' ? 'technical.progress' : type === 'Cancelado' ? 'technical.cancel' : type === 'Reprogramación solicitada' ? 'technical.reschedule' : 'technical.complete')
  const [draft, setDraft] = useState(null)
  const [attachmentDrafts, setAttachmentDrafts] = useState({})
  const [attachmentsPreparing, setAttachmentsPreparing] = useState({})
  const updateAttachments = (recordId, files) => setAttachmentDrafts(previous => ({ ...previous, [recordId]: files }))
  const updatePreparing = (recordId, preparing) => setAttachmentsPreparing(previous => ({ ...previous, [recordId]: Math.max(0, (previous[recordId] || 0) + (preparing ? 1 : -1)) }))
  const hasPendingAttachments = Object.values(attachmentDrafts).some(files => files.length > 0)
  const attachmentOperationsBusy = Object.values(attachmentsPreparing).some(count => count > 0)
  const [confirm, setConfirm] = useState(null)
  const [view, setView] = useState('agenda')
  const [menuOpen, setMenuOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [customerHistoryRecord, setCustomerHistoryRecord] = useState(null)
  const [clock, setClock] = useState(Date.now())
  const [connectionStatus, setConnectionStatus] = useState(() => navigator.onLine ? 'online' : 'offline')
  const expandedServiceCardsRef = useRef(new Set())
  const today = currentLocalDate()
  const resolved = technicianRecordResolved
  const directChildWithClass = (element, className) => Array.from(element?.children || []).find(child => child.classList.contains(className)) || null
  const assignedServices = history.filter(record => canReadRecord(record, permissionSubject) && can(record.vehicleControl ? 'vehicle.controls.read' : 'records.read') && record.technicianIds?.some(id => String(id) === String(user.id))).sort((a, b) => `${a.date}-${a.time || ''}`.localeCompare(`${b.date}-${b.time || ''}`))
  setVehicleControlAssignedRecords(assignedServices)
  const completedServices = assignedServices.filter(resolved).reverse()
  const services = view === 'agenda' ? technicianAgendaServices(assignedServices, today) : view === 'history' && can('technical.history') ? filterTechnicianHistory(completedServices, historySearch) : []
  useEffect(() => {
    if (!hasPendingAttachments && !attachmentOperationsBusy) return undefined
    const preventLoss = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [hasPendingAttachments, attachmentOperationsBusy])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelectorAll('.technician-service').forEach((card, index) => {
        const record = services[index]
        const url = can('service.documents.read') ? servicePhotoUrl(record) : ''
        card.querySelector('.technician-service-photo')?.remove()
        if (!url) return
        const link = document.createElement('a'); link.className = 'service-photo technician-service-photo'; link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; link.title = 'Abrir foto de referencia'
        const photo = document.createElement('img'); photo.src = url; photo.alt = `Foto de referencia de ${record.client || 'servicio'}`; photo.onerror = () => link.remove()
        link.append(photo)
        const anchor = card.querySelector('.technician-started-status, .technician-quick-actions') || card.querySelector('.tech-client')
        anchor?.insertAdjacentElement('afterend', link)
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [services.map(record => `${record.id}:${record.servicePhotoAttachedAt || ''}`).join('|')])
  useEffect(() => {
    const refreshClock = () => setClock(Date.now())
    const interval = window.setInterval(refreshClock, 30000)
    window.addEventListener('focus', refreshClock)
    document.addEventListener('visibilitychange', refreshClock)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshClock); document.removeEventListener('visibilitychange', refreshClock) }
  }, [])
  useEffect(() => {
    // Todos los integrantes de un equipo consultan el mismo registro compartido.
    // Así, al informar un estado un compañero, se retira o actualiza para los demás.
    let refreshing = false
    let stopped = false
    let loadedRevision = null
    let loadedDay = null
    const refreshSharedAgenda = async () => {
      if (stopped || refreshing || document.visibilityState === 'hidden') return
      if (!navigator.onLine) { setConnectionStatus('offline'); return }
      refreshing = true
      // La actualización periódica es silenciosa para no desplazar controles
      // mientras el técnico está interactuando con una tarjeta.
      try {
        const day = currentLocalDate()
        const data = await loadPersonalTechnicalState(loadedDay === day ? loadedRevision : null, day)
        if (!stopped && Number.isFinite(Number(data?.revision))) { loadedRevision = Number(data.revision); loadedDay = day }
        if (!stopped && Array.isArray(data?.history)) setHistory(data.history)
        if (!stopped && Array.isArray(data?.vehicles)) setVehicles?.(data.vehicles)
        if (!stopped) setConnectionStatus('online')
      } catch (error) {
        if (error.status === 401 && !stopped) sessionInvalidated(error.message)
        else if (!stopped) setConnectionStatus(navigator.onLine ? 'failed' : 'offline')
        // La agenda visible no se descarta ante un fallo temporal de conectividad.
      } finally {
        refreshing = false
      }
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void refreshSharedAgenda()
    }
    const markOffline = () => setConnectionStatus('offline')
    // La sesión puede quedar abierta mientras un coordinador agrega otro trabajo.
    // En móviles, volver desde segundo plano dispara pageshow/visibilitychange pero
    // no necesariamente focus, por eso sincronizamos en todos esos ciclos.
    void refreshSharedAgenda()
    const interval = window.setInterval(refreshWhenVisible, 15000)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('pageshow', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    window.addEventListener('offline', markOffline)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      stopped = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('pageshow', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
      window.removeEventListener('offline', markOffline)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [setHistory])
  useEffect(() => {
    const header = document.querySelector('.technician-header')
    if (!header) return undefined
    const desktopNavigation = document.createElement('aside')
    desktopNavigation.id = 'technician-navigation'
    desktopNavigation.setAttribute('aria-label', 'Menú técnico')
    desktopNavigation.className = `sidebar technician-sidebar ${menuOpen ? 'open' : ''}`
    desktopNavigation.innerHTML = '<div class="brand" aria-label="Pignus"></div><p class="nav-label">MÓDULOS</p><nav aria-label="Módulos técnicos"><button title="Consultá tus servicios asignados y sus horarios." data-view="agenda">▣ <span>Agenda técnica</span></button><button title="Consultá los servicios que ya informaste." data-view="history">◷ <span>Historial</span></button><button title="Consultá el estado de tus solicitudes." data-view="followups">✓ <span>Seguimientos</span></button><button title="Consultá la documentación de los vehículos de la empresa." data-view="vehicles">▰ <span>Flota</span></button><button title="Consultá las instrucciones de uso y preguntas frecuentes." data-view="help">? <span>Centro de ayuda</span></button></nav><div class="sidebar-bottom">v2.0 · Agenda técnica</div>'
    desktopNavigation.querySelectorAll('button').forEach(button => {
      if ((button.dataset.view === 'history' && !can('technical.history')) || (button.dataset.view === 'vehicles' && !canViewVehicles)) { button.remove(); return }
      button.classList.toggle('active', button.dataset.view === view)
      button.onclick = () => { setView(button.dataset.view); setMenuOpen(false) }
    })
    if (!can('followups.view')) desktopNavigation.querySelector('[data-view=followups]')?.remove()
    if (onBack) {
      const back = document.createElement('button'); back.title = "Volvé a los módulos de gestión desde la vista del técnico."
      back.type = 'button'; back.textContent = '← Volver a gestión'; back.onclick = onBack
      desktopNavigation.querySelector('nav').prepend(back)
    }
    const mobileToggle = document.createElement('button'); mobileToggle.title = "Abrí el menú para consultar la agenda, el historial, los vehículos o la ayuda."
    mobileToggle.type = 'button'; mobileToggle.className = 'mobile-menu technician-mobile-menu'; mobileToggle.setAttribute('aria-label', 'Abrir menú'); mobileToggle.textContent = '☰'; mobileToggle.onclick = () => setMenuOpen(true)
    mobileToggle.setAttribute('aria-controls', desktopNavigation.id)
    mobileToggle.setAttribute('aria-expanded', String(menuOpen))
    header.insertBefore(mobileToggle, header.firstChild)
    document.body.appendChild(desktopNavigation)
    const backdrop = menuOpen ? document.createElement('button') : null
    if (backdrop) backdrop.title = 'Cerrá el menú lateral y volvé al contenido.'
    if (backdrop) { backdrop.type = 'button'; backdrop.className = 'backdrop technician-menu-backdrop'; backdrop.setAttribute('aria-label', 'Cerrar menú'); backdrop.onclick = () => setMenuOpen(false); document.body.appendChild(backdrop) }
    const releaseFocus = menuOpen ? manageDrawerFocus(desktopNavigation, {
      trigger: () => document.querySelector('.technician-mobile-menu'),
      onClose: () => setMenuOpen(false),
      backgroundRoots: [document.querySelector('.technician-page')]
    }) : () => {}
    return () => { releaseFocus(); mobileToggle.parentNode?.removeChild(mobileToggle); desktopNavigation.parentNode?.removeChild(desktopNavigation); backdrop?.parentNode?.removeChild(backdrop) }
  }, [view, menuOpen, can, canViewVehicles])
  useEffect(() => {
    if (view === 'help' || view === 'followups') return
    const title = document.querySelector('.technician-content h1')
    const help = document.querySelector('.technician-help')
    if (title) title.textContent = view === 'agenda' ? 'Pendientes, hoy y mañana' : view === 'history' ? 'Historial de servicios' : 'Flota'
    if (help) help.textContent = view === 'agenda' ? 'Los pendientes permanecen disponibles hasta que informes su estado.' : view === 'history' ? 'Consultá los servicios que ya informaste y el estado registrado en cada uno.' : 'Descargá la documentación vigente de los vehículos de la empresa.'
  }, [view])
  useEffect(() => {
    const help = document.querySelector('.technician-help')
    if (!help) return undefined
    document.querySelector('.technician-connection-status')?.remove()
    if (connectionStatus === 'online') return undefined
    const status = document.createElement('div')
    status.className = `technician-connection-status is-${connectionStatus}`
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    const messages = {
      offline: ['Sin conexión', 'La agenda visible sigue disponible. Reconectate antes de informar un servicio.'],
      failed: ['No pudimos actualizar la agenda', 'Conservamos la información visible. Podés reintentar cuando mejore la conexión.']
    }
    const [title, detail] = messages[connectionStatus] || messages.failed
    status.innerHTML = `<b>${title}</b><span>${detail}</span>`
    help.insertAdjacentElement('afterend', status)
    return () => status.remove()
  }, [connectionStatus, view])
  useEffect(() => {
    const cards = document.querySelectorAll('.technician-service')
    document.querySelector('.vehicle-control-blocker-banner')?.remove()
    document.querySelector('.technician-following-services')?.remove()
    const overdueControls = view === 'agenda' ? overdueVehicleControls(services, today) : []
    if (overdueControls.length) {
      const banner = document.createElement('div')
      banner.className = 'vehicle-control-blocker-banner'
      banner.setAttribute('role', 'alert')
      const first = overdueControls[0]
      const title = document.createElement('b')
      title.textContent = 'Control vehicular vencido'
      const detail = document.createElement('span')
      detail.textContent = `Completá el control de ${vehicleLabel(first.vehicle || first)} antes de continuar. Podés consultar los demás servicios, pero sus domicilios y contactos permanecerán ocultos.`
      banner.appendChild(title)
      banner.appendChild(detail)
      const help = document.querySelector('.technician-help')
      if (help?.parentNode) help.parentNode.insertBefore(banner, help.nextSibling)
    }
    cards.forEach((card, index) => {
      const serviceRecord = services[index]
      if (!serviceRecord) return
      if (view === 'agenda') {
        const isNext = index === 0
        card.classList.toggle('technician-next-service', isNext)
        if (isNext) {
          const nextLabel = document.createElement('p')
          nextLabel.className = 'eyebrow technician-next-label'
          nextLabel.textContent = 'PRÓXIMO SERVICIO'
          card.prepend(nextLabel)
        } else if (index === 1) {
          const following = document.createElement('h2')
          following.className = 'technician-following-services'
          following.textContent = 'Siguientes servicios'
          card.parentNode?.insertBefore(following, card)
        }
      }
      card.classList.toggle('vehicle-control-card', Boolean(serviceRecord?.vehicleControl))
      card.querySelector('.technician-advance-request')?.remove()
      card.querySelector('.technician-quick-actions')?.remove()
      const actions = card.querySelector('.technician-actions')
      const advanceStatus = serviceRecord?.advanceRequest?.status
      const canRequestAdvance = can('technical.advance') && can('technical.start') && canWriteRecord(serviceRecord, permissionSubject) && view === 'agenda' && actions && !serviceRecord?.vehicleControl && serviceRecord?.date === today && !serviceHasStarted(serviceRecord, clock)
      if (canRequestAdvance) {
        const button = document.createElement('button'); button.title = "Iniciá el servicio ahora y registrá la hora real."
        button.type = 'button'; button.className = 'secondary technician-advance-request'
        button.textContent = 'Adelantar servicio'
        button.title = 'Iniciá ahora sin aprobación administrativa; se registrará la hora real.'
        button.disabled = false
        button.onclick = () => showAdvanceRequestConfirmation(serviceRecord, async updated => setHistory(previous => previous.map(item => String(item.id) === String(updated.id) ? { ...item, ...updated } : item)))
        const primaryAction = actions.querySelector('.primary')
        if (primaryAction) primaryAction.insertAdjacentElement('afterend', button)
        else actions.append(button)
      }
      const badge = card.querySelector('.work-status')
      if (!badge) return
      badge.classList.remove('tech-status-completado', 'tech-status-cancelado', 'tech-status-reprogramacion')
      const label = badge.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      if (label.includes('cancel')) badge.classList.add('tech-status-cancelado')
      else if (label.includes('reprogram')) badge.classList.add('tech-status-reprogramacion')
      else if (label.includes('complet')) badge.classList.add('tech-status-completado')
      const previousTeam = directChildWithClass(card, 'technician-team')
      if (previousTeam) card.removeChild(previousTeam)
      if (view === 'history') {
        const team = document.createElement('p')
        team.className = 'technician-team'
        const title = document.createElement('b'); title.textContent = 'Equipo de trabajo: '
        team.appendChild(title)
        team.appendChild(document.createTextNode(technicianTeamLabel(services[index])))
        const client = directChildWithClass(card, 'tech-client')
        if (client) card.insertBefore(team, client.nextSibling)
      } else {
        const blockingControl = blockingOverdueVehicleControl(services, index, today)
        const lockedInfo = card.querySelector('.locked-info')
        if (blockingControl && lockedInfo) {
          card.classList.add('blocked-by-vehicle-control')
          lockedInfo.textContent = `Completá primero el control vencido de ${vehicleLabel(blockingControl.vehicle || blockingControl)}. El domicilio y el contacto permanecerán ocultos hasta informarlo.`
        }
        if (!blockingControl && !serviceRecord?.vehicleControl) {
          const serviceUnlocked = !card.classList.contains('locked')
          const quickActions = document.createElement('div')
          quickActions.className = 'technician-quick-actions'
          quickActions.setAttribute('role', 'group')
          quickActions.setAttribute('aria-label', `Acciones rápidas para ${serviceRecord.client || 'el servicio'}`)
          const destination = serviceDirections(serviceRecord)
          if (can('records.contact') && serviceUnlocked && destination?.url) {
            const directions = document.createElement('a')
            directions.className = 'secondary'
            directions.target = '_blank'
            directions.rel = 'noopener noreferrer'
            directions.href = destination.url
            directions.textContent = 'Cómo llegar'
            directions.title = destination.label
            directions.prepend(createIconElement('navigation'))
            directions.setAttribute('aria-label', `Cómo llegar a ${serviceRecord.client || serviceRecord.address}`)
            quickActions.append(directions)
            if (destination.coordinates) {
              const referenceNote = document.createElement('small')
              referenceNote.textContent = destination.label
              quickActions.append(referenceNote)
            }
          } else if (can('records.contact') && serviceUnlocked && destination?.unresolved) {
            const referenceNote = document.createElement('small')
            referenceNote.textContent = destination.label
            quickActions.append(referenceNote)
          }
          if (can('records.contact') && serviceUnlocked && serviceRecord.phone) {
            const call = document.createElement('a')
            call.className = 'secondary'
            call.href = `tel:${String(serviceRecord.phone).replace(/[^+\d]/g, '')}`
            call.textContent = 'Llamar'
            call.prepend(createIconElement('phone'))
            call.setAttribute('aria-label', `Llamar a ${serviceRecord.client || 'contacto del servicio'}`)
            quickActions.append(call)
          }
          const detailToggle = document.createElement('button'); detailToggle.title = "Desplegá u ocultá los datos y las acciones de este servicio."
          detailToggle.type = 'button'
          detailToggle.className = 'secondary technician-detail-toggle'
          const syncDetailState = expanded => {
            card.classList.toggle('is-collapsed', !expanded)
            detailToggle.setAttribute('aria-expanded', String(expanded))
            detailToggle.textContent = expanded ? 'Ocultar detalle' : 'Ver detalle'
            detailToggle.title = expanded ? 'Ocultá los datos y las acciones para compactar esta tarjeta.' : 'Mostrá los datos y las acciones disponibles para este servicio.'
            detailToggle.prepend(createIconElement(expanded ? 'collapse' : 'eye'))
          }
          syncDetailState(index === 0 || expandedServiceCardsRef.current.has(String(serviceRecord.id)))
          detailToggle.onclick = () => {
            const expanded = card.classList.contains('is-collapsed')
            if (expanded) expandedServiceCardsRef.current.add(String(serviceRecord.id))
            else expandedServiceCardsRef.current.delete(String(serviceRecord.id))
            syncDetailState(expanded)
          }
          quickActions.append(detailToggle)
          // Keep route context below the actions so it cannot split their layout.
          quickActions.querySelectorAll('small').forEach(note => quickActions.append(note))
          const start = document.createElement('button'); start.title = "Registrá la hora real de inicio de este servicio."
          start.type = 'button'
          start.className = 'primary technician-start-service'
          start.setAttribute('aria-label', `${serviceRecord.startedAt ? 'Servicio iniciado para' : 'Iniciar servicio para'} ${serviceRecord.client || 'cliente'}`)
          const canStart = can('technical.start') && canWriteRecord(serviceRecord, permissionSubject) && serviceHasStarted(serviceRecord, clock) && connectionStatus !== 'offline'
          start.disabled = Boolean(serviceRecord.startedAt) || !canStart
          start.textContent = serviceRecord.startedAt ? 'Servicio iniciado' : 'Iniciar servicio'
          start.title = serviceRecord.startedAt ? 'La hora de inicio de este servicio ya está registrada.' : 'Registrá la hora real en que comenzás este servicio.'
          start.prepend(createIconElement(serviceRecord.startedAt ? 'check' : 'play'))
          if (!canStart && !serviceRecord.startedAt) start.title = connectionStatus === 'offline' ? 'Reconectate para iniciar el servicio.' : 'El servicio podrá iniciarse cuando llegue su horario.'
          start.onclick = async () => {
            if (!can('technical.start') || !canWriteRecord(serviceRecord, permissionSubject)) return
            start.disabled = true
            start.setAttribute('aria-busy', 'true')
            start.textContent = 'Iniciando…'
            start.prepend(createIconElement('history'))
            card.querySelector('.technician-start-error')?.remove()
            try {
              const updated = await startTechnicianService(serviceRecord.id)
              setHistory(previous => previous.map(item => String(item.id) === String(updated.id) ? { ...item, ...updated } : item))
              start.textContent = 'Servicio iniciado'
              start.title = 'La hora de inicio de este servicio ya está registrada.'
              start.prepend(createIconElement('check'))
            } catch (error) {
              start.disabled = false
              start.removeAttribute('aria-busy')
              start.textContent = 'Iniciar servicio'
              start.prepend(createIconElement('play'))
              const message = document.createElement('p')
              message.className = 'field-error technician-start-error'
              message.setAttribute('role', 'alert')
              message.textContent = error.message || 'No se pudo iniciar el servicio.'
              quickActions.insertAdjacentElement('afterend', message)
            }
          }
          if (serviceUnlocked && can('technical.start') && canWriteRecord(serviceRecord, permissionSubject)) quickActions.prepend(start)
          const clientHeading = directChildWithClass(card, 'tech-client')
          if (clientHeading) clientHeading.insertAdjacentElement('afterend', quickActions)
          else if (actions) card.insertBefore(quickActions, actions)
          else card.append(quickActions)
          if (serviceRecord.startedAt) {
            const started = document.createElement('p')
            started.className = 'technician-started-status'
            started.setAttribute('role', 'status')
            started.textContent = `Servicio iniciado: ${prettyReportDateTime(serviceRecord.startedAt)}`
            quickActions.insertAdjacentElement('afterend', started)
          }
        }
      }
    })
    return () => {
      document.querySelector('.vehicle-control-blocker-banner')?.remove()
      document.querySelector('.technician-following-services')?.remove()
      cards.forEach(card => { const team = directChildWithClass(card, 'technician-team'); if (team) card.removeChild(team); card.querySelector('.technician-next-label')?.remove(); card.querySelector('.technician-advance-request')?.remove(); card.querySelector('.technician-quick-actions')?.remove(); card.querySelector('.technician-started-status')?.remove(); card.classList.remove('blocked-by-vehicle-control', 'vehicle-control-card', 'technician-next-service', 'is-collapsed') })
    }
  }, [services, view, today, clock, connectionStatus, setHistory, can, permissionSubject])
  const saveStatus = async payload => {
    const { record, type } = draft
    if (!canReport(record, type)) throw new Error('No tenés permiso para informar este estado.')
    const current = history.find(item => String(item.id) === String(record.id)) || record
    if (isAdvanceRequestActive(current)) throw new Error('El adelanto está pendiente de aprobación. Esperá la aprobación de Administración.')
    if (record.vehicleControl && !vehicleControlIsOpen(current, clock)) throw new Error('El control todavía no está habilitado.')
    const updated = await submitTechnicianStatus({ recordId: record.id, type, ...payload, vehicleControl: Boolean(record.vehicleControl && type === 'Completado') })
    setHistory(previous => previous.map(item => item.id === record.id ? { ...item, ...updated } : item))
    updateAttachments(record.id, [])
    setDraft(null)
  }
  if (view === 'help' || view === 'followups') return <main className="technician-page" data-unsaved-attachments={hasPendingAttachments || undefined} aria-busy={attachmentOperationsBusy || undefined}><header className="technician-header"><img src="/logo-pignus.png" alt="Pignus" /><div><b>{user.name}</b><span>{user.email}</span></div><RefreshButton /><button title="Cerrá tu sesión; necesitarás tus credenciales para volver a ingresar." className="logout-button" onClick={() => setConfirm({ logout: true })}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="technician-content technician-help-page"><Suspense fallback={<SystemState type="loading" title="Cargando ayuda…" />}>{view === 'followups' ? <Followups /> : <TechnicianHelpCenter onNavigate={next => { if ((next === 'history' && !can('technical.history')) || (next === 'vehicles' && !canViewVehicles)) return; setView(next) }} />} </Suspense></section>{confirm?.logout && <Confirm title="Cerrar sesión" detail={hasPendingAttachments ? 'Tenés fotos o archivos seleccionados que todavía no guardaste. Si cerrás sesión, se descartarán. Los adjuntos ya guardados se conservan.' : '¿Querés cerrar sesión?'} action={logout} destructive={hasPendingAttachments} confirmLabel={hasPendingAttachments ? 'Descartar pendientes y cerrar sesión' : 'Sí, cerrar sesión'} close={() => setConfirm(null)} />}</main>
  if (view === 'vehicles' && canViewVehicles) return <main className="technician-page" data-unsaved-attachments={hasPendingAttachments || undefined} aria-busy={attachmentOperationsBusy || undefined}><header className="technician-header"><img src="/logo-pignus.png" alt="Pignus" /><div><b>{user.name}</b><span>{user.email}</span></div><RefreshButton /><button title="Cerrá tu sesión; necesitarás tus credenciales para volver a ingresar." className="logout-button" onClick={() => setConfirm({ logout: true })}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="technician-content"><p className="eyebrow">DOCUMENTACIÓN DE FLOTA</p><h1>Flota</h1><p className="technician-help">Consultá la flota y descargá el seguro vigente cuando lo necesites.</p><div className="data-card technician-vehicle-table"><div className="technician-vehicle-head"><span>Vehículo</span><span>Año</span><span>Matrícula</span><span>Seguro</span></div>{vehicles.length ? vehicles.map(vehicle => <div className="technician-vehicle-row" key={vehicle.id}><b>{vehicle.brand} {vehicle.model}</b><span>{vehicle.year}</span><strong>{vehicle.plate}</strong><span>{vehicle.insuranceFileName ? <VehicleInsuranceDownload vehicle={vehicle} className="secondary" /> : 'No disponible'}<Attachments scope="vehicle" entityId={vehicle.id} readOnly /></span></div>) : <div className="empty-state">No hay vehículos registrados.</div>}</div></section>{confirm?.logout && <Confirm title="Cerrar sesión" detail={hasPendingAttachments ? 'Tenés fotos o archivos seleccionados que todavía no guardaste. Si cerrás sesión, se descartarán. Los adjuntos ya guardados se conservan.' : '¿Querés cerrar sesión?'} action={logout} destructive={hasPendingAttachments} confirmLabel={hasPendingAttachments ? 'Descartar pendientes y cerrar sesión' : 'Sí, cerrar sesión'} close={() => setConfirm(null)} />}</main>
  return <main className="technician-page" data-unsaved-attachments={hasPendingAttachments || undefined} aria-busy={attachmentOperationsBusy || undefined}><header className="technician-header"><img src="/logo-pignus.png" alt="Pignus" /><div><b>{user.name}</b><span>{user.email}</span></div><RefreshButton /><button title="Cerrá tu sesión; necesitarás tus credenciales para volver a ingresar." className="logout-button" onClick={() => setConfirm({ logout: true })}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="technician-content"><p className="eyebrow">MI AGENDA</p><h1>Servicios asignados</h1><p className="technician-help">Los pendientes permanecen disponibles hasta que informes su estado.</p>{view === 'history' && <div className="technician-history-search"><label htmlFor="technician-history-query">Buscar en mi historial</label><div><Icon name="search" size={18} /><input id="technician-history-query" type="search" value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder="Cliente, código, servicio, fecha o detalle..." autoComplete="off" /></div><small>{services.length} de {completedServices.length} servicio(s)</small></div>}{(view === 'agenda' || services.length) ? (view === 'agenda' ? technicianAgendaGroups(services, today) : [{ id: 'history', services }]).map(group => <React.Fragment key={group.id}>{view === 'agenda' && <header className={`technician-day-heading technician-day-heading--${group.id}`}><h2>{group.title}</h2>{group.date && <p>{prettyDate(group.date)}</p>}</header>}{!group.services.length && <p className="empty-state">No tenés servicios pendientes para {group.id === 'today' ? 'hoy' : 'mañana'}.</p>}{group.services.map(record => { const index = services.indexOf(record); const unlocked = record.vehicleControl || view === 'history' || index === 0 || resolved(services[index - 1]); const done = resolved(record); const earlyVehicleControl = record.vehicleControl && !vehicleControlIsOpen(record, clock); const canComplete = serviceHasStarted(record, clock) && (record.vehicleControl || Boolean(record.startedAt)); const technicianExtras = (!isGranular(permissionSubject) || can('records.financial')) ? technicianVisibleServiceExtras(record) : {}; return <article className={`technician-service ${unlocked ? '' : 'locked'} ${earlyVehicleControl ? 'vehicle-control-early' : ''}`} key={record.id}><div className="technician-service-head"><span>{index + 1}</span><div><b>{record.time ? `${record.time} Hs` : 'Horario a confirmar'}</b><small>{prettyDate(record.date)}</small></div><em className={`work-status ${done ? 'completado' : 'pendiente'}`}>{record.technicalStatus || record.status || 'Pendiente'}</em></div><h2>{serviceTypesLabel(record)}</h2>{journeyLabel(record, history) && <p className="journey-label">{journeyLabel(record, history)} · {journeyReportType(record, history) === 'Avance registrado' ? 'Al terminar, registrá el avance. El servicio continúa en otra jornada.' : 'Última jornada programada.'}</p>}<p className="tech-client">{record.client}</p>{can('records.contact') && unlocked && !record.vehicleControl && (view === 'history' || !blockingOverdueVehicleControl(services, index, today)) && <TechnicianServiceMap record={record} />}{view === 'agenda' && <div className="technician-crew-summary"><strong>{record.team || 'Equipo asignado'}</strong><span>{technicianCrewLabel(record, user.id)}</span></div>}{record.subscriberReservation && <p className="technician-reservation-notice"><Icon name="alert" size={16} />Reserva de nuevo abonado: el PIG definitivo todavía no fue vinculado.</p>}<p><b>Detalle:</b> {record.detail || 'Sin observaciones'}</p><ReschedulingHistory record={record} /><FollowupSummary record={record} /><Attachments key={record.id} entityId={record.id} readOnly={!unlocked} disabled={Boolean(attachmentsPreparing[record.id])} pendingFiles={attachmentDrafts[record.id] || []} onPendingFilesChange={files => updateAttachments(record.id, files)} onPreparingChange={preparing => updatePreparing(record.id, preparing)} />{technicianExtras.paymentMethod && <p><b>Forma de pago:</b> {technicianExtras.paymentMethod}{technicianExtras.amount ? ` · Monto: ${formatCurrencyAmount(technicianExtras.amount)}` : ''}</p>}{technicianExtras.form && <p><b>Formulario:</b> {technicianExtras.form}</p>}{record.vehicleControl ? null : unlocked ? <>{can('records.contact') && <><p><b>Dirección:</b> {record.address || 'Sin dirección'}</p><p><b>Contacto:</b> {record.phone || 'Sin contacto'}</p></>}{can('customer.history') && !record.subscriberReservation && <button title="Consultá los servicios anteriores y los informes de este cliente." className="secondary technician-customer-history" onClick={() => setCustomerHistoryRecord(record)}><Icon name="history" size={17} />Ver historial del cliente</button>}</> : <p className="locked-info">La dirección y el contacto se habilitarán al informar el estado del servicio anterior.</p>}{unlocked && !done && canWriteRecord(record, permissionSubject) && <>{earlyVehicleControl && <p className="vehicle-control-early-notice"><Icon name="lock" size={16} />Este control se habilita el {vehicleControlWindowLabel(record)}.</p>}{!canComplete && !earlyVehicleControl && <p className="vehicle-control-early-notice"><Icon name="lock" size={16} />{!record.vehicleControl && !record.startedAt ? 'Al llegar al domicilio, presioná Iniciar servicio. Para marcarlo completado primero debés iniciarlo.' : 'Podrás completarlo cuando llegue su horario programado.'}</p>}<div className="technician-actions">{isAdvanceRequestActive(record, clock) && <p role="status">Adelanto pendiente: Administración debe aprobarlo para habilitar las acciones.</p>}{canReport(record, journeyReportType(record, history)) && <button title="Abrí el formulario para informar el avance o la finalización del servicio y sus observaciones." className="primary" disabled={earlyVehicleControl || !canComplete || Boolean(attachmentsPreparing[record.id])} onClick={() => { setDraft({ record, type: journeyReportType(record, history) }) }}><Icon name={earlyVehicleControl || !canComplete ? 'lock' : 'check'} />{record.vehicleControl && earlyVehicleControl ? 'Todavía no disponible' : record.serviceJourney ? (journeyReportType(record, history) === 'Avance registrado' ? 'Registrar avance' : 'Completar servicio') : 'Marcar completado'}</button>}{!record.vehicleControl && <>{canReport(record, 'Reprogramación solicitada') && <button title="Informá el motivo por el que el servicio necesita una nueva fecha; la reprogramación quedará pendiente de gestión." className="secondary" disabled={isAdvanceRequestActive(record, clock) || Boolean(attachmentsPreparing[record.id])} onClick={() => { setDraft({ record, type: 'Reprogramación solicitada' }) }}>Solicitar reprogramación</button>}{canReport(record, 'Cancelado') && <button title="Informá la cancelación del servicio e indicá el motivo." className="secondary" disabled={isAdvanceRequestActive(record, clock) || Boolean(attachmentsPreparing[record.id])} onClick={() => { setDraft({ record, type: 'Cancelado' }) }}>Informar cancelación</button>}</>}</div></>}{done && record.technicalReportedAt && <small className="reported-at">Informado: {prettyReportDateTime(record.technicalReportedAt)}</small>}</article> })}</React.Fragment>) : <div className="empty-state">{view === 'history' && historySearch.trim() ? 'No hay servicios que coincidan con la búsqueda.' : view === 'history' ? 'Todavía no informaste servicios.' : 'No tenés servicios pendientes para hoy ni para mañana.'}</div>}</section>{draft && canReport(draft.record, draft.type) && <TechnicianReportModal key={`${draft.record.id}:${draft.type}`} record={draft.record} type={draft.type} serviceLabel={serviceTypesLabel(draft.record)} pendingAttachments={attachmentDrafts[draft.record.id] || []} onPendingAttachmentsChange={files => updateAttachments(draft.record.id, files)} attachmentsPreparing={Boolean(attachmentsPreparing[draft.record.id])} onPreparingChange={preparing => updatePreparing(draft.record.id, preparing)} onClose={() => setDraft(null)} onSubmit={saveStatus} />}{can('customer.history') && customerHistoryRecord && <CustomerServiceHistory customer={customerHistoryRecord} history={history} close={() => setCustomerHistoryRecord(null)} technicianView />}{confirm?.logout && <Confirm title="Cerrar sesión" detail={hasPendingAttachments ? 'Tenés fotos o archivos seleccionados que todavía no guardaste. Si cerrás sesión, se descartarán. Los adjuntos ya guardados se conservan.' : '¿Querés cerrar sesión?'} action={logout} destructive={hasPendingAttachments} confirmLabel={hasPendingAttachments ? 'Descartar pendientes y cerrar sesión' : 'Sí, cerrar sesión'} close={() => setConfirm(null)} />}</main>
}
