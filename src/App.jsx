import { currentLocalDate, initials } from "./presentation/formatting.mjs";
import { collectionRepository } from "./infrastructure/repositories/collection-repository.mjs";
import ModuleIntroduction from "./components/ModuleIntroduction.jsx";
import { manageDrawerFocus } from "./infrastructure/browser/drawer-focus.mjs";
import NotificationCenter from "./components/NotificationCenter.jsx";
import { selectDashboardNotifications, dashboardNotificationAccess, visibleNotificationCustomers } from "./domain/dashboard/dashboard-notifications.mjs";
import FullscreenToggle from "./components/ui/FullscreenToggle.jsx";
import { usePasswordResetRequests } from "./features/auth/application/usePasswordResetRequests.js";
import { servicePreparationOperations } from "./features/state/application/service-preparation.mjs";
import { createRevisionSnapshotCache } from "./domain/shared/revision-snapshot-cache.mjs";
import { FrozenMonthsContext, ServiceJourneysContext } from "./presentation/contexts/agenda-contexts.js";
import { subscriptionRepository } from "./infrastructure/repositories/subscription-repository.mjs";
import { createSaveActivity, operationScopes, preserveLocalDraft } from "./features/state/application/save-activity.mjs";
import { planServiceJourneyOperations } from "./features/state/application/service-journeys.mjs";
import { serviceConfirmationOperations } from "./features/state/application/service-confirmation.mjs";
import { historyRescheduleOperations } from "./features/state/application/history-reschedule.mjs";
import { availableRescheduleTeams, completeRescheduleSlot } from "./domain/agenda/reschedule-availability.mjs";
import { useDeploymentUpdate } from "./components/DeploymentUpdate.jsx";
import useTicketNotifications from './features/tickets/useTicketNotifications.mjs';
const Tickets = lazy(() => import('./features/tickets/Tickets.jsx'))
const TicketSettings = lazy(() => import('./features/tickets/TicketSettings.jsx'))
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Icon from "./components/ui/Icon.jsx";
import SidebarNavigation from "./presentation/components/navigation/SidebarNavigation.jsx";
import { NAVIGATION_ITEMS, navigationLabel } from "./domain/access/navigation.mjs";
import { canAccessOperationalPlanning } from "./domain/access/operational-planning.mjs";
import SystemState from "./components/ui/SystemState.jsx";
import SoftGuardVerification from "./components/SoftGuardVerification.jsx";
import SoftGuardRetirementReminder from "./components/SoftGuardRetirementReminder.jsx";
import { fetchAuthWithRetry, fetchWithTimeout } from "./infrastructure/http/fetch-timeout.mjs";
import { DEFAULT_2026_GUARD_ROTATION, firstSaturdayOfYear } from "./domain/agenda/annual-guards.mjs";
import { ensureVehicleControlService } from "./domain/vehicles/vehicle-controls.mjs";
import { normalizeServiceEstimatedMinutes } from "./domain/agenda/service-scheduling.mjs";
import { buildCustomerReferenceIndex, reconcileCustomerReference } from "./domain/customers/customer-import.mjs";
import { serviceCode } from "./domain/services/service.mjs";
import { normalizeCustomerName, normalizeServiceName } from "./domain/shared/normalization.mjs";
import { normalizeRoleName, resolvedRolePermissions, roleCode, isGranular, canPermission, hasAnyWrite } from "./domain/access/permissions.mjs";
import { PermissionsProvider, usePermissions } from "./presentation/contexts/permissions-context.jsx";
import { currentSessionRole, reconcileSessionUser } from "./features/auth/application/session-user.mjs";
import { stateRepository } from "./infrastructure/repositories/state-repository.mjs";
import { agendaRescheduleRepairCandidates } from "./domain/agenda/reschedule-repair.mjs";
import { SESSION_IDLE_TIMEOUT_MS, SESSION_STATUS_INTERVAL_MS, TECHNICIAN_SESSION_IDLE_TIMEOUT_MS, TECHNICIAN_SESSION_STATUS_INTERVAL_MS, useSessionLifecycle } from "./features/auth/application/useSessionLifecycle.js";
import { serviceAdvanceRepository } from "./infrastructure/repositories/service-advance-repository.mjs";
import { isAdvanceRequestActive } from "./domain/agenda/advance-request-active.mjs";
import { serviceTypesLabel } from "./domain/services/multi-service.mjs";
import { recoverStateRevisionConflict } from "./features/state/application/state-save-conflict.mjs";
import { canRefreshRemote, REMOTE_EDIT_NOTICE } from "./features/state/application/remote-refresh-policy.mjs";
import { useUnsavedFormFields } from "./features/state/application/useUnsavedFormFields.js";
import { compactStateBase } from "./features/state/application/compact-state-base.mjs";
import { historyRecordRepository } from "./infrastructure/repositories/history-record-repository.mjs";
import { weeklyServiceOperations, weeklyServiceMoveOperations } from "./features/state/application/weekly-service-save.mjs";
import { weeklyTeamMemberOperations } from "./features/state/application/weekly-team-members-save.mjs";
import { weeklyTeamRemovalOperations } from "./features/state/application/weekly-team-removal.mjs";
import { weeklyTaskRemovalOperations } from "./features/state/application/weekly-task-removal.mjs";
import { stateOperations } from "./features/state/application/state-operations.mjs";
import { alignOperationBaselines } from "./features/state/application/operation-baselines.mjs";
import { employeeOperations } from "./features/state/application/employee-operations.mjs";
import RefreshButton from "./components/ui/RefreshButton.jsx";
import { requestManualRefresh } from "./features/state/application/manual-refresh.mjs";
import { dailyServiceOperations } from "./features/state/application/daily-service-save.mjs";
import { migrateLegacyEstimatedMinutes } from "./domain/state/legacy-estimated-minutes.mjs";
// These legacy sheets also style daily/history fields, dashboard charts and the
// technician portal. Keep their shared cascade before the global theme layers.
import "./weekly.css";
import "./weekly-enhancements.css";
import "./weekly-dark-cards.css";
import "./daily-completed.css";
import "./ui-polish.css";
import "./constitution-ui.css";
import { TechnicianPortalErrorBoundary } from "./presentation/components/TechnicianPortalErrorBoundary.jsx";
import { createTaskId, createTeamId, createCustomerId } from "./infrastructure/browser/identity.mjs";
import { normalizeInternalChecklist, resolveServiceForTask, taskWithServiceEstimate } from "./features/services/application/service-fields.mjs";
import { sortTasksByTime, sortPlanTasksByTime, isSaturday, isSunday, default2026GuardRotationFor, assignGuardToEmptySaturday, advancedGuardForSaturdayDate, removeUnavailableDefaultSlots, taskForScheduleOccupancy, serviceTrace, stampServiceRecord, normalizeSaturdayTeams, applyRemovedWeeklySlots, applyRemovedWeeklyTasks, applyRemovedWeeklyTeams, renumberVisibleWeeklyTeams, dailyPlanWithMonthlyTeams, moveRecordInWeeklyAgenda, prettyReportDateTime } from "./features/agenda/application/agenda-model.mjs";
import { customerKind } from "./features/customers/application/customer-model.mjs";
import { Confirm } from "./presentation/components/Confirm.jsx";

const Dashboard = lazy(() => import('./features/dashboard/presentation/Dashboard.jsx'))

const FrozenMonthsSettings = lazy(() => import('./components/FrozenMonths.jsx').then(module => ({ default: module.FrozenMonthsSettings })))

const CustomerDetail = lazy(() => import('./features/customers/presentation/CustomerDetail.jsx').then(module => ({ default: module.CustomerDetail })))

const Employees = lazy(() => import('./features/employees/presentation/Employees.jsx'))

const Settings = lazy(() => import('./features/settings/presentation/Settings.jsx'))

const Collections = lazy(() => import('./components/Collections.jsx'))

const SubscriberMap = lazy(() => import('./components/SubscriberMap.jsx'))
const OperationalPlanning = lazy(() => import('./features/planning/presentation/OperationalPlanning.jsx'))

const ServiceTypes = lazy(() => import('./features/services/presentation/ServiceTypes.jsx'))

const HelpCenter = lazy(() => import('./HelpCenter.jsx').then(module => ({ default: module.HelpCenter })))

const noticeTone = message => {
  const normalized = String(message || '').trim().toLocaleLowerCase('es')
  if (/sin conexión|conexión perdida|fuera de línea/.test(normalized)) return 'offline'
  if (/^(no |no se |no pudo|error)|conflicto|demoró demasiado|falló/.test(normalized)) return 'error'
  if (/^(hay |primero |solamente )|desactualiz|otra sesión|revisá|bloquead/.test(normalized)) return 'warning'
  return 'success'
}

const readLocalValue = (key, fallback = '') => {
  try { return localStorage.getItem(key) ?? fallback }
  catch { return fallback }
}

const writeLocalValue = (key, value) => {
  try { localStorage.setItem(key, String(value)) }
  catch { /* la interfaz puede continuar sin preferencias locales */ }
}

const OPERATIONAL_STORAGE_KEYS = ['pignus-roles', 'pignus-employees', 'pignus-services', 'pignus-vehicles', 'pignus-history', 'pignus-customers', 'pignus-agenda']

const clearOperationalStorage = () => {
  try { OPERATIONAL_STORAGE_KEYS.forEach(key => localStorage.removeItem(key)) }
  catch { /* la sesión del servidor sigue siendo la fuente de autorización */ }
}

const Login = lazy(() => import('./features/auth/presentation/Login.jsx').then(module => ({ default: module.Login })))

export default function App() {
  const [requestedModule, setModule] = useState('dashboard')
  const [historicalDate, setHistoricalDate] = useState(null)
  const [historyEntryFilter, setHistoryEntryFilter] = useState(null)
  useEffect(() => { if (requestedModule !== 'history') setHistoryEntryFilter(null) }, [requestedModule])
  const weeklyNavigationGuard = useRef(null)
  const [vehicleEditRequest, setVehicleEditRequest] = useState(null)
  const [weeklyOpenRequest, setWeeklyOpenRequest] = useState(null)
  const [weeklyAnchor, setWeeklyAnchor] = useState(null)
  const [planningPeriod, setPlanningPeriod] = useState(null)
  const openOperationalPlanning = month => requestNavigation(() => {
    setPlanningPeriod(month)
    setModule('operationalPlanning')
  })
  const returnToWeekly = ({ month }) => requestNavigation(() => {
    if (weeklyAnchor?.slice(0, 7) !== month) setWeeklyAnchor(`${month}-01`)
    setModule('weekly')
  })
  const hasUnsavedFormFields = useUnsavedFormFields()
  const hasRefreshDraft = useUnsavedFormFields('.modal input, .modal select, .modal textarea, form input, form select, form textarea, .role-editor input')
  const requestNavigation = action => {
    setMenuOpen(false)
    const proceed = () => weeklyNavigationGuard.current ? weeklyNavigationGuard.current(action) : action()
    const event = new CustomEvent('pignus:before-navigate', {
      cancelable: true,
      detail: { proceed, onBlocked: () => setNotice({ message: 'Esperá a que termine el guardado antes de cambiar de módulo.', tone: 'warning' }) }
    })
    if (window.dispatchEvent(event)) proceed()
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLocalValue('pignus-sidebar-collapsed') === 'true')
  const [desktopSidebar, setDesktopSidebar] = useState(() => globalThis.matchMedia?.('(min-width: 641px)').matches ?? true)
  const [theme, setThemeState] = useState('light')
  const [roles, setRoles] = useState([])
  const [employees, setEmployees] = useState([])
  const employeeRole = employee => roles.find(role => String(role.id) === String(employee.roleId)) || roles.find(role => normalizeRoleName(role.name) === normalizeRoleName(employee.role))
  // Se calcula antes de registrar efectos que sincronizan reprogramaciones.
  // Así también está disponible mientras se recupera una sesión persistente.
  const activeTechs = useMemo(() => employees.filter(employee => employee.status === 'Activo' && (roleCode(employeeRole(employee)) === 'technician' || ((isGranular(employeeRole(employee)) || roleCode(employeeRole(employee)) !== 'supervisor') && employee.technicalEnabled === true))).map(employee => ({ ...employee, roleCode: roleCode(employeeRole(employee)) })), [employees, roles])
  const [services, setServices] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [history, setHistory] = useState([])
  const [customers, setCustomers] = useState([])
  const [teams, setTeams] = useState(() => [{ teamId: createTeamId(), memberIds: [], members: [], tasks: [] }])
  const [date, setDate] = useState(currentLocalDate)
  const [weekly, setWeekly] = useState({})
  const [noticeEntry, setNotice] = useState('')
  const notice = typeof noticeEntry === 'string' ? noticeEntry : noticeEntry?.message || ''
  const noticeLevel = noticeEntry?.tone || noticeTone(notice)
  const [confirmation, setConfirmation] = useState(null)
  const [databaseReady, setDatabaseReady] = useState(false)
  const [stateRevision, setStateRevision] = useState(null)
  const stateRevisionRef = useRef(null)
  const pendingStateSaves = useRef(0)
  const stateSaveQueue = useRef(Promise.resolve())
  const stateSaveGenerationRef = useRef(0)
  const stateSaveTimerRef = useRef(null)
  const confirmedSaveRef = useRef(false)
  const saveActivityRef = useRef(createSaveActivity())
  const pendingConfirmedSavesRef = useRef(0)
  const saveBatchRef = useRef(null)
  const hydrationBaselineRef = useRef(null)
  const [saveHydrationVersion, setSaveHydrationVersion] = useState(0)
  const saveDraftConflictRef = useRef(false)
  const saveSessionEpochRef = useRef(0)
  const [confirmedSaving, setConfirmedSaving] = useState(false)
  useEffect(() => {
    if (!confirmedSaving) return undefined
    const guard = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [confirmedSaving])
  const loggingOutRef = useRef(false)
  const initialRemoteStateRef = useRef(null)
  const hydratingStateRef = useRef(false)
  const hydrationTimerRef = useRef(null)
  const lastPersistedSnapshotRef = useRef(null)
  const lastServerSnapshotRef = useRef(null)
  const currentSnapshotRef = useRef(null)
  const currentDisplaySnapshotRef = useRef(null)
  const quickCommandBaseRef = useRef({ serialized: null, value: null })
  const remoteConflictRevisionRef = useRef(null)
  const serviceDefaultsRef = useRef(new Map())
  const [authUser, setAuthUser] = useState(null)
  const themeAccountKey = authUser?.id || authUser?.email || ''
  const setTheme = value => {
    setThemeState(value)
    if (themeAccountKey) writeLocalValue(`pignus-theme-account:${themeAccountKey}`, value)
  }
  useEffect(() => {
    const saved = themeAccountKey ? readLocalValue(`pignus-theme-account:${themeAccountKey}`, 'light') : 'light'
    setThemeState(saved === 'dark' ? 'dark' : 'light')
  }, [themeAccountKey])
  const activeRole = useMemo(() => currentSessionRole(authUser, roles), [authUser, roles])
  const permissionUser = useMemo(() => ({ ...authUser, ...(activeRole ? { roleCode: roleCode(activeRole), role: activeRole.name, permissions: activeRole.permissions ?? authUser?.permissions } : {}) }), [authUser, activeRole])
  const granularAccess = isGranular(permissionUser)
  const access = useMemo(() => ({ ...resolvedRolePermissions(granularAccess ? permissionUser : activeRole), operationalPlanning: canAccessOperationalPlanning(permissionUser) }), [granularAccess, permissionUser, activeRole])
  const allowed = key => granularAccess ? access[key] === true : canPermission(permissionUser, key)
  const legacyTechnician = !granularAccess && (authUser?.roleCode === 'technician' || normalizeRoleName(authUser?.role) === 'tecnico')
  const isSupervisor = !granularAccess && (authUser?.roleCode === 'supervisor' || normalizeRoleName(authUser?.role) === 'supervisor' || roleCode(activeRole) === 'supervisor')
  const isOperator = !granularAccess && (authUser?.roleCode === 'operator' || normalizeRoleName(authUser?.role) === 'operador' || roleCode(activeRole) === 'operator')
  const isReadOnly = isSupervisor || isOperator || (granularAccess && !hasAnyWrite(permissionUser))
  // Resolve before rendering: restoring a session must never flash statistics.
  const granularModule = requestedModule === 'myServices' ? 'technical' : requestedModule
  const technicalFunctionEnabled = (permissionUser?.technicalEnabled ?? employees.find(employee => String(employee.id) === String(authUser?.id))?.technicalEnabled) === true
  const technicalEligible = permissionUser?.roleCode === 'technician' || technicalFunctionEnabled
  const firstAllowedModule = NAVIGATION_ITEMS.filter(item => item.id !== 'help').map(item => item.id === 'myServices' ? 'technical' : item.id).find(key => access[key] && (key !== 'technical' || technicalEligible))
  const module = isOperator && requestedModule !== 'tickets' ? 'weekly' : isSupervisor && !['accounts','tickets'].includes(requestedModule) ? 'history' : granularAccess
    ? (granularModule === 'help' || access[granularModule] && (granularModule !== 'technical' || technicalEligible) ? requestedModule : firstAllowedModule === 'technical' ? 'myServices' : firstAllowedModule || 'help')
    : requestedModule === 'agenda' ? 'weekly' : requestedModule
  const [sessionEndedMessage, setSessionEndedMessage] = useState('')
  globalThis.__pignusCurrentUser = authUser
  globalThis.__pignusHistory = history
  globalThis.__pignusSetHistory = setHistory
  globalThis.__pignusVehicles = vehicles
  globalThis.__pignusSetCustomers = setCustomers
  const [authLoading, setAuthLoading] = useState(true)
  const [databaseError, setDatabaseError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const stateSnapshot = useMemo(() => ({ roles, employees, services, vehicles, history, customers, agenda: { date, teams, weekly } }), [roles, employees, services, vehicles, history, customers, date, teams, weekly])
  currentDisplaySnapshotRef.current = stateSnapshot
  const serializedStateSnapshot = useMemo(() => JSON.stringify(stateSnapshot), [stateSnapshot])
  currentSnapshotRef.current = serializedStateSnapshot
  useEffect(() => {
    if (!notice) return undefined
    if (notice.startsWith('No se guardó') || notice.startsWith('Hay cambios guardados desde otra sesión')) return undefined
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => writeLocalValue('pignus-sidebar-collapsed', sidebarCollapsed), [sidebarCollapsed])
  useEffect(() => { if (desktopSidebar) setMenuOpen(false) }, [desktopSidebar])
  useEffect(() => {
    if (!menuOpen || desktopSidebar) return undefined
    return manageDrawerFocus(document.getElementById('main-navigation'), {
      trigger: () => document.querySelector('.sidebar-toggle'),
      onClose: () => setMenuOpen(false),
      backgroundRoots: [document.querySelector('.app-shell > main')]
    })
  }, [menuOpen, desktopSidebar])
  useEffect(() => {
    const body = document.body
    let locked = false
    let scrollPosition = 0
    const previous = {}
    const unlock = () => {
      if (!locked) return
      Object.entries(previous).forEach(([property, value]) => { body.style[property] = value })
      document.documentElement.classList.remove('modal-open')
      locked = false
      window.scrollTo(0, scrollPosition)
    }
    const syncModalScrollLock = () => {
      const hasModal = Boolean(document.querySelector('.modal-layer'))
      if (!hasModal) return unlock()
      if (locked) return
      scrollPosition = window.scrollY
      ;['position', 'top', 'left', 'right', 'width', 'overflow'].forEach(property => { previous[property] = body.style[property] })
      body.style.position = 'fixed'
      body.style.top = `-${scrollPosition}px`
      body.style.left = '0'
      body.style.right = '0'
      body.style.width = '100%'
      body.style.overflow = 'hidden'
      document.documentElement.classList.add('modal-open')
      locked = true
    }
    const observer = new MutationObserver(syncModalScrollLock)
    observer.observe(body, { childList: true, subtree: true })
    syncModalScrollLock()
    return () => { observer.disconnect(); unlock() }
  }, [])
  useEffect(() => {
    const nameControls = root => {
      const scope = root instanceof Element ? root : document
      const includeSelf = selector => root instanceof Element && root.matches(selector) ? [root] : []
      const controls = selector => [...includeSelf(selector), ...scope.querySelectorAll(selector)]
      controls('.theme-toggle:not([aria-label])').forEach(button => button.setAttribute('aria-label', button.title || 'Cambiar tema de color'))
      controls('.mobile-menu:not([aria-label])').forEach(button => button.setAttribute('aria-label', 'Abrir menú'))
      controls('.close-modal:not([aria-label]), .modal-close:not([aria-label])').forEach(button => button.setAttribute('aria-label', 'Cerrar diálogo'))
      controls('.notice button:not([aria-label])').forEach(button => button.setAttribute('aria-label', 'Cerrar notificación'))
      controls('button[title]:not([aria-label]), a[title]:not([aria-label])').forEach(control => {
        if (!control.textContent.trim()) {
          const row = control.closest('.account-row, .employee-row, .vehicle-row, .service-row')
          const context = row?.querySelector('.person b, strong, :scope > b')?.textContent?.trim()
          control.setAttribute('aria-label', context ? `${control.title}: ${context}` : control.title)
        }
      })
      controls('.status').forEach(button => {
        button.setAttribute('aria-pressed', String(button.classList.contains('on')))
        const row = button.closest('.employee-row, .service-row')
        const context = row?.querySelector('.person b, strong, :scope > b')?.textContent?.trim()
        if (context && !button.getAttribute('aria-label')) button.setAttribute('aria-label', `${button.classList.contains('on') ? 'Desactivar' : 'Activar'} ${context}`)
      })
      controls('.roles-card > div:not([data-keyboard-selectable])').forEach(card => {
        card.dataset.keyboardSelectable = 'true'
        card.tabIndex = 0
        card.setAttribute('role', 'button')
        card.setAttribute('aria-label', `Seleccionar rol ${card.querySelector('b')?.textContent?.trim() || ''}`.trim())
        card.addEventListener('keydown', event => {
          if (event.target !== card || !['Enter', ' '].includes(event.key)) return
          event.preventDefault()
          card.click()
        })
      })
      controls('input[placeholder*="Buscar"]:not([aria-label]), input[placeholder*="buscar"]:not([aria-label])').forEach(input => input.setAttribute('aria-label', input.placeholder))
    }
    nameControls(document)
    const observer = new MutationObserver(records => records.forEach(record => {
      if (record.type === 'attributes' && record.target instanceof Element) nameControls(record.target)
      record.addedNodes.forEach(node => { if (node instanceof Element) nameControls(node) })
    }))
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-theme', 'title'] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const modalLayers = () => [...document.querySelectorAll('.modal-layer, .modal-backdrop')]
      .filter(layer => layer.isConnected && window.getComputedStyle(layer).display !== 'none')
    const modalOrigins = new WeakMap()
    let modalSequence = 0
    const focusableSelector = [
      'button:not(:disabled)',
      'a[href]',
      'input:not(:disabled):not([type="hidden"])',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      '[tabindex]:not([tabindex="-1"])'
    ].join(', ')
    const dialogFor = layer => layer.matches('[role="dialog"]') ? layer : layer.querySelector('[role="dialog"], .modal')
    const prepareModal = layer => {
      if (!(layer instanceof HTMLElement) || layer.dataset.focusManaged === 'true') return
      const dialog = dialogFor(layer)
      if (!(dialog instanceof HTMLElement)) return
      layer.dataset.focusManaged = 'true'
      modalOrigins.set(layer, document.activeElement instanceof HTMLElement ? document.activeElement : null)
      if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
        const title = dialog.querySelector('h1, h2, h3')
        if (title) {
          if (!title.id) title.id = `pignus-modal-title-${++modalSequence}`
          dialog.setAttribute('aria-labelledby', title.id)
        }
      }
      if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
      dialog.querySelectorAll('.close-modal, .modal-close').forEach(button => {
        if (!button.getAttribute('aria-label') && !button.textContent.trim()) button.setAttribute('aria-label', 'Cerrar')
      })
      requestAnimationFrame(() => {
        if (!layer.isConnected) return
        const preferred = dialog.querySelector('[autofocus], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), .confirm-actions .secondary:not(:disabled), .modal-actions .secondary:not(:disabled), button:not(:disabled)')
        ;(preferred || dialog).focus({ preventScroll: true })
      })
    }
    const restoreModalFocus = layer => {
      const origin = modalOrigins.get(layer)
      if (origin?.isConnected) requestAnimationFrame(() => origin.focus({ preventScroll: true }))
    }
    const dismiss = layer => {
      const control = layer?.querySelector([
        '.close-modal:not(:disabled)',
        '.modal-close:not(:disabled)',
        '.modal-dismiss:not(:disabled)',
        '.modal-actions .secondary:not(:disabled)',
        '.confirm-actions .secondary:not(:disabled)'
      ].join(', '))
      if (!control) return false
      control.click()
      return true
    }
    const closeFromBackdrop = event => {
      if (!(event.target instanceof Element) || !event.target.matches('.modal-layer, .modal-backdrop')) return
      dismiss(event.target)
    }
    const closeFromEscape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return
      const layers = modalLayers()
      if (!layers.length) {
        const transient = document.querySelector('.picker-backdrop, .backdrop, .profile-trigger[aria-expanded="true"]')
        if (!transient) return
        transient.click()
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (!dismiss(layers[layers.length - 1])) return
      event.preventDefault()
      event.stopPropagation()
    }
    const trapModalFocus = event => {
      if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return
      const layers = modalLayers()
      const layer = layers[layers.length - 1]
      const dialog = layer && dialogFor(layer)
      if (!dialog) return
      const controls = [...dialog.querySelectorAll(focusableSelector)].filter(control => control instanceof HTMLElement && control.offsetParent !== null)
      if (!controls.length) { event.preventDefault(); dialog.focus(); return }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    const modalObserver = new MutationObserver(records => records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return
        if (node.matches('.modal-layer, .modal-backdrop')) prepareModal(node)
        node.querySelectorAll?.('.modal-layer, .modal-backdrop').forEach(prepareModal)
      })
      record.removedNodes.forEach(node => {
        if (!(node instanceof Element)) return
        if (node.matches('.modal-layer, .modal-backdrop')) restoreModalFocus(node)
        node.querySelectorAll?.('.modal-layer, .modal-backdrop').forEach(restoreModalFocus)
      })
    }))
    modalLayers().forEach(prepareModal)
    modalObserver.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('click', closeFromBackdrop)
    document.addEventListener('keydown', closeFromEscape)
    document.addEventListener('keydown', trapModalFocus, true)
    return () => {
      modalObserver.disconnect()
      document.removeEventListener('click', closeFromBackdrop)
      document.removeEventListener('keydown', closeFromEscape)
      document.removeEventListener('keydown', trapModalFocus, true)
    }
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 641px)')
    const syncSidebarMode = () => setDesktopSidebar(media.matches)
    syncSidebarMode()
    if (media.addEventListener) media.addEventListener('change', syncSidebarMode)
    else media.addListener(syncSidebarMode)
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', syncSidebarMode)
      else media.removeListener(syncSidebarMode)
    }
  }, [])
  useEffect(clearOperationalStorage, [])
  useEffect(() => {
    if (granularAccess || !services.length) return
    const previousDefaults = serviceDefaultsRef.current
    const nextDefaults = new Map(services.map(service => [String(service.id), normalizeServiceEstimatedMinutes(service.estimatedMinutes)]))
    const normalizeReference = item => {
      const matched = services.find(service => String(service.id) === String(item.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(item.service))
      if (!matched) return item
      const serviceKey = String(matched.id)
      const hasPreviousDefault = previousDefaults.has(serviceKey)
      const currentDefault = normalizeServiceEstimatedMinutes(matched.estimatedMinutes)
      const previousDefault = previousDefaults.get(serviceKey) ?? currentDefault
      const serviceDefaultChanged = hasPreviousDefault && previousDefault !== currentDefault
      const closed = ['Completado', 'Cancelado', 'Reprogramado'].includes(item.status)
      const customized = item.estimatedMinutesCustomized === true || (
        item.estimatedMinutesCustomized !== false && item.estimatedMinutes != null && Number(item.estimatedMinutes) !== Number(previousDefault)
      )
      const estimatedMinutes = serviceDefaultChanged
        ? (closed || customized ? normalizeServiceEstimatedMinutes(item.estimatedMinutes, currentDefault) : currentDefault)
        : normalizeServiceEstimatedMinutes(item.estimatedMinutes, currentDefault)
      const estimatedMinutesCustomized = closed
        ? (item.estimatedMinutesCustomized ?? true)
        : (serviceDefaultChanged ? customized : (item.estimatedMinutesCustomized ?? customized))
      const next = { ...item, serviceId: matched.id, service: matched.name, estimatedMinutes, estimatedMinutesCustomized }
      return JSON.stringify(next) === JSON.stringify(item) ? item : next
    }
    const normalizeTeams = value => (value || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeReference); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    serviceDefaultsRef.current = nextDefaults
  }, [services])
  useEffect(() => {
    if (granularAccess || !customers.length) return
    const normalizedCustomers = customers.map(customer => ({ ...customer, customerId: customer.customerId || createCustomerId(), kind: customerKind(customer), name: normalizeCustomerName(customer.name) }))
    if (normalizedCustomers.some((customer, index) => JSON.stringify(customer) !== JSON.stringify(customers[index]))) {
      setCustomers(normalizedCustomers)
      return
    }
    const customerIndex = buildCustomerReferenceIndex(normalizedCustomers)
    const normalizeReference = item => reconcileCustomerReference(item, customerIndex)
    const normalizeTeams = value => (value || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeReference); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [customers])
  // Retirement identity and timestamps come from the confirmed server write.
  // A local conversion would race its customer code and protected provenance.
  useEffect(() => {
    if (granularAccess || !employees.length) return
    const byId = new Map(employees.map(employee => [String(employee.id), employee]))
    const byName = new Map(employees.map(employee => [normalizeServiceName(employee.name), employee]))
    const normalizeAssignments = item => {
      const assignedById = (item.memberIds || item.technicianIds || []).map(id => byId.get(String(id))).filter(Boolean)
      const assignedByName = (item.members || item.technicians || []).map(name => byName.get(normalizeServiceName(name))).filter(Boolean)
      const assigned = [...new Map((assignedById.length ? assignedById : assignedByName).map(employee => [String(employee.id), employee])).values()]
      if ('tasks' in item) return { ...item, teamId: item.teamId || createTeamId(), memberIds: assigned.map(employee => employee.id), members: assigned.map(employee => employee.name) }
      return { ...item, technicianIds: assigned.map(employee => employee.id), technicians: assigned.map(employee => employee.name) }
    }
    const normalizeTeams = teams => (teams || []).map(normalizeAssignments)
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => key === '_monthlyTeams' ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: normalizeTeams(config?.teams) }]))] : [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeAssignments); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [employees])
  useEffect(() => {
    fetchAuthWithRetry('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' }).then(async response => {
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.code === 'SESSION_ENDED') setSessionEndedMessage(data.error)
        return null
      }
      return data
    }).then(data => {
      initialRemoteStateRef.current = data?.state || null
      setAuthUser(data?.user || null)
    }).catch(error => {
      setSessionEndedMessage(error.message || 'No se pudo verificar la sesión. Volvé a intentarlo.')
      setAuthUser(null)
    }).finally(() => setAuthLoading(false))
  }, [])
  useEffect(() => {
    const goToHistory = event => { setHistoryEntryFilter(event.detail?.pendingGroup ? event.detail : null); setModule('history') }
    const goToEmployees = () => setModule('employees')
    window.addEventListener('pignus:open-history', goToHistory)
    window.addEventListener('pignus:open-employees', goToEmployees)
    return () => {
      window.removeEventListener('pignus:open-history', goToHistory)
      window.removeEventListener('pignus:open-employees', goToEmployees)
    }
  }, [])
  useEffect(() => {
    const replaceCustomers = event => {
      if (Array.isArray(event.detail?.customers)) setCustomers(event.detail.customers.map(customer => ({ ...customer, name: normalizeCustomerName(customer.name) })))
    }
    window.addEventListener('pignus:replace-customers', replaceCustomers)
    return () => window.removeEventListener('pignus:replace-customers', replaceCustomers)
  }, [])
  useEffect(() => {
    // Los mensajes que confirman operaciones de agenda no deben ocupar otros módulos.
    const noticeElement = document.querySelector('.content > .notice')
    const isAgendaMessage = notice.startsWith('La agenda ')
    noticeElement?.classList.toggle('agenda-message-hidden', isAgendaMessage && module !== 'agenda')
    if (noticeElement) {
      const tone = noticeLevel
      noticeElement.dataset.tone = tone
      noticeElement.setAttribute('role', tone === 'error' || tone === 'offline' ? 'alert' : 'status')
      noticeElement.setAttribute('aria-live', tone === 'error' || tone === 'offline' ? 'assertive' : 'polite')
    }
  }, [module, notice, noticeLevel])
  useEffect(() => {
    // Mantiene sincronizada la agenda abierta cuando se corrige un servicio desde Historial.
    const syncAgendaService = event => {
      const { record, patch } = event.detail || {}
      if (!record || !patch) return
      const legacyTeamIndex = Number(String(record.team || '').match(/\d+/)?.[0]) - 1
      const updateTeamsForRecord = previous => previous.map((team, index) => (record.teamId ? String(team.teamId) !== String(record.teamId) : index !== legacyTeamIndex) ? team : {
        ...team,
        memberIds: patch.technicianIds || team.memberIds,
        members: patch.technicians || team.members,
        tasks: team.tasks.map(task => {
          const sameTask = record.sourceTaskId ? String(task.taskId) === String(record.sourceTaskId) : task.historyId ? String(task.historyId) === String(record.id) : task.client === record.client && task.service === record.service
          return sameTask ? { ...task, customerId: patch.customerId ?? task.customerId, clientAccount: patch.clientAccount ?? task.clientAccount, clientNameAtService: patch.clientNameAtService ?? task.clientNameAtService, client: patch.client ?? task.client, serviceId: patch.serviceId ?? task.serviceId, service: patch.service ?? task.service, address: patch.address ?? task.address, phone: patch.phone ?? task.phone, detail: patch.detail ?? task.detail, internalNote: patch.internalNote ?? task.internalNote, internalChecklist: patch.internalChecklist ?? task.internalChecklist, ...serviceTrace(patch) } : task
        })
      })
      if (record.date === date) setTeams(updateTeamsForRecord)
      if (record.date) setWeekly(previous => previous?.[record.date]?.teams?.length
        ? { ...previous, [record.date]: { ...previous[record.date], teams: updateTeamsForRecord(previous[record.date].teams) } }
        : previous)
    }
    window.addEventListener('pignus:sync-agenda-service', syncAgendaService)
    return () => window.removeEventListener('pignus:sync-agenda-service', syncAgendaService)
  }, [date])
  useEffect(() => {
    const moveWeeklyService = event => {
      const { record, nextDate, sourceDate } = event.detail || {}
      if (!record || !nextDate) return
      setWeekly(previous => moveRecordInWeeklyAgenda(previous, record, nextDate, sourceDate, activeTechs))
    }
    window.addEventListener('pignus:reschedule-service', moveWeeklyService)
    return () => window.removeEventListener('pignus:reschedule-service', moveWeeklyService)
  }, [])
  useEffect(() => {
    // Repara reprogramaciones anteriores que pudieron quedar copiadas en ambos
    // dias. La identidad del servicio (historyId/taskId) permite quitar solamente
    // el origen sin alterar los restantes equipos ni sus visitas.
    // Las agendas vencidas son snapshots cerrados. Una modificación cualquiera
    // de Historial no debe intentar reconstruir allí reprogramaciones antiguas:
    // además de ser innecesario, el servidor lo detecta como un alta tardía.
    if (granularAccess) return
    const rescheduled = agendaRescheduleRepairCandidates(history, currentLocalDate())
    if (!rescheduled.length) return
    setWeekly(previous => {
      const next = rescheduled.reduce(
        (current, record) => moveRecordInWeeklyAgenda(current, record, record.date, record.rescheduledFrom, activeTechs),
        previous
      )
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next
    })
    const movedAway = rescheduled.filter(record => record.rescheduledFrom === date)
    if (movedAway.length) {
      const matchesMoved = task => movedAway.some(record =>
        String(task.historyId || '') === String(record.id) ||
        (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
      )
      setTeams(previous => {
        const next = previous.map(team => ({ ...team, tasks: (team.tasks || []).filter(task => !matchesMoved(task)) }))
        return JSON.stringify(next) === JSON.stringify(previous) ? previous : next
      })
    }
  }, [history, date, employees, roles])
  useEffect(() => {
    // Los controles vehiculares tienen un responsable propio en la tarjeta.
    // Los servicios comunes conservan la instantánea leída del Historial hasta
    // que un guardado explícito actualice también su asignación.
    if (granularAccess) return
    setHistory(previous => {
      let changed = false
      const next = previous.map(record => {
        if (!record.vehicleControl) return record
        const day = weekly?.[record.date]
        const assignedTeam = day?.teams?.find(team => (team.tasks || []).some(task =>
          String(task.historyId || '') === String(record.id) ||
          (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
        ))
        if (!assignedTeam) return record
        const assignedTask = (assignedTeam.tasks || []).find(task =>
          String(task.historyId || '') === String(record.id) ||
          (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
        )
        const taskHasResponsible = record.vehicleControl && assignedTask?.technicianIds?.length
        const technicianIds = taskHasResponsible ? assignedTask.technicianIds : (record.technicianIds || [])
        const technicians = taskHasResponsible ? (assignedTask.technicians || []) : (record.technicians || [])
        if (JSON.stringify(record.technicianIds || []) === JSON.stringify(technicianIds) && JSON.stringify(record.technicians || []) === JSON.stringify(technicians)) return record
        changed = true
        return { ...record, technicianIds, technicians }
      })
      return changed ? next : previous
    })
  }, [weekly])
  useEffect(() => {
    const removeWeeklyService = event => {
      const { day, teamId, teamIndex, taskIndex, taskId, historyId } = event.detail || {}
      if (!day || (!taskId && !historyId && !Number.isInteger(taskIndex))) return
      const matches = task => (taskId && String(task.taskId || '') === String(taskId)) || (historyId && String(task.historyId || '') === String(historyId))
      if (day === date) setTeams(previous => previous.map((team, currentTeamIndex) => {
        const sameTeam = teamId ? String(team.teamId || '') === String(teamId) : currentTeamIndex === teamIndex
        if (!sameTeam) return team
        return { ...team, tasks: (team.tasks || []).filter((task, currentTaskIndex) => taskId || historyId ? !matches(task) : currentTaskIndex !== taskIndex) }
      }))
      if (historyId) setHistory(previous => previous.filter(record => String(record.id) !== String(historyId)))
    }
    window.addEventListener('pignus:remove-weekly-task', removeWeeklyService)
    return () => window.removeEventListener('pignus:remove-weekly-task', removeWeeklyService)
  }, [date])
  useEffect(() => {
    // Una agenda diaria ya abierta/guardada comparte los mismos taskId que la
    // planificación semanal. Toda corrección semanal debe reflejarse también
    // en esa copia y en su registro pendiente del Historial.
    const syncWeeklyTask = event => {
      const { day, teamId, teamIndex, taskIndex, taskId, draft, teamSnapshot } = event.detail || {}
      if (!day || !draft) return
      if (day === date) setTeams(previous => {
        const next = [...previous]
        let destinationIndex = next.findIndex(team => taskId && (team.tasks || []).some(task => String(task.taskId || '') === String(taskId)))
        if (destinationIndex < 0 && teamId) destinationIndex = next.findIndex(team => String(team.teamId || '') === String(teamId))
        if (destinationIndex < 0 && next[teamIndex]) destinationIndex = teamIndex
        if (destinationIndex < 0) {
          next.push({
            teamId: teamId || teamSnapshot?.teamId || createTeamId(),
            label: teamSnapshot?.label || `Equipo ${teamIndex + 1}`,
            memberIds: teamSnapshot?.memberIds || [],
            members: teamSnapshot?.members || [],
            tasks: [draft]
          })
          return next
        }
        const destination = next[destinationIndex]
        const existingTaskIndex = (destination.tasks || []).findIndex((task, index) => (taskId && String(task.taskId || '') === String(taskId)) || (!taskId && index === taskIndex))
        const tasks = existingTaskIndex >= 0
          ? destination.tasks.map((task, index) => index === existingTaskIndex ? { ...task, ...draft } : task)
          : [...(destination.tasks || []), draft]
        next[destinationIndex] = {
          ...destination,
          label: teamSnapshot?.label || destination.label,
          memberIds: teamSnapshot?.memberIds || destination.memberIds || [],
          members: teamSnapshot?.members || destination.members || [],
          tasks: sortTasksByTime(tasks)
        }
        return next
      })
      setHistory(previous => {
        const sameRecord = record => record.date === day && (
          (draft.historyId && String(record.id) === String(draft.historyId)) ||
          (taskId && String(record.sourceTaskId || '') === String(taskId))
        )
        if (previous.some(sameRecord)) return previous.map(record => sameRecord(record) ? {
          ...record,
          time: draft.time,
          scheduledTime: draft.time,
          estimatedMinutes: draft.estimatedMinutes,
          estimatedMinutesCustomized: Boolean(draft.estimatedMinutesCustomized),
          serviceTypes: draft.serviceTypes,
          serviceId: draft.serviceId,
          service: draft.service,
          customerId: draft.customerId,
          client: draft.client,
          clientAccount: draft.clientAccount,
          clientNameAtService: draft.clientNameAtService,
          address: draft.address,
           phone: draft.phone,
           detail: draft.detail,
           internalNote: draft.internalNote || '',
           internalChecklist: normalizeInternalChecklist(draft.internalChecklist),
           paymentMethod: draft.paymentMethod || '',
           amount: draft.amount || '',
           monthlyFee: draft.monthlyFee || '', freezeMonthlyFee: draft.freezeMonthlyFee ?? null, frozenMonths: Number(draft.frozenMonths || 0),
           awaitingConfirmation: draft.awaitingConfirmation === true, form: draft.form || '', formEmail: draft.formEmail || '',
           installationZone: draft.installationZone || '',
          ...serviceTrace(draft)
        } : record)

        // Si el día ya fue registrado, un servicio agregado luego desde la
        // agenda semanal también debe quedar documentado como pendiente. Para
        // días futuros se mantiene como planificación hasta abrir/guardar el día.
        if (!previous.some(record => record.date === day)) return previous
        const sourceTaskId = draft.taskId || taskId || createTaskId()
        return [{
          id: draft.historyId || `work-${sourceTaskId}`,
          sourceTaskId,
          date: day,
          time: draft.time,
          scheduledTime: draft.time,
          estimatedMinutes: draft.estimatedMinutes,
          estimatedMinutesCustomized: Boolean(draft.estimatedMinutesCustomized),
          team: teamSnapshot?.label || `Equipo ${teamIndex + 1}`,
          teamId: teamId || teamSnapshot?.teamId || '',
          technicianIds: teamSnapshot?.memberIds || [],
          technicians: teamSnapshot?.members || [],
          serviceTypes: draft.serviceTypes,
          serviceId: draft.serviceId || '',
          service: draft.service || '',
          customerId: draft.customerId || '',
          client: draft.client || '',
          clientAccount: draft.clientAccount || '',
          clientNameAtService: draft.clientNameAtService || String(draft.client || '').replace(/^[^\s]+\s+/, ''),
          address: draft.address || '',
           phone: draft.phone || '',
           detail: draft.detail || '',
           internalNote: draft.internalNote || '',
           internalChecklist: normalizeInternalChecklist(draft.internalChecklist),
           paymentMethod: draft.paymentMethod || '',
           amount: draft.amount || '',
           monthlyFee: draft.monthlyFee || '', freezeMonthlyFee: draft.freezeMonthlyFee ?? null, frozenMonths: Number(draft.frozenMonths || 0),
           awaitingConfirmation: draft.awaitingConfirmation === true, form: draft.form || '', formEmail: draft.formEmail || '',
           installationZone: draft.installationZone || '',
          ...serviceTrace(draft),
          status: 'Pendiente'
        }, ...previous]
      })
    }
    window.addEventListener('pignus:sync-weekly-task', syncWeeklyTask)
    return () => window.removeEventListener('pignus:sync-weekly-task', syncWeeklyTask)
  }, [date])
  useEffect(() => {
    const moveWeeklyTask = event => {
      const { day, taskId, historyId, destinationTeamId, destinationTeamIndex, destinationTeam } = event.detail || {}
      if (!day || (!taskId && !historyId) || !destinationTeam) return
      const matchesTask = task => (taskId && String(task.taskId || '') === String(taskId)) || (historyId && String(task.historyId || '') === String(historyId))
      if (day === date) setTeams(previous => {
        let movedTask = null
        previous.some(team => (team.tasks || []).some(task => {
          if (!matchesTask(task)) return false
          movedTask = task
          return true
        }))
        if (!movedTask) return previous
        const next = previous.map(team => ({ ...team, tasks: (team.tasks || []).filter(task => !matchesTask(task)) }))
        let targetIndex = next.findIndex(team => destinationTeamId && String(team.teamId || '') === String(destinationTeamId))
        if (targetIndex < 0 && next[destinationTeamIndex]) targetIndex = destinationTeamIndex
        if (targetIndex < 0) {
          next.push({ ...destinationTeam, tasks: [movedTask] })
          return next
        }
        const target = next[targetIndex]
        const withoutMatchingEmptySlot = (target.tasks || []).filter(task => !(
          task.time === movedTask.time &&
          !String(task.client || '').trim() &&
          !String(task.service || '').trim()
        ))
        next[targetIndex] = {
          ...target,
          teamId: destinationTeamId || target.teamId,
          label: destinationTeam.label || target.label,
          memberIds: destinationTeam.memberIds || [],
          members: destinationTeam.members || [],
          tasks: sortTasksByTime([...withoutMatchingEmptySlot, movedTask])
        }
        return next
      })
      setHistory(previous => previous.map(record => {
        const sameRecord = record.date === day && (
          (historyId && String(record.id || '') === String(historyId)) ||
          (taskId && String(record.sourceTaskId || '') === String(taskId))
        )
        return sameRecord ? {
          ...record,
          team: destinationTeam.label || `Equipo ${Number(destinationTeamIndex) + 1}`,
          teamId: destinationTeamId || destinationTeam.teamId || '',
          technicianIds: destinationTeam.memberIds || [],
          technicians: destinationTeam.members || []
        } : record
      }))
    }
    window.addEventListener('pignus:move-weekly-task', moveWeeklyTask)
    return () => window.removeEventListener('pignus:move-weekly-task', moveWeeklyTask)
  }, [date])
  useEffect(() => {
    // Compatibilidad con equipos históricos cuyos teamId semanal y diario no
    // coinciden: el taskId es la identidad canónica del servicio.
    // While the daily editor is mounted it owns its draft and projects changes
    // to weekly. Copying weekly back during the same render can exchange two
    // successive edits forever. Initial loading and confirmed remote saves
    // already hydrate the daily form through their explicit paths.
    if (granularAccess || module === 'agenda') return
    const weeklyTasks = weekly?.[date]?.teams?.flatMap(team => team.tasks || []) || []
    if (!weeklyTasks.length) return
    const byTaskId = new Map(weeklyTasks.filter(task => task.taskId).map(task => [String(task.taskId), task]))
    setTeams(previous => {
      const next = previous.map(team => ({ ...team, tasks: sortTasksByTime(team.tasks.map(task => {
        const weeklyTask = task.taskId ? byTaskId.get(String(task.taskId)) : null
        return weeklyTask ? { ...task, ...weeklyTask } : task
      })) }))
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next
    })
  }, [weekly, date, module])
  const applyRemoteState = (data, { preserveFrom = null } = {}) => {
    if (lastServerSnapshotRef.current && Number(data.revision) < Number(stateRevisionRef.current)) return
    if (data.sessionUser) setAuthUser(current => current === authUser ? reconcileSessionUser(current, data.sessionUser) : current)
    stateRepository.prime(data)
    data = migrateLegacyEstimatedMinutes(data, { repairUnidentifiedAgenda: true }).state
    // Keep the server's projections before display effects reconcile daily and
    // weekly cards. Those effects are not persisted writes or CAS baselines.
    lastServerSnapshotRef.current = structuredClone(data)
    hydratingStateRef.current = true
    serviceDefaultsRef.current = new Map()
    remoteConflictRevisionRef.current = null
    stateRevisionRef.current = Number(data.revision || 0)
    setStateRevision(stateRevisionRef.current)
    const loadedRoles = Array.isArray(data.roles) ? data.roles.map(role => { const code = roleCode(role); if (isGranular(role)) return { ...role, code }; const permissions = resolvedRolePermissions({ ...role, code, permissions: { dashboard: true, weekly: role.permissions?.weekly ?? ['administrator', 'user', 'coordinator'].includes(code), ...role.permissions } }); return { ...role, code, permissions } }) : []

    const loaded_employees = Array.isArray(data.employees) ? data.employees.map(employee => { const assignedRole = loadedRoles.find(role => String(role.id) === String(employee.roleId)) || loadedRoles.find(role => normalizeRoleName(role.name) === normalizeRoleName(employee.role)); return assignedRole ? { ...employee, roleId: assignedRole.id, role: assignedRole.name } : employee }) : []
    const loaded_services = ensureVehicleControlService(Array.isArray(data.services) ? data.services.map(service => ({ ...service, code: serviceCode(service), category: service.category || (normalizeServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service'), estimatedMinutes: normalizeServiceEstimatedMinutes(service.estimatedMinutes) })) : [])
    const loaded_vehicles = Array.isArray(data.vehicles) ? data.vehicles : []
    const loaded_history = Array.isArray(data.history) ? data.history : []
    const loaded_customers = Array.isArray(data.customers) ? data.customers.map(customer => ({ ...customer, customerId: customer.customerId || createCustomerId(), kind: customerKind(customer), name: normalizeCustomerName(customer.name) })) : []
    // La fecha y las tarjetas de Agenda del día forman una única instantánea.
    // Si al hidratar forzamos "hoy" pero conservamos equipos de otra fecha, el
    // servidor interpreta esas tarjetas como servicios del día actual.
    const persistedAgendaDate = /^\d{4}-\d{2}-\d{2}$/.test(String(data.agenda?.date || ''))
      ? data.agenda.date
      : currentLocalDate()
    const loaded_teams = sortPlanTasksByTime({ teams: data.agenda?.teams?.length ? data.agenda.teams : [{ teamId: createTeamId(), memberIds: [], members: [], tasks: [] }] }).teams
    const loaded_date = persistedAgendaDate
    const loaded_weekly = data.agenda?.weekly && typeof data.agenda.weekly === 'object' ? data.agenda.weekly : {}
    const remoteSnapshot = { roles: loadedRoles, employees: loaded_employees, services: loaded_services, vehicles: loaded_vehicles, history: loaded_history, customers: loaded_customers, agenda: { date: loaded_date, teams: loaded_teams, weekly: loaded_weekly } }
    const local = currentSnapshotRef.current ? JSON.parse(currentSnapshotRef.current) : remoteSnapshot
    const preserved = preserveFrom ? preserveLocalDraft(preserveFrom, local, remoteSnapshot) : { state: remoteSnapshot, conflict: false }
    // Both refreshes and save acknowledgements may return storage order. Sort
    // after merging drafts too, using their latest times rather than positions.
    const display = { ...preserved.state, agenda: { ...preserved.state.agenda, teams: sortPlanTasksByTime(preserved.state.agenda).teams } }
    const hasDraft = JSON.stringify(display) !== JSON.stringify(remoteSnapshot)
    hydrationBaselineRef.current = hasDraft ? JSON.stringify(remoteSnapshot) : null
    lastPersistedSnapshotRef.current = JSON.stringify(remoteSnapshot)
    currentSnapshotRef.current = JSON.stringify(display)
    if (preserved.conflict) {
      saveDraftConflictRef.current = true
      setNotice('Se guardó la operación, pero hay una edición posterior que requiere revisión. Se conservó tu borrador; revisalo antes de guardar nuevamente.')
    }
    setRoles(display.roles); setEmployees(display.employees); setServices(display.services)
    setVehicles(display.vehicles); setHistory(display.history); setCustomers(display.customers)
    setTeams(display.agenda.teams); setDate(display.agenda.date); setWeekly(display.agenda.weekly)
    setDatabaseReady(true)
  }
  const refreshRemoteState = async () => {
    applyRemoteState(await stateRepository.load())
  }
  const persistStateCommand = async (buildOperations, { combinePendingState = false, rebaseOnRecordConflict = false, isolatedMove = false, alignDisplayBaselines = false, independentService = false, quickAction = false } = {}) => {
    const saveEpoch = saveSessionEpochRef.current
    let release = !combinePendingState || isolatedMove ? saveActivityRef.current.acquire() : null
    if (!pendingConfirmedSavesRef.current) saveBatchRef.current = { baseline: quickAction ? currentDisplaySnapshotRef.current : JSON.parse(currentSnapshotRef.current), latest: null }
    pendingConfirmedSavesRef.current += 1
    const acceptResponse = payload => {
      if (saveEpoch !== saveSessionEpochRef.current) return
      if (payload.state && (!saveBatchRef.current.latest || Number(payload.state.revision) >= Number(saveBatchRef.current.latest.revision))) saveBatchRef.current.latest = payload.state
    }
    const moveSnapshot = isolatedMove ? lastServerSnapshotRef.current : null
    confirmedSaveRef.current = true
    setConfirmedSaving(true)
    if (stateSaveTimerRef.current) pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1)
    pendingStateSaves.current += 1
    stateSaveGenerationRef.current += 1
    window.clearTimeout(stateSaveTimerRef.current)
    stateSaveTimerRef.current = null
    try {
      // The modal draft has not been published to React state: a debounce
      // cannot submit it prematurely or announce success before confirmation.
      await stateSaveQueue.current
      if (saveEpoch !== saveSessionEpochRef.current) throw new Error('La sesión cambió antes del guardado.')
      const serialized = currentSnapshotRef.current
      const local = quickAction ? currentDisplaySnapshotRef.current : JSON.parse(serialized)
      if (pendingConfirmedSavesRef.current === 1 && !saveBatchRef.current.latest) saveBatchRef.current.baseline = local
      if (quickAction && quickCommandBaseRef.current.serialized !== lastPersistedSnapshotRef.current) {
        quickCommandBaseRef.current = { serialized: lastPersistedSnapshotRef.current, value: JSON.parse(lastPersistedSnapshotRef.current || 'null') }
      }
      const base = quickAction ? quickCommandBaseRef.current.value : JSON.parse(lastPersistedSnapshotRef.current || 'null')
      if (!base) throw new Error('Esperá a que termine de cargar la agenda.')
      if (independentService && !saveBatchRef.current.latest) saveBatchRef.current.baseline = base
      if (isolatedMove) {
        if (serialized !== lastPersistedSnapshotRef.current) throw new Error('Guardá los cambios pendientes de la agenda antes de reasignar el servicio.')
        const serverSnapshot = moveSnapshot
        if (!serverSnapshot) throw new Error('Esperá a que termine de cargar la agenda.')
        const payload = await stateRepository.commit(await buildOperations(serverSnapshot), serverSnapshot.revision)
        acceptResponse(payload)
        return payload
      }
      let snapshot = local
      if (combinePendingState) {
        const pendingOperations = !independentService && serialized !== lastPersistedSnapshotRef.current ? stateOperations(base, local) : []
        const commandOperations = await buildOperations(local)
        const operations = alignDisplayBaselines && Number(lastServerSnapshotRef.current?.revision) === Number(stateRevisionRef.current)
          ? alignOperationBaselines([...pendingOperations, ...commandOperations], base, lastServerSnapshotRef.current)
          : [...pendingOperations, ...commandOperations]
        release = saveActivityRef.current.acquire(operationScopes(operations))
        let payload
        try {
          payload = await stateRepository.commit(operations, stateRevisionRef.current)
        } catch (error) {
          const recordConflict = error?.status === 409 && error?.payload?.code === 'RECORD_WRITE_CONFLICT'
          if (!rebaseOnRecordConflict || !recordConflict || pendingOperations.length) throw error
          // Monthly configuration is an explicit command whose draft lives in
          // the modal. If its base became stale while the modal was open, read
          // the current state and rebuild the same command against that state.
          const remote = await stateRepository.load()
          payload = await stateRepository.commit(await buildOperations(remote), Number(remote.revision))
        }
        acceptResponse(payload)
        return payload
      }
      if (serialized !== lastPersistedSnapshotRef.current) {
        const flushed = await stateRepository.save({ ...local, base, revision: stateRevisionRef.current })
        stateRevisionRef.current = Number(flushed.revision)
        lastPersistedSnapshotRef.current = serialized
        snapshot = flushed.state
      }
      const payload = await buildOperations(snapshot)
      acceptResponse(payload)
      return payload
    } finally {
      release?.()
      if (saveEpoch === saveSessionEpochRef.current) {
      pendingConfirmedSavesRef.current = Math.max(0, pendingConfirmedSavesRef.current - 1)
      pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1)
      confirmedSaveRef.current = pendingConfirmedSavesRef.current > 0
      setConfirmedSaving(confirmedSaveRef.current)
      if (!confirmedSaveRef.current) {
        const batch = saveBatchRef.current
        saveBatchRef.current = null
        if (batch?.latest) {
          saveDraftConflictRef.current = false
          applyRemoteState(batch.latest, { preserveFrom: batch.baseline })
        }
      }
      }
    }
  }
  const persistWeeklyService = command => persistStateCommand(snapshot => (
    command.operation === 'service-preparation'
      ? servicePreparationOperations(snapshot, command)
      : command.operation === 'service-journeys'
      ? planServiceJourneyOperations(snapshot, { ...command, today: currentLocalDate(), teamsForDate: reschedulingTeams, createId: createTaskId })
      : command.operation === 'service-confirmation'
      ? serviceConfirmationOperations(snapshot, { ...command, today: currentLocalDate() })
      : command.sourceDay && (command.task?.vehicleControl || command.advanceToFriday)
      ? weeklyServiceMoveOperations(snapshot, command)
      : command.operation === 'team-members'
      ? weeklyTeamMemberOperations(snapshot, command)
      : command.operation === 'team-remove'
        ? weeklyTeamRemovalOperations(snapshot, { ...command, allowVehicleControlRemoval: granularAccess ? allowed('vehicle.controls.omit') : authUser?.roleCode === 'administrator' })
        : command.operation === 'task-remove'
          ? weeklyTaskRemovalOperations(snapshot, command)
      : command.dailyDraft
        ? dailyServiceOperations(lastServerSnapshotRef.current, stateRevisionRef.current, command)
        : weeklyServiceOperations(snapshot, command)
  ), { combinePendingState: true, alignDisplayBaselines: true, independentService: !command.sourceDay && (!command.operation || ['service-preparation', 'team-members'].includes(command.operation)), quickAction: ['service-preparation', 'team-members'].includes(command.operation), isolatedMove: Boolean(command.sourceDay && (command.task?.vehicleControl || command.advanceToFriday)) })
  const persistWeeklyConfiguration = buildNext => persistStateCommand(snapshot => stateOperations(snapshot, buildNext(snapshot)), { combinePendingState: true, rebaseOnRecordConflict: true })
  const roleBaseline = id => structuredClone(lastServerSnapshotRef.current?.roles?.find(role => String(role.id) === String(id)))
  const persistRole = (before, after) => persistStateCommand(() => [{ path: ['roles', { key: 'id', id: String(after.id) }], before: before || null, after, existed: Boolean(before), exists: true }], { combinePendingState: true, independentService: true })
  const employeeBaseline = id => structuredClone(lastServerSnapshotRef.current?.employees?.find(employee => String(employee.id) === String(id)) || null)
  const persistEmployee = (before, after) => persistStateCommand(() => employeeOperations(before, after), { combinePendingState: true, independentService: true })
  const persistAgendaRecords = (before, records) => persistStateCommand(() => stateRepository.commit(stateOperations({ history: before }, { history: records }), stateRevisionRef.current))
  const persistCollection = command => persistStateCommand(() => collectionRepository.manage(command))
  const persistSubscriptionCorrection = command => persistStateCommand(() => subscriptionRepository.correct(command))
  const reschedulingTeams = (day, sourceWeekly = weekly) => {
    if (!day || isSunday(day)) return []
    const plan = dailyPlanWithMonthlyTeams(day, sourceWeekly)
    let choices = renumberVisibleWeeklyTeams(applyRemovedWeeklyTeams(applyRemovedWeeklySlots(applyRemovedWeeklyTasks(plan?.teams || [], plan?.removedTaskIds || []), plan?.removedSlots || []), plan?.removedTeams || []))
    if (isSaturday(day)) {
      if (!choices.length && !plan?.removedTeams?.length) choices = [{ teamId: `history-guard-${day}`, label: 'Equipo 1', memberIds: [], members: [], tasks: [] }]
      choices = assignGuardToEmptySaturday(normalizeSaturdayTeams(choices, day, sourceWeekly), day, sourceWeekly, activeTechs)
      if (advancedGuardForSaturdayDate(day, sourceWeekly, choices)) return []
    }
    return choices.filter(team => team.memberIds?.length)
  }
  const historyScheduling = {
    weekly,
    assignedTeamsForDate: day => reschedulingTeams(day),
    teamsForDate: (day, time, record) => {
      if (!completeRescheduleSlot(day, time)) return []
      const choices = reschedulingTeams(day)
      const occupied = choices.map(team => ({ ...team, tasks: (team.tasks || []).map(task => taskForScheduleOccupancy(taskWithServiceEstimate(task, resolveServiceForTask(task, services)), day, history)).filter(Boolean) }))
      return availableRescheduleTeams(occupied, taskWithServiceEstimate(record, resolveServiceForTask(record, services)), day, time, weekly)
    },
    save: (base, day, teamId, time) => persistStateCommand(snapshot => {
      const team = reschedulingTeams(day, snapshot.agenda?.weekly).find(item => String(item.teamId) === String(teamId))
      return historyRescheduleOperations(snapshot, { base, day, time, team, today: currentLocalDate() })
    }, { combinePendingState: true })
  }
  const persistHistoryRecord = async (base, record, categoryCorrection = null) => {
    const updates = Array.isArray(base) ? base : null
    try {
      const payload = await persistStateCommand(() => updates
        ? historyRecordRepository.updateMany(updates)
        : categoryCorrection ? historyRecordRepository.correctCategory(base, categoryCorrection) : historyRecordRepository.update(base, record))
      setNotice(updates
        ? `${updates.length} servicios se actualizaron correctamente.`
        : 'El servicio se actualizó correctamente.')
      return payload
    } catch (error) {
      setNotice(`${updates ? 'No se actualizaron los servicios seleccionados.' : 'No se guardó el cambio del servicio.'} ${error.message || 'Intentá nuevamente.'}`)
      throw error
    }
  }
  const persistHistoryRecordRemoval = async record => {
    try {
      const payload = await persistStateCommand(() => historyRecordRepository.remove(record))
      setNotice(record?.vehicleControl ? 'El control vehicular fue eliminado correctamente.' : 'El servicio fue eliminado correctamente.')
      return payload
    } catch (error) {
      setNotice(`No se eliminó el servicio. ${error.message || 'Intentá nuevamente.'}`)
      throw error
    }
  }
  const applyCustomerImportState = payload => {
    hydratingStateRef.current = true
    stateRevisionRef.current = Number(payload?.revision ?? stateRevisionRef.current ?? 0)
    setStateRevision(stateRevisionRef.current)
    if (!Array.isArray(payload?.customers)) {
      hydratingStateRef.current = false
      return false
    }
    setCustomers(payload.customers.map(customer => ({
      ...customer,
      customerId: customer.customerId || createCustomerId(),
      kind: customerKind(customer),
      name: normalizeCustomerName(customer.name)
    })))
    return true
  }
  globalThis.__pignusRefreshRemoteState = refreshRemoteState
  const endInvalidatedSession = message => {
    if (loggingOutRef.current) return
    saveSessionEpochRef.current += 1
    pendingConfirmedSavesRef.current = 0
    confirmedSaveRef.current = false
    setConfirmedSaving(false)
    saveBatchRef.current = null
    saveActivityRef.current = createSaveActivity()
    if (stateSaveTimerRef.current) window.clearTimeout(stateSaveTimerRef.current)
    stateSaveTimerRef.current = null
    pendingStateSaves.current = 0
    hydratingStateRef.current = true
    clearOperationalStorage()
    setRoles([]); setEmployees([]); setServices([]); setVehicles([]); setHistory([]); setCustomers([]); setWeekly({})
    setAuthUser(null); setDatabaseReady(false); setDatabaseError(''); setStateRevision(null); setModule('dashboard'); setNotice('')
    setSessionEndedMessage(message || 'Esta sesión se cerró porque la cuenta fue abierta en otro dispositivo. Iniciá sesión nuevamente para continuar acá.')
  }
  useEffect(() => {
    if (!authUser) return
    hydratingStateRef.current = true
    saveSessionEpochRef.current += 1
    pendingConfirmedSavesRef.current = 0
    confirmedSaveRef.current = false
    setConfirmedSaving(false)
    saveBatchRef.current = null
    saveActivityRef.current = createSaveActivity()
    lastServerSnapshotRef.current = null
    stateRepository.prime(null)
    hydrationBaselineRef.current = null
    saveDraftConflictRef.current = false
    lastPersistedSnapshotRef.current = null
    remoteConflictRevisionRef.current = null
    setDatabaseReady(false)
    setDatabaseError('')
    stateRevisionRef.current = null
    setStateRevision(null)
    setRoles([]); setEmployees([]); setServices([]); setVehicles([]); setHistory([]); setCustomers([]); setWeekly({})
    setTeams([{ teamId: createTeamId(), memberIds: [], members: [], tasks: [] }])
    setDate(currentLocalDate())
    clearOperationalStorage()
    const initialState = initialRemoteStateRef.current
    initialRemoteStateRef.current = null
    if (initialState) {
      applyRemoteState(initialState)
      return
    }
    stateRepository.load().then(applyRemoteState).catch(error => {
      setDatabaseError(error.message || 'No se pudo conectar con la base de datos.')
    })
  }, [authUser?.id])
  useEffect(() => {
    if (!databaseReady || !hydratingStateRef.current) return undefined
    window.clearTimeout(hydrationTimerRef.current)
    const timer = window.setTimeout(() => {
      lastPersistedSnapshotRef.current = hydrationBaselineRef.current || currentSnapshotRef.current
      hydrationBaselineRef.current = null
      hydratingStateRef.current = false
      hydrationTimerRef.current = null
      if (lastPersistedSnapshotRef.current !== currentSnapshotRef.current && !saveDraftConflictRef.current) setSaveHydrationVersion(value => value + 1)
    }, 150)
    hydrationTimerRef.current = timer
    return () => window.clearTimeout(timer)
  }, [databaseReady, serializedStateSnapshot])
  useEffect(() => {
    if (isReadOnly || saveDraftConflictRef.current) return
    if (confirmedSaveRef.current || loggingOutRef.current || hydratingStateRef.current || serializedStateSnapshot === lastPersistedSnapshotRef.current || !databaseReady || stateRevision === null || !authUser || legacyTechnician) return
    // Desde que existe un cambio local pendiente (incluido el debounce) se
    // bloquea la recarga periódica para que no restaure la versión anterior.
    pendingStateSaves.current += 1
    const saveGeneration = stateSaveGenerationRef.current
    let saveStarted = false
    const timer = setTimeout(() => {
      stateSaveTimerRef.current = null
      if (loggingOutRef.current) {
        pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1)
        return
      }
      saveStarted = true
      const snapshot = stateSnapshot
      stateSaveQueue.current = stateSaveQueue.current.catch(() => {}).then(async () => {
        if (saveGeneration !== stateSaveGenerationRef.current) return
        if (confirmedSaveRef.current) return
        let base = null
        try { base = lastPersistedSnapshotRef.current ? JSON.parse(lastPersistedSnapshotRef.current) : null } catch { base = null }
        const changedBase = base ? compactStateBase(base, snapshot) : null
        const operations = stateOperations(changedBase || base, snapshot)
        const aligned = Number(lastServerSnapshotRef.current?.revision) === Number(stateRevisionRef.current)
          ? alignOperationBaselines(operations, base, lastServerSnapshotRef.current)
          : operations
        const payload = await stateRepository.commit(aligned, stateRevisionRef.current)
        stateRevisionRef.current = Number(payload.revision)
        // Keep the authoritative baseline current even when typing continued
        // during the request and the response cannot replace the visible draft.
        if (payload.state) lastServerSnapshotRef.current = structuredClone(payload.state)
        lastPersistedSnapshotRef.current = serializedStateSnapshot
        remoteConflictRevisionRef.current = null
        if (payload.state && currentSnapshotRef.current === serializedStateSnapshot) {
          applyRemoteState(payload.state)
          if (payload.merged) setNotice('Tus cambios se guardaron junto con las actualizaciones compatibles de otra sesión.')
        } else setStateRevision(stateRevisionRef.current)
      }).catch(async error => {
        if (error.status === 401) {
          endInvalidatedSession(error.message)
          return
        }
        if (await recoverStateRevisionConflict(error, {
          invalidatePendingSaves: () => { stateSaveGenerationRef.current += 1 },
          loadRemoteState: stateRepository.load,
          applyRemoteState,
          notify: setNotice,
          cancelled: () => loggingOutRef.current
        })) return
        setNotice(`No se guardó el último cambio. ${error.message || 'Comprobá la conexión antes de continuar.'}`)
      })
        .finally(() => { pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1) })
    }, 750)
    stateSaveTimerRef.current = timer
    return () => {
      clearTimeout(timer)
      if (stateSaveTimerRef.current === timer) stateSaveTimerRef.current = null
      if (!saveStarted) pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1)
    }
  }, [databaseReady, authUser, isReadOnly, serializedStateSnapshot, saveHydrationVersion])
  useEffect(() => {
    // Sincronización ligera de todos los módulos. Evita que dos sesiones abiertas
    // muestren indicadores, historial o agenda de revisiones diferentes.
    if (!databaseReady || !authUser) return undefined
    if (legacyTechnician) return undefined
    let refreshing = false
    let stopped = false
    const pendingRemoteSnapshot = createRevisionSnapshotCache()
    const refreshRemoteState = async () => {
      // Un PUT de esta misma pestaña aumenta la revisión del servidor antes de
      // que React alcance a actualizar stateRevision. No debe tratarse como un
      // cambio externo durante esa pequeña ventana.
      if (confirmedSaveRef.current || loggingOutRef.current || refreshing || pendingStateSaves.current > 0 || document.visibilityState === 'hidden') return
      const canRefresh = remote => canRefreshRemote({
        saving: confirmedSaveRef.current || pendingStateSaves.current > 0,
        draft: hasUnsavedFormFields() || Boolean(weeklyNavigationGuard.current?.hasDraft?.()),
        current: isReadOnly ? lastPersistedSnapshotRef.current : currentSnapshotRef.current,
        baseline: lastPersistedSnapshotRef.current,
        remote
      })
      refreshing = true
      try {
        let data
        try {
          data = await stateRepository.revision()
        } catch (error) {
          if (error.status === 401) {
            if (!stopped) endInvalidatedSession(error.message)
            return
          }
          throw error
        }
        const remoteRevision = Number(data.revision)
        if (!stopped && remoteRevision !== Number(stateRevisionRef.current)) {
          const remoteState = await pendingRemoteSnapshot(remoteRevision, () => stateRepository.load())
          if (stopped || loggingOutRef.current) return
          if (remoteState.sessionUser) setAuthUser(current => current === authUser ? reconcileSessionUser(current, remoteState.sessionUser) : current)
          const hasLocalChanges = !canRefresh(remoteState)
          if (hasLocalChanges) {
            if (remoteConflictRevisionRef.current !== remoteRevision) setNotice(REMOTE_EDIT_NOTICE)
            remoteConflictRevisionRef.current = remoteRevision
          } else {
            if (!stopped && !loggingOutRef.current && canRefresh(remoteState)) {
              applyRemoteState(remoteState)
              setNotice(previous => previous.startsWith('Hay cambios guardados desde otra sesión') ? '' : previous)
            } else if (!stopped && !loggingOutRef.current) {
              setNotice(REMOTE_EDIT_NOTICE)
              remoteConflictRevisionRef.current = Number(remoteState.revision)
            }
          }
        } else if (remoteRevision === Number(stateRevisionRef.current)) {
          remoteConflictRevisionRef.current = null
          if (!stopped) setNotice(previous => previous.startsWith('Hay cambios guardados desde otra sesión') ? '' : previous)
        }
      } catch {
        if (!stopped) setNotice('No se pudo comprobar si existen cambios de otra sesión.')
      } finally {
        refreshing = false
      }
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void refreshRemoteState()
    }
    void refreshRemoteState()
    const timer = window.setInterval(refreshWhenVisible, 5000)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('pageshow', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('pageshow', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [databaseReady, authUser, isReadOnly, stateRevision])
  const ask = (title, detail, action, destructive = false) => setConfirmation({ title, detail, action, destructive })
  const updateTask = (team, task, patch) => {
    const changesTime = Object.prototype.hasOwnProperty.call(patch, 'time')
    const timeInput = changesTime && document.activeElement?.matches?.('input[type="time"]') ? document.activeElement : null
    // El control horario emite varios cambios mientras se editan hora y minutos.
    // Reordenar en ese instante mueve el input enfocado y provoca parpadeos o
    // valores parciales. Se ordena una sola vez al terminar la edición.
    if (timeInput && !timeInput.dataset.sortOnBlur) {
      timeInput.dataset.sortOnBlur = 'true'
      timeInput.addEventListener('blur', () => {
        delete timeInput.dataset.sortOnBlur
        setTeams(previous => previous.map((currentTeam, teamIndex) => teamIndex === team
          ? { ...currentTeam, tasks: sortTasksByTime(currentTeam.tasks) }
          : currentTeam))
      }, { once: true })
    }
    setTeams(previous => previous.map((currentTeam, teamIndex) => {
      if (teamIndex !== team) return currentTeam
      const tasks = currentTeam.tasks.map((currentTask, taskIndex) => taskIndex !== task ? currentTask : stampServiceRecord({ ...currentTask, ...patch }, authUser))
      const availableTasks = removeUnavailableDefaultSlots(tasks)
      return { ...currentTeam, tasks: changesTime && !timeInput ? sortTasksByTime(availableTasks) : availableTasks }
    }))
  }
  const isAdministrator = permissionUser?.roleCode === 'administrator' || (!permissionUser?.roleCode && normalizeRoleName(permissionUser?.role) === 'administrador')
  useEffect(() => {
    if (!isAdministrator || !databaseReady) return
    const rotation = default2026GuardRotationFor(activeTechs)
    if (rotation.length !== DEFAULT_2026_GUARD_ROTATION.length) return
    setWeekly(previous => previous?._annualGuards?.['2026'] ? previous : {
      ...previous,
      _annualGuards: {
        ...(previous?._annualGuards || {}),
        2026: { startDate: firstSaturdayOfYear(2026), rotation }
      }
    })
  }, [isAdministrator, databaseReady, activeTechs.map(tech => `${tech.id}:${tech.name}`).join('|')])
  const modulePermissions = granularAccess ? { ...access, help: true } : isOperator ? resolvedRolePermissions({ name: 'Operador' }) : isSupervisor ? resolvedRolePermissions({ name: 'Supervisor' }) : { ...resolvedRolePermissions(activeRole), dashboard: true, help: true }
  modulePermissions.tickets = allowed('tickets.view')
  modulePermissions.operationalPlanning = access.operationalPlanning
  const notificationAccess = useMemo(() => dashboardNotificationAccess(permissionUser), [permissionUser])
  const notificationsEnabled = isAdministrator || allowed('notifications.tickets') || Object.entries(notificationAccess).some(([key, value]) => key.startsWith('notifications.') && value === true)
  const passwordResetState = usePasswordResetRequests({ enabled: Boolean(authUser && databaseReady && notificationAccess['notifications.passwordRequests']), accountKey: authUser?.id || authUser?.email })
  const [notificationNow, setNotificationNow] = useState(Date.now)
  const [activeNotificationId, setActiveNotificationId] = useState(null)
  const [collectionOpenRequest, setCollectionOpenRequest] = useState(null)
  const [ticketOpenRequest, setTicketOpenRequest] = useState(null)
  const [mapCustomer, setMapCustomer] = useState(null)
  useEffect(() => {
    if (!authUser || !databaseReady || !notificationsEnabled) return undefined
    const refresh = () => { if (!document.hidden) setNotificationNow(Date.now()) }
    // Expiry rules use local minutes: update at the minute boundary, not 30s later.
    let timer
    const tick = () => {
      refresh()
      timer = window.setTimeout(tick, 60000 - Date.now() % 60000 + 20)
    }
    tick()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [authUser?.id, databaseReady, notificationsEnabled])
  const ticketNotifications = useTicketNotifications({ enabled: Boolean(authUser && databaseReady && allowed('notifications.tickets')), userKey: authUser?.id || authUser?.email })
  useEffect(() => {
    const open = event => { if (allowed('tickets.view')) requestNavigation(() => { setTicketOpenRequest(event.detail); setModule('tickets') }) }
    window.addEventListener('open-ticket', open)
    return () => window.removeEventListener('open-ticket', open)
  }, [permissionUser])
  const notifications = useMemo(() => [...selectDashboardNotifications({
    history, vehicles, customers, passwordResetRequests: passwordResetState.requests,
    today: currentLocalDate(), now: notificationNow, isAdministrator, user: permissionUser
  }).filter(item => item.target?.type !== 'followup'), ...ticketNotifications], [history, vehicles, customers, passwordResetState.requests, notificationNow, isAdministrator, permissionUser, ticketNotifications])
  const notificationSnapshotRef = useRef(notifications)
  notificationSnapshotRef.current = notifications
  const notificationCustomers = useMemo(() => visibleNotificationCustomers(customers, history, permissionUser), [customers, history, permissionUser])
  const openNotification = notification => requestNavigation(() => {
    const current = notificationSnapshotRef.current.find(item => item.id === notification.id)
    if (!current) return
    const target = current.target
    setMenuOpen(false)
    if (target.type === 'ticket' && allowed('tickets.view')) {
      setTicketOpenRequest({ ticketId: target.ticketId }); setModule('tickets')
    } else if (target.type === 'collection' && (isAdministrator || modulePermissions.collections)) {
      setCollectionOpenRequest({ id: target.recordId }); setModule('collections')
    } else if (target.type === 'history' && (isAdministrator || modulePermissions.history)) {
      setHistoryEntryFilter({ pendingGroup: target.pendingGroup, date: target.date }); setModule('history')
    } else if (target.type === 'reservation' && (isAdministrator || modulePermissions.weekly)) {
      const record = history.find(item => String(item.id) === target.recordId)
      if (record) { setWeeklyOpenRequest({ id: record.id }); setModule('weekly') }
    } else if (target.type === 'vehicle' && (isAdministrator || modulePermissions.vehicles)) {
      const vehicle = vehicles.find(item => String(item.id) === target.vehicleId)
      if (vehicle) { if (target.edit) setVehicleEditRequest(vehicle.id); setModule('vehicles') }
    } else {
      setActiveNotificationId(notification.id)
    }
  })
  const activeNotification = notifications.find(item => item.id === activeNotificationId)
  useEffect(() => {
    if (activeNotificationId && !activeNotification) setActiveNotificationId(null)
  }, [activeNotificationId, activeNotification])
  const technicalEnabled = granularAccess ? allowed('technical.view') && technicalEligible : !isReadOnly && technicalFunctionEnabled
  modulePermissions.myServices = technicalEnabled
  const nav = NAVIGATION_ITEMS.filter(({ id }) => {
    if (id === 'myServices') return technicalEnabled
    if (id === 'agenda') return granularAccess && modulePermissions.agenda
    if (id === 'audit') return isAdministrator || (granularAccess && modulePermissions.audit)
    if (id === 'help') return !isReadOnly
    return isAdministrator || modulePermissions[id]
  })
  useEffect(() => {
    if (!isAdministrator && !modulePermissions[module] && nav[0]) setModule(nav[0].id)
  }, [isAdministrator, module, activeRole, technicalEnabled])
  const title = navigationLabel(module)
  useEffect(() => {
    document.title = authUser ? `${title || 'Agenda técnica'} | PIGNUS` : 'Ingresar | PIGNUS'
  }, [title, authUser])
  const logout = async ({ requireServerLogout = false } = {}) => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    const hadPendingStateSave = pendingStateSaves.current > 0 || Boolean(stateSaveTimerRef.current)
    if (stateSaveTimerRef.current) {
      clearTimeout(stateSaveTimerRef.current)
      stateSaveTimerRef.current = null
      pendingStateSaves.current = 0
    }
    try {
      // El debounce puede seguir pendiente cuando se confirma el cierre de
      // sesión. Esperamos cualquier PUT ya iniciado y luego guardamos de forma
      // explícita la instantánea más reciente antes de invalidar la sesión.
      await stateSaveQueue.current.catch(() => {})
      const latestSerializedSnapshot = currentSnapshotRef.current
      const canPersistLatestSnapshot = !isReadOnly && databaseReady && stateRevisionRef.current !== null && authUser && !legacyTechnician
      if (canPersistLatestSnapshot && hadPendingStateSave && latestSerializedSnapshot && latestSerializedSnapshot !== lastPersistedSnapshotRef.current) {
        const snapshot = JSON.parse(latestSerializedSnapshot)
        let base = null
        try { base = lastPersistedSnapshotRef.current ? JSON.parse(lastPersistedSnapshotRef.current) : null } catch { base = null }
        const changedBase = base ? compactStateBase(base, snapshot) : null
        const payload = await stateRepository.save({ revision: stateRevisionRef.current, ...(changedBase && Object.keys(changedBase).length ? { base: changedBase } : {}), ...snapshot })
        stateRevisionRef.current = Number(payload.revision)
        lastPersistedSnapshotRef.current = latestSerializedSnapshot
      }
    } catch (error) {
      loggingOutRef.current = false
      setLoggingOut(false)
      throw new Error(`No se pudo guardar la agenda antes de cerrar sesión. La sesión sigue abierta para que puedas reintentar. ${error.message || ''}`.trim())
    }

    setLoggingOut(true)
    try {
      const response = await fetchWithTimeout('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (!response.ok) throw new Error('No se pudo invalidar la sesión en el servidor.')
    } catch (error) {
      console.error('Error al cerrar la sesión en el servidor.', error)
      if (requireServerLogout) {
        loggingOutRef.current = false
        setLoggingOut(false)
        throw error
      }
    }
    {
      clearOperationalStorage()
      setRoles([]); setEmployees([]); setServices([]); setVehicles([]); setHistory([]); setCustomers([]); setWeekly({})
      setAuthUser(null); setDatabaseReady(false); setDatabaseError(''); setStateRevision(null); setModule('dashboard'); setNotice('')
      loggingOutRef.current = false
      setLoggingOut(false)
    }
  }
  useDeploymentUpdate({ active: Boolean(authUser), busy: confirmedSaving || loggingOut, guard: weeklyNavigationGuard, logout })
  // No consultar la agenda compartida: sólo campos editados en esta pestaña.
  const requestLogout = () => requestNavigation(() => setConfirmation(hasUnsavedFormFields()
    ? { title: 'Cambios sin guardar en esta pestaña', detail: 'Tenés cambios en un formulario de esta pestaña que todavía no guardaste. Si cerrás sesión, se perderán esos cambios locales. La agenda compartida y los datos de otras sesiones no se eliminarán.', action: logout, destructive: true, confirmLabel: 'Descartar edición local y salir' }
    : { title: 'Cerrar sesión', detail: '¿Querés cerrar sesión?', action: logout, confirmLabel: 'Sí, cerrar sesión' }))
  useSessionLifecycle({
    enabled: Boolean(authUser),
    idleTimeoutMs: authUser?.roleCode === 'technician' ? TECHNICIAN_SESSION_IDLE_TIMEOUT_MS : SESSION_IDLE_TIMEOUT_MS,
    statusIntervalMs: authUser?.roleCode === 'technician' ? TECHNICIAN_SESSION_STATUS_INTERVAL_MS : SESSION_STATUS_INTERVAL_MS,
    onInvalidated: endInvalidatedSession,
    onSessionUser: incoming => setAuthUser(current => current === authUser ? reconcileSessionUser(current, incoming) : current),
    onIdle: async () => {
      setSessionEndedMessage(authUser?.roleCode === 'technician'
        ? 'La sesión técnica se cerró por seguridad después de 24 horas sin actividad. Iniciá sesión nuevamente para continuar.'
        : 'La sesión se cerró por seguridad después de 1 hora sin actividad. Iniciá sesión nuevamente para continuar.')
      await logout()
    }
  })
  useEffect(() => {
    // Intercepta el botón común del encabezado para aplicar la verificación de agenda antes de salir.
    const button = document.querySelector('.topbar .logout-button')
    if (!button) return undefined
    const intercept = event => { event.preventDefault(); event.stopPropagation(); requestLogout() }
    button.addEventListener('click', intercept, true)
    return () => button.removeEventListener('click', intercept, true)
  })
  useEffect(() => {
    const refresh = () => requestManualRefresh({
      busy: confirmedSaveRef.current || loggingOutRef.current || pendingStateSaves.current > 0 || Boolean(stateSaveTimerRef.current) || Boolean(document.querySelector('.confirm-modal .confirm-actions button:disabled, .modal[aria-busy="true"], form[aria-busy="true"], .technician-page[aria-busy="true"]')),
      dirty: hasRefreshDraft() || Boolean(document.querySelector('[data-unsaved-attachments="true"]')) || Boolean(weeklyNavigationGuard.current?.hasDraft?.()) || (!isReadOnly && !legacyTechnician && currentSnapshotRef.current !== lastPersistedSnapshotRef.current),
      online: navigator.onLine !== false,
      confirm: message => window.confirm(message),
      notify: message => window.alert(message),
      reload: () => window.location.reload()
    })
    window.addEventListener('pignus:refresh', refresh)
    return () => window.removeEventListener('pignus:refresh', refresh)
  })
  if (loggingOut) return <main className="login-page"><SystemState type="syncing" inverse title="Cerrando sesión segura…" detail="Esperá mientras cerramos tu sesión." /></main>
  if (authLoading) return <main className="login-page"><SystemState type="loading" inverse title="Verificando sesión segura…" detail="Estamos recuperando tu acceso y los datos autorizados." /></main>
  if (!authUser) return <Suspense fallback={<SystemState type="loading" title="Cargando acceso…" />}><Login initialError={sessionEndedMessage} onLogin={(user, initialState) => { setSessionEndedMessage(''); setNotice(''); initialRemoteStateRef.current = initialState || null; setAuthUser(user) }} /></Suspense>
  if (!databaseReady) return <main className="login-page"><div className="login-card"><img src="/logo-pignus.png" alt="Pignus" /><p className="eyebrow">DATOS PROTEGIDOS</p><SystemState type={databaseError ? 'error' : 'loading'} title={databaseError ? 'No se pudo cargar la agenda' : 'Cargando información autorizada…'} detail={databaseError || 'Estamos preparando la información permitida para tu perfil.'} action={databaseError ? () => { setDatabaseError(''); stateRepository.load().then(applyRemoteState).catch(error => setDatabaseError(error.message || 'No se pudo conectar con la base de datos.')) } : undefined} /><button title="Cerrá tu sesión; necesitarás tus credenciales para volver a ingresar." className="secondary" type="button" onClick={logout}><Icon name="logout" size={16} />Cerrar sesión</button></div></main>
  if (legacyTechnician || (granularAccess && technicalEnabled && !['dashboard', 'weekly', 'agenda', 'history', 'collections', 'accounts', 'map', 'employees', 'services', 'vehicles', 'settings', 'audit'].some(key => modulePermissions[key]))) return <PermissionsProvider user={permissionUser}><TechnicianPortalErrorBoundary logout={logout}><Suspense fallback={<SystemState type="loading" title="Cargando agenda técnica…" />}><TechnicianPortal user={permissionUser} history={history} setHistory={setHistory} vehicles={vehicles} setVehicles={setVehicles} logout={logout} sessionInvalidated={endInvalidatedSession} /></Suspense></TechnicianPortalErrorBoundary></PermissionsProvider>

  if (module === 'myServices' && technicalEnabled) return <PermissionsProvider user={permissionUser}><Suspense fallback={<SystemState type="loading" title="Cargando servicios…" />}><PersonalTechnicalServices user={permissionUser} logout={logout} sessionInvalidated={endInvalidatedSession} onBack={() => setModule(nav.find(item => item.id !== 'myServices')?.id || 'help')} /></Suspense></PermissionsProvider>

  return <PermissionsProvider user={permissionUser}><FrozenMonthsContext.Provider value={weekly?._frozenMonthOptions ?? [4, 6]}><ServiceJourneysContext.Provider value={{history, today: currentLocalDate(), enabled: granularAccess ? allowed('planning.journeys') : !isReadOnly && (isAdministrator || Boolean(modulePermissions.agenda || modulePermissions.weekly)), teamsForDate: reschedulingTeams, availableTeams: historyScheduling.teamsForDate, save: async (base, visits) => {
        for (const year of new Set(visits.map(visit => String(visit.date).slice(0,4)))) {
          const response = await fetchWithTimeout('/api/holidays?year=' + encodeURIComponent(year), { credentials: 'same-origin' })
          if (!response.ok) throw new Error('No se pudo verificar el calendario laboral. No se guardaron las jornadas.')
          const calendar = await response.json()
          for (const visit of visits) if ((calendar.holidays || []).some(holiday => holiday.date === visit.date) && weekly._holidayOverrides?.[visit.date]?.status !== 'working') throw new Error('La fecha ' + visit.date + ' es feriado y no está habilitada.')
        }
        await persistWeeklyService({ operation: 'service-journeys', base, visits })
      }}}><div className={`app-shell ${desktopSidebar && sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-theme={theme}>{confirmedSaving && <div className="confirmed-save-status" role="status" aria-live="polite"><p>Guardando cambios… Podés seguir consultando la agenda.</p></div>}<aside id="main-navigation" aria-label="Menú principal" className={`sidebar ${menuOpen && !desktopSidebar ? 'open' : ''} ${desktopSidebar && sidebarCollapsed ? 'sidebar-compact' : ''}`}><div className="brand" role="button" tabIndex={0} aria-label="Ir al inicio" onClick={() => requestNavigation(() => setModule(nav[0]?.id || 'dashboard'))} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); requestNavigation(() => setModule(nav[0]?.id || 'dashboard')) } }}><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><SidebarNavigation key={String(authUser.id || authUser.email)} items={nav} activeId={module} userKey={String(authUser.id || authUser.email)} compact={desktopSidebar && sidebarCollapsed} onExpand={() => setSidebarCollapsed(false)} onNavigate={id => { if (id !== module) requestNavigation(() => { setModule(id); setMenuOpen(false) }); else setMenuOpen(false) }} /><div className="sidebar-session"><strong>{authUser.name}</strong><small>{authUser.email}</small><small>{authUser.role}</small></div><div className="sidebar-bottom">v2.0 · Agenda técnica</div></aside>{menuOpen && !desktopSidebar && <button title="Cerrá el menú lateral para volver al contenido." className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main ><header className="topbar"><button type="button" className="sidebar-toggle topbar-icon-button" aria-controls="main-navigation" aria-expanded={desktopSidebar ? !sidebarCollapsed : menuOpen} aria-label={desktopSidebar ? (sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral') : (menuOpen ? 'Cerrar menú lateral' : 'Abrir menú lateral')} title={desktopSidebar ? (sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral') : 'Abrir o cerrar menú lateral'} onClick={() => desktopSidebar ? setSidebarCollapsed(value => !value) : setMenuOpen(value => !value)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><h1>{title}</h1><div id="module-description-slot" /></div><div className="profile">{notificationsEnabled && <NotificationCenter notifications={notifications} onSelect={openNotification} />}<FullscreenToggle /><button title={theme === 'light' ? 'Cambiá a colores oscuros para reducir el brillo de la pantalla.' : 'Cambiá a colores claros para visualizar la plataforma.'} className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><div className="profile-menu"><button title="Abrí la información de tu perfil y tu sesión." className="profile-trigger" onClick={() => setProfileOpen(open => !open)} aria-expanded={profileOpen}><span className="profile-avatar">{initials(authUser.name)}</span><span>{authUser.name}</span></button>{profileOpen && <div className="profile-popover"><b>{authUser.name}</b><span>{authUser.email}</span><small>{authUser.role}</small></div>}</div><RefreshButton /><button className="logout-button" disabled={confirmedSaving} onClick={() => setConfirmation({ title: 'Cerrar sesión', detail: '¿Querés cerrar sesión? Tendrás que volver a ingresar con tus credenciales para acceder al sistema.', action: logout, confirmLabel: 'Sí, cerrar sesión' })} title="Cerrá tu sesión; necesitarás tus credenciales para volver a ingresar."><Icon name="logout" size={17} /><span>Cerrar sesión</span></button></div></header><section className="content"><Suspense fallback={<SystemState type="loading" title="Cargando módulo…" detail="Estamos preparando esta pantalla." />}>{notice && <div className="notice" data-tone={noticeLevel} role={noticeLevel === 'error' || noticeLevel === 'offline' ? 'alert' : 'status'} aria-live={noticeLevel === 'error' || noticeLevel === 'offline' ? 'assertive' : 'polite'}><span><Icon name={noticeLevel === 'success' ? 'check' : 'alert'} size={16} />{notice}</span><button title="Ocultá este aviso; esta acción no modifica los datos." onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'help' && <HelpCenter onNavigate={id => requestNavigation(() => setModule(id))} isAdministrator={isAdministrator} allowedModules={nav.map(({ id }) => id)} />}{module === 'audit' && (granularAccess ? allowed('audit.view') : isAdministrator) && <AuditPage user={authUser} onBack={() => setModule('dashboard')} onOpenMenu={() => setMenuOpen(true)} logout={requestLogout} />}{module === 'dashboard' && <Dashboard onOpenCollections={allowed('collections.view') && allowed('records.financial') ? filters => requestNavigation(() => { setCollectionOpenRequest(filters); setModule('collections') }) : undefined} isAdministrator={isAdministrator} passwordResetState={passwordResetState} onOpenReservation={modulePermissions.weekly ? record => requestNavigation(() => { setWeeklyOpenRequest({ id: record.id }); setModule('weekly') }) : undefined} history={history} services={services} customers={customers} onEditVehicle={(granularAccess ? allowed('vehicles.edit') : isAdministrator && modulePermissions.vehicles) ? id => requestNavigation(() => { setVehicleEditRequest(id); setModule('vehicles') }) : undefined} />}{module === 'operationalPlanning' && modulePermissions.operationalPlanning && <OperationalPlanning {...{ weekly, activeTechs, vehicles, history, persistWeeklyConfiguration, setWeekly, setNotice }} authUser={permissionUser} permissions={modulePermissions} initialPeriod={planningPeriod} onReturnToAgenda={returnToWeekly} navigationGuardRef={weeklyNavigationGuard} />}{module === 'weekly' && <WeeklyPlanner onOpenPlanning={openOperationalPlanning} initialAnchor={weeklyAnchor} onAnchorChange={setWeeklyAnchor} confirmedRevision={stateRevision} openRequest={weeklyOpenRequest} onOpenRequestHandled={() => setWeeklyOpenRequest(null)} navigationGuardRef={weeklyNavigationGuard} {...{ persistWeeklyService, persistWeeklyConfiguration, weekly, setWeekly, customers, setCustomers, services, activeTechs, history, setHistory, setNotice, authUser: permissionUser, vehicles }} permissions={modulePermissions} openDaily={(nextDate, nextTeams) => { if (nextDate < currentLocalDate()) setHistoricalDate(nextDate); else { setHistoricalDate(null); setDate(nextDate); setTeams(nextTeams) } setModule('agenda') }} />}{module === 'agenda' && <Agenda navigationGuardRef={weeklyNavigationGuard} {...{ persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady, authUser: permissionUser }} date={historicalDate || date} setDate={nextDate => { if (nextDate < currentLocalDate()) setHistoricalDate(nextDate); else { setHistoricalDate(null); setDate(nextDate) } }} />}{module === 'tickets' && allowed('tickets.view') && <Tickets openRequest={ticketOpenRequest} />}{module === 'history' && <History initialFilter={historyEntryFilter} history={history} setHistory={setHistory} customers={customers} services={services} employees={activeTechs} authUser={permissionUser} canManage={isAdministrator || modulePermissions.historyManage} persistHistoryRecord={persistHistoryRecord} persistHistoryRecordRemoval={persistHistoryRecordRemoval} historyScheduling={historyScheduling} />}{module === 'map' && (isAdministrator || modulePermissions.map) && <><SubscriberMap customers={customers} onOpenCustomer={isAdministrator || modulePermissions.accounts ? setMapCustomer : undefined} />{mapCustomer && (isAdministrator || modulePermissions.accounts) && <CustomerDetail customer={customers.find(item => item.customerId === mapCustomer.customerId) || mapCustomer} history={history} services={services} close={() => setMapCustomer(null)} />}</>}{module === 'collections' && (isAdministrator || modulePermissions.collections) && <Collections history={history} customers={customers} canManage={isAdministrator || modulePermissions.collectionsManage} onSave={persistCollection} openRequest={collectionOpenRequest} onOpenRequestHandled={() => setCollectionOpenRequest(null)} setNotice={setNotice} />}{module === 'accounts' && <Accounts {...{ persistSubscriptionCorrection, services, customers, setCustomers, setNotice, ask, history, teams, weekly, stateRevision, refreshRemoteState, applyCustomerImportState }} permissions={modulePermissions} isAdministrator={isAdministrator} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask, history, teams, weekly, persistEmployee, employeeBaseline }} canEnableTechnical={granularAccess ? allowed('employees.technical') : isAdministrator} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask, history, teams, weekly }} />}{module === 'vehicles' && <Vehicles {...{ history, vehicles, setVehicles, setNotice, ask, isAdministrator, stateRevision, refreshRemoteState }} editRequest={vehicleEditRequest} onEditRequestHandled={() => setVehicleEditRequest(null)} />}{module === 'settings' && <>{allowed('tickets.configure') && <TicketSettings />}{(granularAccess ? allowed('settings.frozenMonths') : isAdministrator) && <FrozenMonthsSettings options={weekly?._frozenMonthOptions ?? [4, 6]} onSave={options => persistWeeklyConfiguration(snapshot => ({ ...snapshot, agenda: { ...snapshot.agenda, weekly: { ...snapshot.agenda?.weekly, _frozenMonthOptions: options } } }))} />}<Settings {...{ roles, setRoles, setNotice, ask, employees, weekly, persistWeeklyConfiguration, persistRole, roleBaseline }} canConfigureWorkday={granularAccess ? allowed('settings.workday.read') : isAdministrator || Boolean(modulePermissions.weeklyHours)} /></>}</Suspense></section></main>{activeNotification && <NotificationActionDialog key={activeNotification.id} notification={activeNotification} history={history} customers={notificationCustomers} passwordResetState={passwordResetState} close={() => setActiveNotificationId(null)} />}{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div></ServiceJourneysContext.Provider></FrozenMonthsContext.Provider></PermissionsProvider>

}

const Agenda = lazy(() => import('./features/agenda/presentation/DailyAgenda.jsx').then(module => ({ default: module.Agenda })))

const WeeklyPlanner = lazy(() => import('./features/agenda/presentation/WeeklyPlanner.jsx').then(module => ({ default: module.WeeklyPlanner })))

function NotificationActionDialog({ notification, history, customers, passwordResetState, close }) {
  const [busy, setBusy] = useState(false)
  const target = notification.target
  const retirementCustomer = target.type === 'softguard-retirement' ? customers.find(customer => String(customer.customerId) === target.customerId) : null
  if (target.type === 'softguard') return <SoftGuardVerification customers={customers} initialOpen showTrigger={false} onClose={close} />
  return <div className="modal-layer" onClick={event => { if (!busy && event.target === event.currentTarget) close() }}>
    <section className="modal notification-action-modal" role="dialog" aria-modal="true" aria-busy={busy || undefined} aria-labelledby="notification-action-title">
      <button type="button" className="close-modal" aria-label="Cerrar notificación" title="Cerrá el detalle; el aviso permanece hasta que se resuelva." disabled={busy} onClick={close}><Icon name="close" /></button>
      <p className="eyebrow">NOTIFICACIONES</p><h2 id="notification-action-title">{notification.title}</h2>
      {target.type === 'softguard-retirement'
        ? <SoftGuardRetirementReminder key={`${retirementCustomer?.customerId}:${retirementCustomer?.convertedFromAccount}:${retirementCustomer?.subscriptionEndedAt}`} customer={retirementCustomer} showHeading={false} onResolved={close} onBusyChange={setBusy} />
        : target.type === 'advance-request'
        ? <ServiceAdvanceRequestsReminder history={history.filter(record => String(record.id) === target.recordId)} />
        : target.type === 'password-reset'
          ? <PasswordResetReminder onManage={close} state={{ ...passwordResetState, requests: passwordResetState.requests.filter(request => String(request.id) === target.requestId) }} />
          : <p>{notification.detail}</p>}
    </section>
  </div>
}

function PasswordResetReminder({ state, onManage }) {
  const { can } = usePermissions()
  const { requests = [], error = '', resolve = () => {} } = state || {}
  if (!requests.length && !error) return null
  return <section className="password-reset-reminders" aria-label="Solicitudes de cambio de contraseña">{error && <p className="login-error" role="alert">{error}</p>}{requests.map(request => <article className="password-reset-reminder" key={request.id} data-notification-id={`password:${request.id}`}><Icon name="settings" /><div><b>Solicitud de cambio de contraseña</b><span><strong>{request.email}</strong> solicita actualizar su contraseña.</span><small>{new Date(request.requestedAt).toLocaleString('es-AR')}</small></div><div className="password-reset-actions">{can('employees.view') && <button title="Abrí Colaboradores para gestionar el acceso solicitado." className="secondary" type="button" onClick={() => { onManage?.(); window.dispatchEvent(new Event('pignus:open-employees')) }}>Gestionar en Colaboradores</button>}{can('employees.requests.resolve') && <button title="Marcá esta solicitud de acceso como atendida." className="primary" type="button" onClick={() => resolve(request.id)}>Marcar resuelta</button>}</div></article>)}</section>
}

function ServiceAdvanceRequestsReminder({ history = [] }) {
  const [decision, setDecision] = useState(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const pending = history.filter(record => isAdvanceRequestActive(record, now))
  useEffect(() => {
    if (decision && !history.some(record => record.id === decision.record.id && isAdvanceRequestActive(record, now))) setDecision(null)
  }, [history, now, decision])
  const resolve = async () => {
    const current = history.find(record => record.id === decision?.record.id)
    if (!isAdvanceRequestActive(current)) { setDecision(null); setNow(Date.now()); return }
    await serviceAdvanceRepository.resolve(decision.record.id, decision.value)
    await globalThis.__pignusRefreshRemoteState?.()
  }
  if (!pending.length && !decision) return null
  return <><section className="service-advance-reminders" role="alert" aria-label="Solicitudes para adelantar servicios">{pending.map(record => <article key={record.id} data-notification-id={`advance:${record.id}`}><Icon name="history" size={19} /><div><b>Solicitud para adelantar servicio</b><span><strong>{record.advanceRequest.requestedByName}</strong> solicita habilitar {serviceTypesLabel(record)} de {record.client} antes de las {record.advanceRequest.scheduledTime || record.time}.</span><small>Solicitado el {prettyReportDateTime(record.advanceRequest.requestedAt)}</small></div><div className="service-advance-actions"><button title="Rechazá la solicitud de adelantar el servicio del técnico." className="secondary" type="button" onClick={() => setDecision({ record, value: 'denied' })}>Denegar</button><button title="Autorizá al técnico a iniciar el servicio antes de su horario programado." className="primary" type="button" onClick={() => setDecision({ record, value: 'approved' })}>Aprobar adelanto</button></div></article>)}</section>{decision && <Confirm title={decision.value === 'approved' ? 'Aprobar adelanto' : 'Denegar adelanto'} detail={decision.value === 'approved' ? `¿Confirmás que ${decision.record.advanceRequest.requestedByName} puede realizar ahora el servicio de ${decision.record.client}? El horario se actualizará al momento de la aprobación.` : `¿Confirmás que el servicio de ${decision.record.client} debe conservar su horario de ${decision.record.advanceRequest.scheduledTime || decision.record.time}?`} action={resolve} confirmLabel={decision.value === 'approved' ? 'Sí, habilitar ahora' : 'Sí, denegar'} close={() => setDecision(null)} />}</>
}

const AuditPage = lazy(() => import('./features/audit/presentation/AuditPage.jsx').then(module => ({ default: module.AuditPage })))

const PersonalTechnicalServices = lazy(() => import('./features/technicians/presentation/TechnicianPortal.jsx').then(module => ({ default: module.PersonalTechnicalServices })))

const TechnicianPortal = lazy(() => import('./features/technicians/presentation/TechnicianPortal.jsx').then(module => ({ default: module.TechnicianPortal })))

const History = lazy(() => import('./features/history/presentation/History.jsx').then(module => ({ default: module.History })))

const Accounts = lazy(() => import('./features/customers/presentation/Accounts.jsx').then(module => ({ default: module.Accounts })))

const Vehicles = lazy(() => import('./features/vehicles/presentation/Vehicles.jsx').then(module => ({ default: module.Vehicles })))
