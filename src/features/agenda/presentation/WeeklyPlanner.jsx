import addressChange from '../../../../api/_lib/address-change.cjs'
import AddressChangeFields from '../../../components/AddressChangeFields.jsx'
import RegistrationForms from '../../registration/RegistrationForms.jsx'
import { vehicleLabel } from '../../../domain/vehicles/vehicle-controls.mjs'
import { canReadRecord, canWriteRecord } from '../../../domain/access/record-scope.mjs'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { permittedPlanningPatch, canEditPlanningFields, canSavePlanningFields, serviceCopyRecord } from '../application/planning-permissions.mjs'
import { serviceScheduleConflicts, normalizeServiceEstimatedMinutes, taskOccupiedInterval } from "../../../domain/agenda/service-scheduling.mjs";
import { taskHasContent, defaultServiceTasksForDate, isSaturday, assignGuardToEmptySaturday, defaultServiceTimesForDate, alignDefaultServiceTimes, fallbackDefaultServiceTimesForDate, mergeStoredTeamsWithDefaults, renumberVisibleWeeklyTeams, applyRemovedWeeklyTeams, applyRemovedWeeklySlots, applyRemovedWeeklyTasks, normalizeSaturdayTeams, removeUnavailableDefaultSlots, sortPlanTasksByTime, taskStatus, historyRecordForTask, blankTask, serviceTimeInMinutes, nextLiveScheduleMinute, taskForScheduleOccupancy, planningConflictMessage, stampServiceRecord, taskIsResolvedForPlanning, taskMoveScheduleState, teamLabelNumber, removedWeeklyTeamMatches, technicianTimeConflicts, weeklyTaskRemovalAliases, sortTasksByTime, serviceTrace, scheduleConflictMessage, taskOccupiedTimeLabel, scheduleConflictForTaskMessage, dayAgendaPreview, recordHolidayDecision } from "../application/agenda-model.mjs";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useWeeklyWeather, WeatherCredit, WeatherArt, WeeklyWeather } from "../../../components/WeeklyWeather.jsx";
import { createServiceLocalityLookup } from "../../../domain/agenda/service-locality.mjs";
import { normalizeRoleName, isGranular } from "../../../domain/access/permissions.mjs";
import { defaultWeeklyAnchor, weeklyVisibleDays, shiftWeeklyAnchor } from "../../../domain/agenda/weekly-anchor.mjs";
import { prettyDate, currentLocalDate } from "../../../presentation/formatting.mjs";
import { sortServicesAlphabetically } from "../../../domain/services/service-order.mjs";
import { resolveServiceForTask, applicableServiceExtras, taskWithServiceEstimate, weeklyTaskMissingFields, requiresPaymentAmount, serviceEstimateForTask, normalizeInternalChecklist, formatCurrencyAmount, INSTALLATION_ZONES } from "../../services/application/service-fields.mjs";
import { isTrainingService, trainingClientPatch, serviceCode } from "../../../domain/services/service.mjs";
import { clearSubscriberReservationPatch, customerLinkPatch, subscriberReservationPatch } from "../application/customer-linking.mjs";
import { createTeamId } from "../../../infrastructure/browser/identity.mjs";
import { useNationalHolidays } from "../application/useNationalHolidays.js";
import { holidayForDate, holidayDecisionForDate, holidayIsBlocked } from "../../../domain/agenda/holidays.mjs";
import { appendTraceElement } from "../../../presentation/service-trace-dom.mjs";
import { findAdvancedSaturdayGuard, advancedSaturdayGuardMessage, suppressAdvancedSaturdayAvailability } from "../../../domain/agenda/weekend-guard.mjs";
import { reservationTarget } from "../../../domain/agenda/reservation-target.mjs";
import { normalizeCustomerName } from "../../../domain/shared/normalization.mjs";
import { createQuickClient } from "../../customers/application/customer-model.mjs";
import { uploadAttachmentBatch } from "../../../components/Attachments.jsx";
import { servicePhotoRepository } from "../../../infrastructure/repositories/service-photo-repository.mjs";
import { canReorderService, reorderServices } from "../../../domain/agenda/reorder-services.mjs";
import { ServiceConfirmationButton, ServiceEstimatedDurationField, BufferedInput, CustomerAutocomplete, BufferedTextarea, AgendaTechnicalNote, ServiceExtraFields, HolidayDecisionPanel, LunchCard, TaskStatusBadge } from "./AgendaFields.jsx";
import { ServiceJourneys, journeyLabel } from "../../../components/ServiceJourneys.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import { fridayAdvanceDestination } from "../../../domain/agenda/friday-advance.mjs";
import { vehicleControlResponsible, vehicleControlSwapCandidate } from "../../state/application/weekly-service-save.mjs";
import { planningHoursForDay, teamServiceGaps } from "../../../domain/agenda/service-gaps.mjs";
import { Confirm } from "../../../presentation/components/Confirm.jsx";
import ReorderServicesModal from "../../../components/ReorderServicesModal.jsx";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import WeeklyServiceSearch from "../../../components/WeeklyServiceSearch.jsx";
import { HistoryDetail } from "../../history/presentation/HistoryDetail.jsx";
import { serviceTypesLabel } from "../../../domain/services/multi-service.mjs";
import { ServicePhoto, ServicePhotoField } from "../../attachments/presentation/ServicePhoto.jsx";
import ServiceCustomerMap from "../../../components/ServiceCustomerMap.jsx";
import { Preview } from "../../../presentation/components/AgendaPreview.jsx";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";
import ServiceTypesField from "../../../components/ServiceTypesField.jsx";
import { withLunchNotice } from "../../../domain/agenda/lunch-placement.mjs";
import ServicePreparationButton from "../../../components/ServicePreparationButton.jsx";
import { acknowledgedInteraction, afterInteractionPaint, interactionIsConfirmed, membershipMatches, weeklyTeamInteractionKey } from "../../../presentation/pending-interaction.mjs";
import { suggestedServiceForTicket, ticketLinkFields, ticketReferenceDetail, ticketServiceDraft } from '../application/ticket-service-draft.mjs';
import TicketServiceSchedule from './TicketServiceSchedule.jsx';

export function WeeklyPlanner({ onOpenPlanning, initialAnchor, onAnchorChange, openRequest, onOpenRequestHandled, navigationGuardRef, persistWeeklyService, persistWeeklyConfiguration, weekly, setWeekly, customers, setCustomers, services, activeTechs, history, setHistory, setNotice, openDaily, authUser, vehicles, permissions = {}, confirmedRevision }) {
  const { can, user: permissionUser } = usePermissions()
  const minimumServiceGapConflicts = teams => serviceScheduleConflicts(teams, taskHasContent, weekly)

  const [dayPreview, setDayPreview] = useState(null)
  const weather = useWeeklyWeather()
  const serviceLocality = useMemo(() => createServiceLocalityLookup(customers), [customers])
  authUser = permissionUser || authUser || globalThis.__pignusCurrentUser || null
  const granular = isGranular(authUser)
  const readOnly = !granular && (authUser?.roleCode === 'operator' || normalizeRoleName(authUser?.role) === 'operador')
  const allowOmit = granular ? can('vehicle.controls.omit') : authUser?.roleCode === 'administrator'
  const requirePermission = key => { if (!readOnly && can(key)) return true; setNotice('No tenés permiso para realizar esta acción.'); return false }
  const scopedTask = (task, day) => {
    const team = dayPlan(day).teams.find(item => (item.tasks || []).some(candidate => candidate === task || (task.taskId && candidate.taskId === task.taskId))) || (taskEditor?.taskId === task.taskId ? taskEditor.teamSnapshot : null)
    return { technicianIds: team?.memberIds || [], ...task, ...historyRecordForTask(task, day, history || []) }
  }
  const canWriteTask = (task, day) => canWriteRecord(scopedTask(task, day), authUser, customers)
  const canEditTask = (task, day) => canWriteTask(task, day) && canEditPlanningFields(can, Boolean(historyRecordForTask(task, day, history || [])))
  const canSaveTask = (task, day) => canWriteTask(task, day) && ((task?.vehicleControl && can('weekly.monthlyVehicles.assign')) || canSavePlanningFields(can, Boolean(historyRecordForTask(task, day, history || []))))
  vehicles = vehicles || globalThis.__pignusVehicles || []
  setHistory = setHistory || globalThis.__pignusSetHistory
  setCustomers = setCustomers || globalThis.__pignusSetCustomers
  const isAdministrator = authUser?.roleCode === 'administrator'
  const configurationPermissions = { weeklyHours: 'weekly.monthlyHours.manage', weeklyTeams: 'weekly.monthlyTeams.manage', weeklyVehicles: 'weekly.monthlyVehicles.assign', weeklyGuards: 'weekly.guards.manage' }
  const canConfigureWeekly = key => !readOnly && (granular ? can(configurationPermissions[key]) : isAdministrator || Boolean(permissions[key]))
  const canReadConfiguration = key => granular ? can({ weeklyHours: 'weekly.monthlyHours.read', weeklyTeams: 'weekly.monthlyTeams.read', weeklyVehicles: 'weekly.monthlyVehicles.read', weeklyGuards: 'weekly.guards.read' }[key]) : canConfigureWeekly(key)
  const operationalHistory = history || globalThis.__pignusHistory || []
  const localToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [today, setToday] = useState(localToday)
  const [planningClock, setPlanningClock] = useState(Date.now)
  const [anchor, setAnchor] = useState(() => initialAnchor || defaultWeeklyAnchor())
  useEffect(() => { onAnchorChange?.(anchor) }, [anchor, onAnchorChange])
  const weeklyAnchorFollowsCurrentRef = useRef(!initialAnchor || initialAnchor === defaultWeeklyAnchor())
  const [techPicker, setTechPicker] = useState(null)
  const [techFilter, setTechFilter] = useState('')
  const [memberSelections, setMemberSelectionState] = useState({})
  const memberSelectionsRef = useRef({})
  const setMemberSelections = update => {
    const next = update(memberSelectionsRef.current)
    memberSelectionsRef.current = next
    setMemberSelectionState(next)
  }
  useEffect(() => {
    for (const [key, preview] of Object.entries(memberSelections)) {
      if (memberSelectionsRef.current[key] !== preview) continue
      const teams = weekly[preview.day]?.teams || []
      const team = preview.teamId ? teams.find(item => String(item.teamId) === String(preview.teamId)) : teams[preview.teamIndex]
      const sent = { memberIds: preview.sentMemberIds, members: preview.sentMembers }
      if (!interactionIsConfirmed(preview, confirmedRevision, membershipMatches(team, sent))) continue
      if (!membershipMatches(team, preview) && membershipMatches(team, sent)) {
        // The server acknowledged the previous selection. Send only the latest
        // local intention, with that newly confirmed membership as its baseline.
        persistMemberSelection(preview.day, preview.teamIndex, team, preview, dayPlan(preview.day))
        continue
      }
      setMemberSelections(previous => {
        const next = { ...previous }
        delete next[key]
        return next
      })
      if (!membershipMatches(team, preview)) {
        setNotice('El equipo cambió mientras se guardaba. Se muestra la asignación confirmada; revisala antes de volver a modificarla.')
      }
    }
  }, [memberSelections, weekly, confirmedRevision])
  useEffect(() => {
    const guard = event => {
      if (!Object.keys(memberSelectionsRef.current).length) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  const [taskEditor, setTaskEditor] = useState(null)
  const [ticketSchedule, setTicketSchedule] = useState(null)
  const [pastService, setPastService] = useState(null)
  const [completedService, setCompletedService] = useState(null)
  const [weeklyServiceSource, setWeeklyServiceSource] = useState(null)
  const [reorder, setReorder] = useState(null)
  const [taskEditorSaving, setTaskEditorSaving] = useState(false)
  const [taskEditorError, setTaskEditorError] = useState('')
  const [leaveRequest, setLeaveRequest] = useState(null)
  const [resumeNavigation, setResumeNavigation] = useState(null)
  const taskEditorSaveGuardRef = useRef(false)
  const [taskMove, setTaskMove] = useState(null)
  const [taskMoveSaving, setTaskMoveSaving] = useState(false)
  const taskMoveSaveGuardRef = useRef(false)
  const [taskRemoval, setTaskRemoval] = useState(null)
  const [teamRemoval, setTeamRemoval] = useState(null)
  const weeklyBoardRef = useRef(null)
  const dayHasFinished = day => String(day || '') < today
  const finishedDayMessage = day => `La jornada del ${prettyDate(day)} ya finalizó. La planificación histórica es de solo lectura y no admite servicios nuevos.`
  const activeServices = useMemo(() => sortServicesAlphabetically(services.filter(service => service.status === 'Activo')), [services])
  const serviceForWeeklyTask = task => resolveServiceForTask(task, services)
  const selectWeeklyService = (day, teamIndex, taskIndex, selectedId) => {
    const selected = services.find(service => String(service.id) === String(selectedId))
    const currentTask = dayPlan(day).teams[teamIndex]?.tasks[taskIndex]
    const nextTask = selected
      ? { ...currentTask, ...(isTrainingService(selected) ? trainingClientPatch(currentTask.client || '') : {}), serviceId: selected.id, service: selected.name, estimatedMinutes: normalizeServiceEstimatedMinutes(selected.estimatedMinutes), estimatedMinutesCustomized: false, installationZone: serviceCode(selected) === 'alarm-installation' ? currentTask?.installationZone || '' : '' }
      : { ...currentTask, serviceId: '', service: '', estimatedMinutes: undefined, estimatedMinutesCustomized: false, installationZone: '' }
    updateTask(day, teamIndex, taskIndex, { ...nextTask, ...clearSubscriberReservationPatch(selected && serviceCode(selected) === 'alarm-installation' ? null : currentTask), ...applicableServiceExtras(nextTask, selected) })
  }
  const weeklyTechnicianName = fullName => activeTechs.find(tech => tech.name === fullName)?.firstName || String(fullName || '').split(' ')[0]
  const monthKey = anchor.slice(0, 7)
  const createTeam = (index, source, day) => ({ teamId: source?.teamId || createTeamId(), memberIds: source?.memberIds || [], members: source?.members || [], tasks: defaultServiceTasksForDate(day, weekly), label: source?.label || `Equipo ${index + 1}` })
  const createDay = (day, sourceWeekly = weekly) => {
    const sources = sourceWeekly?._monthlyTeams?.[day.slice(0, 7)]?.teams || [null, null, null]
    if (isSaturday(day)) {
      // El sábado no usa la plantilla mensual, pero debe conservar el ID que
      // ya fue materializado para que el guardado pueda compararse con Historial.
      const storedSaturday = sourceWeekly?.[day]?.teams?.[0]
      const team = createTeam(0, storedSaturday ? { teamId: storedSaturday.teamId } : null, day)
      return { teams: assignGuardToEmptySaturday([{ ...team, memberIds: [], members: [], tasks: defaultServiceTasksForDate(day, sourceWeekly).slice(0, 1) }], day, sourceWeekly, activeTechs) }
    }
    return { teams: sources.map((team, index) => createTeam(index, team, day)) }
  }
  const days = useMemo(() => weeklyVisibleDays(anchor), [anchor])
  const holidayCalendar = useNationalHolidays([
    ...days.map(day => day.slice(0, 4)),
    ticketSchedule?.day?.slice(0, 4) || '',
    taskMove?.destinationDay?.slice(0, 4) || ''
  ])
  const holidayStateForDay = day => {
    const holiday = holidayForDate(holidayCalendar.records, day)
    const decision = holidayDecisionForDate(weekly, day)
    return { holiday, decision, blocked: holidayIsBlocked(holiday, decision) }
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const records = days.flatMap(day => dayPlan(day).teams.flatMap(team => (team.tasks || []).map(task => ({ day, task }))))
      document.querySelectorAll('.week-task-summary').forEach((node, index) => {
        const task = records[index]?.task
        appendTraceElement(node, task)
        if (task?.vehicleControl) {
          node.classList.add('weekly-vehicle-control')
          node.title = 'Control semanal generado desde Planificación operativa'
          const select = node.querySelector('.week-task-top select')
          if (select?.options?.[0]) { select.options[0].textContent = task.service; select.disabled = true }
        }
      })
      if (taskEditor) {
        const modal = document.querySelector('.weekly-task-modal')
        appendTraceElement(modal, taskEditor.draft)
        const trace = modal?.querySelector(':scope > .service-trace')
        trace?.classList.add('weekly-modal-trace')
        if (trace) modal.querySelector('.weekly-task-form')?.before(trace)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [weekly, days, taskEditor, operationalHistory])
  useEffect(() => {
    // Mantiene la fecha vigente y, mientras el usuario no navegue manualmente,
    // adelanta la vista al lunes siguiente al finalizar el sábado operativo.
    const refreshPlanningWindow = () => {
      setPlanningClock(Date.now())
      setToday(localToday())
      if (weeklyAnchorFollowsCurrentRef.current) setAnchor(defaultWeeklyAnchor())
    }
    const interval = window.setInterval(refreshPlanningWindow, 60_000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    const board = weeklyBoardRef.current
    if (!board) return
    board.scrollLeft = 0
  }, [days])
  // Local feedback (picker, pending checks, modal typing) does not change the
  // confirmed plans. Reuse their normalization and generated placeholder IDs.
  const dayPlanCache = useMemo(() => new Map(), [weekly, activeTechs])
  const dayPlan = day => {
    if (dayPlanCache.has(day)) return dayPlanCache.get(day)
    const defaults = createDay(day)
    const stored = weekly[day]
    const targetTimes = defaultServiceTimesForDate(day, weekly)
    const storedTeams = alignDefaultServiceTimes(stored?.teams || [], day, targetTimes, fallbackDefaultServiceTimesForDate(day))
    const plan = stored
      ? { ...stored, teams: mergeStoredTeamsWithDefaults(defaults.teams, storedTeams) }
      : defaults
    const visiblePlan = { ...plan, teams: renumberVisibleWeeklyTeams(applyRemovedWeeklyTeams(applyRemovedWeeklySlots(applyRemovedWeeklyTasks(plan.teams, plan.removedTaskIds || []), plan.removedSlots || []), plan.removedTeams || [])) }
    const normalized = isSaturday(day) ? { ...visiblePlan, teams: assignGuardToEmptySaturday(normalizeSaturdayTeams(visiblePlan.teams, day, weekly), day, weekly, activeTechs) } : visiblePlan
    const availablePlan = { ...normalized, teams: normalized.teams.map(team => ({ ...team, tasks: removeUnavailableDefaultSlots(team.tasks || []).filter(task => taskHasContent(task) || task.manualSlot) })) }
    const result = sortPlanTasksByTime(availablePlan)
    dayPlanCache.set(day, result)
    return result
  }
  const advancedGuardForDay = day => {
    if (!isSaturday(day)) return null
    const friday = new Date(`${day}T12:00:00`)
    friday.setDate(friday.getDate() - 1)
    const fridayKey = friday.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
    return findAdvancedSaturdayGuard({ fridayPlan: dayPlan(fridayKey), saturdayPlan: dayPlan(day) })
  }
  const updateDay = (day, mutate) => setWeekly(previous => {
    const defaults = createDay(day, previous)
    const saved = previous[day]
    const targetTimes = defaultServiceTimesForDate(day, previous)
    const savedTeams = alignDefaultServiceTimes(saved?.teams || [], day, targetTimes, fallbackDefaultServiceTimesForDate(day))
    const stored = saved
      ? { ...saved, teams: mergeStoredTeamsWithDefaults(defaults.teams, savedTeams) }
      : defaults
    const visibleStored = { ...stored, teams: renumberVisibleWeeklyTeams(applyRemovedWeeklyTeams(applyRemovedWeeklySlots(applyRemovedWeeklyTasks(stored.teams, stored.removedTaskIds || []), stored.removedSlots || []), stored.removedTeams || [])) }
    const base = isSaturday(day) ? { ...visibleStored, teams: assignGuardToEmptySaturday(normalizeSaturdayTeams(visibleStored.teams, day, previous), day, previous, activeTechs) } : visibleStored
    const next = mutate(base)
    const normalized = isSaturday(day) ? { ...next, teams: assignGuardToEmptySaturday(normalizeSaturdayTeams(next.teams, day, previous), day, previous, activeTechs) } : next
    return { ...previous, [day]: sortPlanTasksByTime(normalized) }
  })
  const openTaskEditor = (day, teamIndex, taskIndex) => {
    if (!can('records.read')) return
    const openingTask = dayPlan(day).teams[teamIndex]?.tasks?.[taskIndex]
    if (!openingTask || !canReadRecord(scopedTask(openingTask, day), authUser, customers)) return
    setTaskEditorError('')
    const selectedTeam = dayPlan(day).teams[teamIndex]
    const selectedTask = selectedTeam?.tasks?.[taskIndex]
    setWeeklyServiceSource({ day, teamIndex, taskIndex, teamId: selectedTeam?.teamId, taskId: selectedTask?.taskId })
    if (selectedTask && ['Completado', 'Avance registrado'].includes(taskStatus(selectedTask, day, operationalHistory))) {
      setCompletedService({ ...selectedTask, date: day, team: selectedTeam.label || `Equipo ${teamIndex + 1}`, technicians: selectedTask.technicians || selectedTeam.members, ...(historyRecordForTask(selectedTask, day, operationalHistory) || {}) })
      return
    }
    if (readOnly || dayHasFinished(day) || !canWriteTask(openingTask, day)) {
      const team = dayPlan(day).teams[teamIndex]
      const task = team?.tasks?.[taskIndex]
      if (task && taskHasContent(task)) setPastService(serviceCopyRecord({ ...task, date: day, team: team.label || `Equipo ${teamIndex + 1}`, technicians: task.technicians || team.members, ...(historyRecordForTask(task, day, operationalHistory) || {}) }, can))
      return
    }
    taskEditorSaveGuardRef.current = false
    setTaskEditorSaving(false)
    const teamSnapshot = dayPlan(day).teams[teamIndex]
    const rawTask = teamSnapshot?.tasks[taskIndex]
    const task = rawTask && { ...rawTask, ...ticketLinkFields(rawTask, historyRecordForTask(rawTask, day, operationalHistory)) }
    if (task) setTaskEditor({ persistedTeam: Boolean(weekly[day]?.teams?.some(team => String(team.teamId) === String(teamSnapshot.teamId))), baseRecord: historyRecordForTask(task, day, operationalHistory) || null, baseTask: weekly[day]?.teams?.flatMap(team => team.tasks || []).find(item => String(item.taskId) === String(task.taskId)) || null, day, teamIndex, taskIndex, teamId: teamSnapshot.teamId, teamSnapshot: { ...teamSnapshot, tasks: [...(teamSnapshot.tasks || [])] }, taskId: task.taskId, draft: taskWithServiceEstimate(task, serviceForWeeklyTask(task)), photoData: '', photoRemoved: false })
  }
  useEffect(() => {
    if (!openRequest) return
    if (openRequest.ticket) {
      onOpenRequestHandled()
      if (!requirePermission('planning.create') || !requirePermission('tickets.linkService')) return
      try {
        ticketServiceDraft(openRequest.ticket, customers, authUser, services)
        setTicketSchedule({ ticket: openRequest.ticket, day: today, teamId: '', startTime: '' })
      } catch (error) { setNotice(error.message) }
      return
    }
    const record = operationalHistory.find(item => String(item.id) === String(openRequest.id))
    if (!record || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) {
      onOpenRequestHandled()
      setNotice('La reserva ya no está disponible. Actualizá la agenda para consultar su estado.')
      return
    }
    if (anchor !== record.date) {
      weeklyAnchorFollowsCurrentRef.current = false
      setAnchor(record.date)
      return
    }
    const target = reservationTarget(record, dayPlan(record.date))
    onOpenRequestHandled()
    if (!target) {
      setNotice('No se encontró la tarjeta de esta reserva en la agenda. Actualizá la información y revisá el Historial.')
      return
    }
    const key = `${record.date}/${target.teamIndex}/${target.taskIndex}`
    const card = Array.from(weeklyBoardRef.current?.querySelectorAll('[data-weekly-search-key]') || []).find(item => item.dataset.weeklySearchKey === key)
    card?.scrollIntoView({ block: 'center', inline: 'nearest' })
    card?.focus({ preventScroll: true })
    openTaskEditor(record.date, target.teamIndex, target.taskIndex)
  }, [openRequest, anchor, weekly, history])

  const updateTaskDraft = (patch, action) => !taskEditorSaveGuardRef.current && setTaskEditor(previous => previous ? { ...previous, draft: { ...previous.draft, ...permittedPlanningPatch(patch, { can, existing: Boolean(previous.baseRecord), task: previous.draft, action }) } } : previous)
  const selectDraftService = selectedId => {
    const selected = services.find(service => String(service.id) === String(selectedId))
    const currentTask = taskEditor?.draft || blankTask()
    const nextTask = selected
      ? { ...currentTask, ...(isTrainingService(selected) ? trainingClientPatch(currentTask.client || '') : {}), serviceId: selected.id, service: selected.name, estimatedMinutes: normalizeServiceEstimatedMinutes(selected.estimatedMinutes), estimatedMinutesCustomized: false, installationZone: serviceCode(selected) === 'alarm-installation' ? currentTask.installationZone || '' : '' }
      : { ...currentTask, serviceId: '', service: '', estimatedMinutes: undefined, estimatedMinutesCustomized: false, installationZone: '' }
    updateTaskDraft({ ...nextTask, ...clearSubscriberReservationPatch(selected && serviceCode(selected) === 'alarm-installation' ? null : currentTask), ...applicableServiceExtras(nextTask, selected) })
  }
  const commitDraftCustomerText = value => updateTaskDraft({ newCustomer: false, subscriberReservation: false, customerId: '', client: value, clientAccount: '', clientNameAtService: '', address: '', phone: '' })
  const selectDraftCustomer = customer => updateTaskDraft(customerLinkPatch(taskEditor?.draft, customer, authUser), taskEditor?.draft?.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')
  const beginDraftNewCustomer = value => updateTaskDraft({ newCustomer: true, subscriberReservation: false, customerId: '', client: value, clientAccount: '', clientNameAtService: normalizeCustomerName(value), address: '', phone: '' }, 'customers.create')
  const beginDraftSubscriberReservation = value => updateTaskDraft(subscriberReservationPatch(value, authUser), 'planning.reservation.create')
  const saveTaskEditor = async () => {
    if (taskEditor?.photoPreparing) { setTaskEditorError('Esperá a que termine la preparación de los archivos.'); return false }
    if (!taskEditor || taskEditorSaveGuardRef.current) return
    if (!canSaveTask(taskEditor.draft, taskEditor.day)) { setTaskEditorError('No tenés permiso para guardar este servicio.'); return false }
    taskEditorSaveGuardRef.current = true
    setTaskEditorSaving(true)
    const rejectSave = message => {
      taskEditorSaveGuardRef.current = false
      setTaskEditorSaving(false)
      setTaskEditorError(message)
    }
    setTaskEditorError('')
    const { day, teamIndex, taskIndex, teamId, teamSnapshot, taskId } = taskEditor
    if (taskStatus(taskEditor.draft, day, operationalHistory) === 'Completado') { rejectSave('Este servicio ya fue completado. Los cambios no se guardaron. Actualizá la agenda para consultar su información.'); return false }
    if (dayHasFinished(day)) { rejectSave(finishedDayMessage(day)); return }
    let draft = { ...taskEditor.draft, ...ticketLinkFields(taskEditor.draft, taskEditor.baseRecord) }
    if (draft.sourceTicketId) draft.detail = ticketReferenceDetail(draft.detail, draft.ticketNumber)
    let newCustomer = null
    const advance = advancedGuardForDay(day)
    if (advance) {
      setTaskEditor(null)
      setNotice(advancedSaturdayGuardMessage(advance))
      return
    }
    const existingService = Boolean(taskEditor.baseRecord)
    const missing = existingService && !canEditTask(draft, day) ? [] : weeklyTaskMissingFields(draft, serviceForWeeklyTask(draft)).filter(field => {
      if (existingService && !can('records.contact') && ['dirección', 'contacto'].includes(field)) return false
      if (existingService && !can('records.financial') && ['monto', 'abono mensual', 'forma de pago', 'formulario', 'email'].some(label => field.includes(label))) return false
      return true
    })
    if ((!existingService || can('planning.commercial')) && !draft.vehicleControl && requiresPaymentAmount(draft, serviceForWeeklyTask(draft)) && !missing.includes('monto')) missing.push('monto')
    if (missing.length) {
      rejectSave(`Completá ${missing.join(', ')} antes de guardar el servicio.`)
      return
    }
    if (draft.newCustomer) {
      if (!requirePermission('customers.create')) { rejectSave('No tenés permiso para crear clientes.'); return false }
      const created = createQuickClient(draft, customers)
      if (!created) { rejectSave('Completá nombre, dirección y contacto del cliente nuevo.'); return }
      draft = created.task
      newCustomer = created.customer
    }
    const draftStart = serviceTimeInMinutes(draft.time)
    if (day === currentLocalDate() && !historyRecordForTask(draft, day, operationalHistory) && draftStart !== null && draftStart < nextLiveScheduleMinute()) {
      rejectSave('Elegí un horario futuro desde el próximo cuarto de hora disponible.')
      return
    }
    const editorHours = hoursForDay(day, teamId)
    const editorInterval = taskOccupiedInterval(taskWithServiceEstimate(draft, serviceForWeeklyTask(draft)), editorHours)
    if (editorHours && editorInterval?.serviceEnd > serviceTimeInMinutes(editorHours.max)) {
      rejectSave(`La franja estimada termina a las ${editorInterval.serviceEndTime}, fuera del horario habilitado (${editorHours.label}).`)
      return
    }
    const editedPlan = dayPlan(day)
    const editedTeam = editedPlan.teams.find(team => teamId && String(team.teamId || '') === String(teamId)) || (!taskEditor.persistedTeam ? teamSnapshot : null)
    if (!editedTeam) { rejectSave('El equipo fue eliminado desde otra sesión. Revisá la planificación antes de guardar.'); return }
    const peerTasks = (editedTeam?.tasks || []).filter((task, index) => !((taskId && String(task.taskId || '') === String(taskId)) || (!taskId && index === taskIndex)))
    const gapConflict = minimumServiceGapConflicts([{ teamId, tasks: [...peerTasks, draft].map(task => {
      const occupancyTask = taskForScheduleOccupancy(task, day, operationalHistory)
      return occupancyTask ? taskWithServiceEstimate(occupancyTask, serviceForWeeklyTask(task)) : null
    }).filter(Boolean) }])[0]
    if (gapConflict) {
      rejectSave(planningConflictMessage(day, editedTeam, teamIndex, gapConflict))
      return
    }
    const tracedDraft = stampServiceRecord({ ...draft, ...applicableServiceExtras(draft, serviceForWeeklyTask(draft)) }, authUser)
    const savedTeam = editedTeam || teamSnapshot
    if (!existingService && !savedTeam?.members?.length && !tracedDraft.vehicleControl) { rejectSave('Asigná al menos un técnico antes de guardar el servicio.'); return }
    const previousRecord = taskEditor.baseRecord
    const photoPatch = taskEditor.photoData && !Array.isArray(taskEditor.photoData)
      ? { servicePhotoAttached: true, servicePhotoUrl: `/api/service-photo/${encodeURIComponent(String(previousRecord?.id || tracedDraft.historyId || `work-${tracedDraft.taskId}`))}`, servicePhotoAttachedAt: new Date().toISOString() }
      : taskEditor.photoRemoved ? { servicePhotoAttached: false, servicePhotoUrl: '', servicePhotoAttachedAt: '' } : {}
    const record = { ...previousRecord, ...weeklyHistoryRecord(day, savedTeam, teamIndex, { ...tracedDraft, ...photoPatch }, taskIndex), ...photoPatch, status: previousRecord?.status || 'Pendiente' }
    if (previousRecord) record.id = previousRecord.id
    const savedTask = { ...tracedDraft, ...photoPatch, historyId: record.id, status: record.status }
    let serviceSaved = false
    try {
      await persistWeeklyService({ day, team: savedTeam, task: savedTask, record, baseRecord: previousRecord, baseTask: taskEditor.baseTask, customer: newCustomer })
      serviceSaved = true
      setTaskEditor(previous => previous ? { ...previous, baseRecord: record, baseTask: savedTask, persistedTeam: true } : previous)
      if (Array.isArray(taskEditor.photoData)) await uploadAttachmentBatch('service', record.id, taskEditor.photoData)
      else if (taskEditor.photoData) await servicePhotoRepository.upload(record.id, taskEditor.photoData)
      else if (taskEditor.photoRemoved) await servicePhotoRepository.remove(record.id)
      if (!previousRecord && serviceCode(serviceForWeeklyTask(savedTask)) === 'alarm-installation' && can('registration.read')) {
        setTaskEditor(previous => previous ? {...previous, draft:savedTask, baseRecord:record, baseTask:savedTask, photoData:null, photoRemoved:false} : previous)
        setNotice('Instalación guardada. Ya podés copiar el enlace del formulario en este servicio.')
      } else setTaskEditor(null)
      if (record.sourceTicketId) {
        window.dispatchEvent(new CustomEvent('tickets-changed'))
        setNotice(`Servicio guardado y vinculado a Ticket#${record.ticketNumber}.`)
      }
      return true
    } catch (error) {
      rejectSave(`${serviceSaved ? 'El servicio quedó guardado, pero faltan adjuntos. Volvé a guardar para reintentar sin duplicarlos.' : 'No se guardó el servicio.'} ${error.message || 'Comprobá la conexión e intentá nuevamente.'}`)
    } finally {
      taskEditorSaveGuardRef.current = false
      setTaskEditorSaving(false)
    }
  }


  const requestWeeklyLeave = action => {
    if (readOnly) { action(); return }
    if (Object.keys(memberSelectionsRef.current).length) {
      setNotice('Se están guardando las asignaciones de técnicos. Esperá la confirmación antes de salir de la agenda.')
      return
    }
    if (taskEditorSaveGuardRef.current) return
    const dirtyEditor = taskEditor && (
      JSON.stringify(taskEditor.draft) !== JSON.stringify(taskEditor.initialDraft || taskWithServiceEstimate(taskEditor.baseTask || taskEditor.teamSnapshot.tasks[taskEditor.taskIndex], serviceForWeeklyTask(taskEditor.draft))) ||
      (!taskEditor.baseRecord && taskHasContent(taskEditor.draft)) || taskEditor.photoData || taskEditor.photoRemoved
    )
    if (dirtyEditor) { setLeaveRequest({ action }); return }
    for (const day of Object.keys(weekly).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort()) {
      const plan = dayPlan(day)
      for (let teamIndex = 0; teamIndex < plan.teams.length; teamIndex++) {
        const taskIndex = plan.teams[teamIndex].tasks.findIndex(task => taskHasContent(task) && !task.vehicleControl &&
          String(task.createdBy?.id || '') === String(authUser?.id || '') && authUser?.id &&
          !historyRecordForTask(task, day, operationalHistory))
        if (taskIndex >= 0 && !dayHasFinished(day)) {
          openTaskEditor(day, teamIndex, taskIndex)
          setLeaveRequest({ action })
          return
        }
      }
    }
    action()
  }
  useEffect(() => {
    if (navigationGuardRef) navigationGuardRef.current = requestWeeklyLeave
    if (navigationGuardRef?.current) navigationGuardRef.current.hasDraft = () => Object.keys(memberSelectionsRef.current).length > 0 || Boolean(taskEditor && (
      JSON.stringify(taskEditor.draft) !== JSON.stringify(taskEditor.initialDraft || taskWithServiceEstimate(taskEditor.baseTask || taskEditor.teamSnapshot.tasks[taskEditor.taskIndex], serviceForWeeklyTask(taskEditor.draft))) ||
      (!taskEditor.baseRecord && taskHasContent(taskEditor.draft)) || taskEditor.photoData || taskEditor.photoRemoved
    ))
    return () => { if (navigationGuardRef) navigationGuardRef.current = null }
  })
  useEffect(() => {
    if (!resumeNavigation) return
    setResumeNavigation(null)
    requestWeeklyLeave(resumeNavigation.action)
  }, [resumeNavigation])
  const saveAndLeave = async () => {
    const request = leaveRequest
    setLeaveRequest(null)
    if (await saveTaskEditor()) setResumeNavigation(request)
  }
  const discardAndLeave = () => {
    if (!leaveRequest || taskEditorSaveGuardRef.current) return
    const { action } = leaveRequest
    // Only abandon the editor's local draft. Never delete a persisted service,
    // its history, or changes received from another session.
    setLeaveRequest(null)
    setTaskEditor(null)
    action()
  }

  const weeklyModalActions = ({ day, teamIndex, taskIndex, teamId, taskId }, readOnly = false) => {
    const plan = dayPlan(day)
    if (teamId) teamIndex = plan.teams.findIndex(team => String(team.teamId) === String(teamId))
    const team = plan.teams[teamIndex]
    if (taskId) taskIndex = team?.tasks?.findIndex(task => String(task.taskId) === String(taskId)) ?? -1
    const persistedTask = team?.tasks?.[taskIndex]
    if (!persistedTask) return null
    const task = !readOnly && taskEditor ? taskEditor.draft : persistedTask
    const record = historyRecordForTask(persistedTask, day, operationalHistory)
    const dirty = !readOnly && taskEditor && (
      JSON.stringify(taskEditor.draft) !== JSON.stringify(taskWithServiceEstimate(taskEditor.baseTask || taskEditor.teamSnapshot.tasks[taskEditor.taskIndex], serviceForWeeklyTask(taskEditor.draft))) ||
      taskEditor.photoData || taskEditor.photoRemoved
    )
    const leaveFor = action => {
      const proceed = () => { setTaskEditor(null); setCompletedService(null); setPastService(null); action() }
      if (readOnly) proceed()
      else requestWeeklyLeave(proceed)
    }
    return <div className="weekly-service-modal-actions" role="group" aria-label="Acciones del servicio">
      {!readOnly && can('weekly.reorder') && day >= today && canReorderService({ ...persistedTask, ...record }) && <button title="Reordená este servicio intercambiando su horario con otro del equipo." type="button" className="secondary" disabled={taskEditorSaving} onClick={() => leaveFor(() => setReorder({ day, teamId: team.teamId, sourceId: persistedTask.taskId, baseline: structuredClone(team.tasks), tasks: team.tasks.filter(item => canReorderService({ ...item, ...historyRecordForTask(item, day, operationalHistory) })).map(item => taskWithServiceEstimate(item, serviceForWeeklyTask(item))) }))}>Reordenar servicios</button>}
      {!readOnly && <ServiceConfirmationButton task={task} day={day} history={operationalHistory} onDraftChange={updateTaskDraft} disabled={taskEditorSaving} />}
      {!readOnly && <ServiceJourneys record={record} toolbar disabled={Boolean(dirty || taskEditorSaving)} />}
      {!readOnly && can('weekly.advanceGuard') && isSaturday(day) && !persistedTask.vehicleControl && taskHasContent(persistedTask) && !taskIsResolvedForPlanning(persistedTask, day, operationalHistory) && <button title="Trasladá este servicio al viernes anterior entre las 16 y las 20, conservando el técnico y los datos." type="button" className="secondary" disabled={taskEditorSaving} onClick={() => leaveFor(() => openFridayAdvance(day, teamIndex, taskIndex))}>Adelantar al viernes</button>}
      {!readOnly && can('planning.reschedule') && (persistedTask.customerId || persistedTask.client || persistedTask.service) && !taskIsResolvedForPlanning(persistedTask, day, operationalHistory) && <button title="Elegí otro equipo o fecha para trasladar este servicio." type="button" className="secondary" disabled={taskEditorSaving} onClick={event => { event.stopPropagation(); leaveFor(() => openWeeklyTaskMove({ stopPropagation() {} }, day, teamIndex, taskIndex, team.teamId, persistedTask.taskId)) }}><span aria-hidden="true">⇄</span>Reasignar equipo o fecha</button>}
      {canWriteTask(persistedTask, day) && (persistedTask.vehicleControl ? allowOmit : can('planning.remove')) && <button title={persistedTask.vehicleControl ? 'Solicitá omitir este control vehicular semanal; el técnico no tendrá que realizarlo.' : 'Solicitá eliminar este servicio de la agenda; revisá el cliente antes de confirmar.'} type="button" className="secondary weekly-service-delete" disabled={taskEditorSaving} onClick={() => leaveFor(() => setTaskRemoval({ day, teamId: team.teamId, teamIndex, taskIndex, taskId: persistedTask.taskId, historyId: persistedTask.historyId, time: persistedTask.time || persistedTask.scheduledTime || '', wasPlaceholder: !taskHasContent(persistedTask), journey: Boolean(persistedTask.serviceJourney || record?.serviceJourney), vehicleControl: Boolean(persistedTask.vehicleControl), label: team.label || `Equipo ${teamIndex + 1}` }))}><Icon name="trash" size={16} />{persistedTask.vehicleControl ? 'Omitir control vehicular' : 'Eliminar servicio'}</button>}
    </div>
  }
  const openWeeklyTaskMove = (event, day, teamIndex, taskIndex, teamId, taskId) => {
    if (!requirePermission('planning.reschedule')) return
    event.stopPropagation()
    const plan = dayPlan(day)
    if (teamId) teamIndex = plan.teams.findIndex(team => String(team.teamId) === String(teamId))
    const sourceTeam = plan.teams[teamIndex]
    if (taskId) taskIndex = sourceTeam?.tasks?.findIndex(task => String(task.taskId) === String(taskId)) ?? -1
    const task = sourceTeam?.tasks?.[taskIndex]
    if (!task) return
    const firstDestination = plan.teams.findIndex((_, index) => index !== teamIndex)
    taskMoveSaveGuardRef.current = false
    setTaskMoveSaving(false)
    setTaskMove({
      day,
      destinationDay: day,
      sourceTeamIndex: teamIndex,
      sourceTeamId: sourceTeam.teamId,
      taskIndex,
      taskId: task.taskId,
      historyId: task.historyId,
      destinationTeamIndex: firstDestination >= 0 ? firstDestination : teamIndex,
      time: task.time || task.scheduledTime || '',
      estimatedMinutes: serviceEstimateForTask(task, serviceForWeeklyTask(task))
    })
  }
  const openFridayAdvance = (day, teamIndex, taskIndex) => {
    if (!requirePermission('weekly.advanceGuard')) return
    const team = dayPlan(day).teams[teamIndex]
    const task = team?.tasks?.[taskIndex]
    if (!task || taskIsResolvedForPlanning(task, day, operationalHistory)) return
    try {
      const preliminary = fridayAdvanceDestination(day, team, {}, today)
      const destination = fridayAdvanceDestination(day, team, dayPlan(preliminary.day), today)
      taskMoveSaveGuardRef.current = false
      setTaskMoveSaving(false)
      setTaskMove({ day, destinationDay: destination.day, sourceTeamIndex: teamIndex, sourceTeamId: team.teamId,
        taskIndex, taskId: task.taskId, historyId: task.historyId, destinationTeamIndex: destination.index,
        time: '16:00', estimatedMinutes: serviceEstimateForTask(task, serviceForWeeklyTask(task)), advanceToFriday: true })
    } catch (error) { setNotice(error.message) }
  }
  const weeklyMoveDestinationPlan = move => {
    const plan = dayPlan(move.destinationDay)
    if (!move.advanceToFriday) return plan
    const source = dayPlan(move.day).teams.find(team => String(team.teamId) === String(move.sourceTeamId))
    return fridayAdvanceDestination(move.day, source, plan, today).plan
  }
  const selectWeeklyTaskMoveDate = destinationDay => {
    const destinationPlan = /^\d{4}-\d{2}-\d{2}$/.test(destinationDay) ? dayPlan(destinationDay) : { teams: [] }
    setTaskMove(previous => {
      if (!previous) return previous
      const firstDestination = destinationPlan.teams.findIndex((team, index) => destinationDay !== previous.day || (
        String(team.teamId || '') !== String(previous.sourceTeamId || '') && index !== previous.sourceTeamIndex
      ))
      return { ...previous, destinationDay, destinationTeamIndex: firstDestination >= 0 ? firstDestination : 0, responsibleId: '' }
    })
  }
  const confirmWeeklyTaskMove = async () => {
    if (!requirePermission(taskMove?.advanceToFriday ? 'weekly.advanceGuard' : 'planning.reschedule')) return
    if (!taskMove || taskMoveSaveGuardRef.current) return
    const { day, destinationDay, sourceTeamIndex, sourceTeamId, taskIndex, taskId, historyId, destinationTeamIndex } = taskMove
    const sourcePlan = dayPlan(day)
    let resolvedSourceIndex = sourcePlan.teams.findIndex(team => sourceTeamId && String(team.teamId || '') === String(sourceTeamId))
    if (resolvedSourceIndex < 0) resolvedSourceIndex = sourceTeamIndex
    const sourceTeam = sourcePlan.teams[resolvedSourceIndex]
    const originalTask = (sourceTeam?.tasks || []).find(task => taskId && String(task.taskId || '') === String(taskId)) || sourceTeam?.tasks?.[taskIndex]
    const durationCustomized = originalTask && (originalTask.estimatedMinutesCustomized === true || Number(taskMove.estimatedMinutes) !== Number(serviceEstimateForTask(originalTask, serviceForWeeklyTask(originalTask))))
    const movedTask = originalTask && stampServiceRecord({
      ...originalTask,
      time: taskMove.time,
      estimatedMinutes: originalTask.vehicleControl ? 15 : taskMove.estimatedMinutes,
      estimatedMinutesCustomized: originalTask.vehicleControl ? false : durationCustomized
    }, authUser)
    let destinationPlan
    try { destinationPlan = weeklyMoveDestinationPlan(taskMove) }
    catch (error) { setNotice(error.message); return }
    const destinationTeam = taskMove.advanceToFriday
      ? destinationPlan.teams.find(team => team.memberIds?.length === 1 && String(team.memberIds[0]) === String(sourceTeam?.memberIds?.[0]))
      : destinationPlan.teams[destinationTeamIndex]
    if (taskMove.advanceToFriday && taskMove.time < '16:00') { setNotice('La guardia adelantada comienza a partir de las 16:00.'); return }
    if (!movedTask || !destinationTeam) {
      setNotice('No se encontró el servicio o el equipo de destino. Recargá la planificación e intentá nuevamente.')
      return
    }
    if (movedTask.vehicleControl) {
      try {
        const responsible = vehicleControlResponsible(destinationTeam, movedTask, taskMove.responsibleId)
        movedTask.technicianIds = [responsible.id]; movedTask.technicians = [responsible.name]
      } catch (error) { setNotice(error.message); return }
    }
    if (destinationDay === day && String(destinationTeam.teamId || '') === String(sourceTeam?.teamId || '') && (!movedTask.vehicleControl || String(movedTask.technicianIds?.[0]) === String(originalTask.technicianIds?.[0]))) {
      setNotice('Elegí otro equipo o una fecha diferente para reasignar el servicio.')
      return
    }
    if (destinationDay < today) { setNotice('Elegí la fecha de hoy o una fecha futura.'); return }
    const destinationHours = hoursForDay(destinationDay, destinationTeam.teamId)
    if (!destinationHours) { setNotice('Los domingos no están habilitados para programar servicios.'); return }
    const destinationHoliday = holidayStateForDay(destinationDay)
    if (holidayCalendar.loading) { setNotice('Esperá mientras se verifica el calendario de feriados.'); return }
    if (holidayCalendar.error) { setNotice('No se pudo verificar el calendario de feriados. Reintentá antes de mover el servicio.'); return }
    if (destinationHoliday.blocked) { setNotice(destinationHoliday.decision?.status === 'closed' ? 'La fecha de destino fue definida como día no operativo.' : 'Primero definí si el feriado de destino será laboral o no operativo.'); return }
    const destinationAdvance = advancedGuardForDay(destinationDay)
    if (destinationAdvance) { setNotice(advancedSaturdayGuardMessage(destinationAdvance)); return }
    const schedule = taskMoveScheduleState(destinationDay, movedTask, weekly, destinationTeam.teamId)
    if (!schedule.valid) { setNotice(schedule.message); return }
    if (!destinationTeam.members?.length && !movedTask.vehicleControl) { setNotice('El equipo de destino no tiene técnicos asignados.'); return }
    const matchesTask = task => (taskId && String(task.taskId || '') === String(taskId)) || (historyId && String(task.historyId || '') === String(historyId))
    const destinationTasks = (destinationTeam.tasks || []).filter(task => !matchesTask(task) && !(
      task.time === movedTask.time && !String(task.client || '').trim() && !String(task.service || '').trim()
    ))
    let swapTask = null
    try { swapTask = vehicleControlSwapCandidate(movedTask, destinationTeam, day, destinationDay, movedTask.vehicleControl ? movedTask.technicianIds?.[0] : '') }
    catch (error) { setNotice(error.message); return }
    const destinationConflict = minimumServiceGapConflicts([{ ...destinationTeam, tasks: [...destinationTasks.filter(task => task !== swapTask), movedTask].map(task => {
      const occupancyTask = taskForScheduleOccupancy(task, destinationDay, operationalHistory)
      return occupancyTask ? taskWithServiceEstimate(occupancyTask, serviceForWeeklyTask(task)) : null
    }).filter(Boolean) }])[0]
    if (destinationConflict) { setNotice(planningConflictMessage(destinationDay, destinationTeam, destinationTeamIndex, destinationConflict)); return }
    const baseRecord = historyRecordForTask(movedTask, day, operationalHistory) || null
    const baseTask = weekly?.[day]?.teams?.flatMap(team => team.tasks || []).find(matchesTask) || null
    const destinationRecordData = weeklyHistoryRecord(destinationDay, destinationTeam, destinationTeamIndex, movedTask, destinationTasks.length)
    const changedDate = destinationDay !== day
    const record = stampServiceRecord({
      ...baseRecord,
      ...destinationRecordData,
      id: baseRecord?.id || destinationRecordData.id,
      status: changedDate ? 'Pendiente' : (baseRecord?.status || movedTask.status || 'Pendiente'),
      scheduledDate: '',
      ...(changedDate ? { rescheduledFrom: day, reprogrammedAt: new Date().toISOString() } : {})
    }, authUser)
    const savedTask = { ...movedTask, historyId: record.id, status: record.status }
    taskMoveSaveGuardRef.current = true
    setTaskMoveSaving(true)
    try {
      await persistWeeklyService({
        day: destinationDay,
        team: destinationTeam,
        task: savedTask,
        record,
        baseRecord,
        baseTask,
        sourceDay: day,
        advanceToFriday: Boolean(taskMove.advanceToFriday),
        swapTaskId: swapTask?.taskId || '',
        responsibleId: movedTask.vehicleControl ? movedTask.technicianIds?.[0] : '',
        sourceTeamId: sourceTeam.teamId
      })
      setTaskMove(null)
      if (changedDate) setAnchor(destinationDay)
      setNotice(changedDate
        ? `El servicio fue reprogramado para el ${prettyDate(destinationDay)} en ${destinationTeam.label || `Equipo ${destinationTeamIndex + 1}`}.`
        : `El servicio fue reasignado a ${destinationTeam.label || `Equipo ${destinationTeamIndex + 1}`} y se conservó toda su información.`)
    } catch (error) {
      setNotice(`No se pudo reasignar el servicio. ${error.message || 'Comprobá la conexión e intentá nuevamente.'}`)
    } finally {
      taskMoveSaveGuardRef.current = false
      setTaskMoveSaving(false)
    }
  }
  const updateTeam = (day, teamIndex, patch) => updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index === teamIndex ? { ...team, ...patch } : team) }))
  const persistMemberSelection = async (day, teamIndex, target, desired, plan) => {
    const selectionKey = weeklyTeamInteractionKey(day, target.teamId, teamIndex)
    const preview = { ...desired, phase: 'pending', revision: null, sentMemberIds: desired.memberIds, sentMembers: desired.members }
    setMemberSelections(previous => ({ ...previous, [selectionKey]: preview }))
    try {
      await afterInteractionPaint()
      if (!requirePermission('planning.technicians')) throw new Error('El permiso para asignar técnicos cambió.')
      const payload = await persistWeeklyService({
        operation: 'team-members',
        day,
        teamId: target.teamId,
        teamIndex,
        baseMemberIds: target.memberIds || [],
        baseMembers: target.members || [],
        materializeTeam: !(weekly[day]?.teams || []).some((team, index) => team.teamId
          ? String(team.teamId) === String(target.teamId)
          : team.label ? teamLabelNumber(team) === teamLabelNumber(target) : index === teamIndex),
        memberIds: preview.sentMemberIds,
        members: preview.sentMembers,
        guardOverride: isSaturday(day) ? true : undefined,
        fallbackPlan: plan
      })
      setMemberSelections(previous => ({ ...previous, [selectionKey]: acknowledgedInteraction(previous[selectionKey], payload) }))
    } catch (error) {
      setMemberSelections(previous => {
        const next = { ...previous }
        delete next[selectionKey]
        return next
      })
      setNotice(`No se guardó la asignación de técnicos. ${error.message || 'Recargá la planificación e intentá nuevamente.'}`)
    }
  }
  const toggleWeeklyTech = async (day, teamIndex, technician) => {
    if (!requirePermission('planning.technicians')) return
    const advance = advancedGuardForDay(day)
    if (advance) {
      setTechPicker(null)
      setNotice(advancedSaturdayGuardMessage(advance))
      return
    }
    technician = typeof technician === 'string' ? activeTechs.find(item => item.name === technician) : technician
    if (!technician) return
    const plan = dayPlan(day)
    const actualIndex = isSaturday(day) ? 0 : teamIndex
    const target = plan.teams[actualIndex]
    if (!target) { setNotice('El equipo cambió o fue eliminado. Recargá la planificación antes de reintentar.'); return }
    const selectionKey = weeklyTeamInteractionKey(day, target.teamId, actualIndex)
    const pending = memberSelectionsRef.current[selectionKey]
    const selection = pending || target
    const selected = (selection.memberIds || []).some(id => String(id) === String(technician.id))
    let memberIds = [...(selection.memberIds || [])]
    let members = [...(selection.members || [])]
    if (isSaturday(day)) {
      // Un sábado admite una sola persona: elegir otro nombre crea una
      // excepción puntual sin modificar la rotación anual.
      if (selected) return
      memberIds = [technician.id]
      members = [technician.name]
    } else if (selected) {
      memberIds = memberIds.filter(id => String(id) !== String(technician.id))
      members = members.filter(name => name !== technician.name)
    } else {
      memberIds.push(technician.id)
      members.push(technician.name)
    }
    const preview = { phase: 'pending', revision: null, day, teamId: target.teamId, teamIndex: actualIndex, memberIds, members }
    if (pending) {
      // Do not enqueue one request per click: this is the desired final state.
      setMemberSelections(previous => ({ ...previous, [selectionKey]: { ...previous[selectionKey], memberIds, members } }))
      return
    }
    await persistMemberSelection(day, actualIndex, target, preview, plan)
  }
  const updateTask = (day, teamIndex, taskIndex, patch, action) => updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index !== teamIndex ? team : { ...team, tasks: team.tasks.map((task, index) => index === taskIndex ? stampServiceRecord({ ...task, ...permittedPlanningPatch(patch, { can, existing: Boolean(historyRecordForTask(task, day, operationalHistory)), task, action }) }, authUser) : task) }) }))
  const addTeam = day => {
    if (!requirePermission('planning.teams.create')) return
    if (dayHasFinished(day)) { setNotice(finishedDayMessage(day)); return }
    if (isSaturday(day)) { setNotice('Los sábados trabaja un solo técnico, por lo que la agenda admite únicamente un equipo.'); return }
    updateDay(day, plan => {
      const team = createTeam(plan.teams.length, null, day)
      return {
        ...plan,
        removedTeams: (plan.removedTeams || []).filter(marker => !removedWeeklyTeamMatches(marker, team, plan.teams.length)),
        teams: [...plan.teams, team]
      }
    })
  }
  const removeWeeklyTeam = async (day, teamIndex) => {
    if (!requirePermission('planning.teams.delete')) return
    const removedTeam = dayPlan(day).teams[teamIndex]
    if (!removedTeam) return
    if ((removedTeam.tasks || []).some(task => task.vehicleControl) && !allowOmit) {
      setTeamRemoval(null)
      setNotice('Sólo el rol Administrador puede eliminar un equipo que contiene un control vehicular.')
      return
    }
    try {
      await persistWeeklyService({ operation: 'team-remove', day, teamId: removedTeam.teamId, teamIndex, fallbackPlan: dayPlan(day) })
      setTeamRemoval(null)
      setTechPicker(null)
      setNotice('El equipo y su asignación fueron eliminados; sus controles vehiculares pendientes, si los había, fueron omitidos.')
    } catch (error) {
      setTeamRemoval(null)
      setNotice(`No se eliminó el equipo. ${error.message || 'Revisá la versión actual e intentá nuevamente.'}`)
    }
  }
  const hoursForDay = (day, teamId) => planningHoursForDay(day, weekly, teamId)
  const conflictCache = useMemo(() => new Map(), [weekly, activeTechs, operationalHistory, services])
  const conflictsForDay = day => {
    const key = `technicians:${day}`
    if (!conflictCache.has(key)) conflictCache.set(key, technicianTimeConflicts(dayPlan(day).teams.map(team => ({ ...team, tasks: (team.tasks || []).map(task => taskForScheduleOccupancy(task, day, operationalHistory)).filter(Boolean) })), activeTechs))
    return conflictCache.get(key)
  }
  const gapConflictsForDay = day => {
    const key = `gaps:${day}`
    if (!conflictCache.has(key)) conflictCache.set(key, minimumServiceGapConflicts(dayPlan(day).teams.map(team => ({ ...team, tasks: (team.tasks || []).map(task => {
      const occupancyTask = taskForScheduleOccupancy(task, day, operationalHistory)
      return occupancyTask ? taskWithServiceEstimate(occupancyTask, serviceForWeeklyTask(task)) : null
    }).filter(Boolean) }))))
    return conflictCache.get(key)
  }
  const conflictForWeeklyTask = (day, teamIndex, taskIndex, overrideTask = null) => {
    const cacheKey = `task:${day}:${teamIndex}:${taskIndex}`
    if (!overrideTask && conflictCache.has(cacheKey)) return conflictCache.get(cacheKey)
    const team = dayPlan(day).teams[teamIndex]
    if (!team) return null
    const target = overrideTask || team.tasks?.[taskIndex]
    if (!target || taskIsResolvedForPlanning(target, day, operationalHistory)) return null
    const tasks = (team.tasks || []).map((task, index) => {
      const candidate = index === taskIndex && overrideTask ? overrideTask : task
      const occupancyTask = taskForScheduleOccupancy(candidate, day, operationalHistory)
      return occupancyTask ? { ...taskWithServiceEstimate(occupancyTask, serviceForWeeklyTask(candidate)), _scheduleTaskIndex: index } : null
    }).filter(Boolean)
    if (overrideTask && taskIndex >= (team.tasks || []).length) {
      const occupancyTask = taskForScheduleOccupancy(overrideTask, day, operationalHistory)
      if (occupancyTask) tasks.push({ ...taskWithServiceEstimate(occupancyTask, serviceForWeeklyTask(overrideTask)), _scheduleTaskIndex: taskIndex })
    }
    const conflict = minimumServiceGapConflicts([{ ...team, tasks }]).find(conflict => conflict.firstTask._scheduleTaskIndex === taskIndex || conflict.secondTask._scheduleTaskIndex === taskIndex) || null
    if (!overrideTask) conflictCache.set(cacheKey, conflict)
    return conflict
  }
  const teamGapCache = useMemo(() => new Map(), [weekly, activeTechs, operationalHistory, services, planningClock])
  const availableGapsForTeam = (day, teamIndex, now) => {
    const teams = dayPlan(day).teams.map(team => ({ ...team, tasks: team.tasks.map(task => taskWithServiceEstimate({ ...task, ...historyRecordForTask(task, day, operationalHistory), date: day }, serviceForWeeklyTask(task))) }))
    return teamServiceGaps(teams, teamIndex, { ...hoursForDay(day, teams[teamIndex]?.teamId), fullAvailability: true, day, now }, team => hoursForDay(day, team.teamId))
  }
  const gapsForTeam = (day, team, teamIndex, hours) => {
    const key = weeklyTeamInteractionKey(day, team.teamId, teamIndex)
    if (!teamGapCache.has(key)) {
      teamGapCache.set(key, withLunchNotice(team.tasks, availableGapsForTeam(day, teamIndex, planningClock), hours))
    }
    return teamGapCache.get(key)
  }
  const commitWeeklyCustomerText = (day, teamIndex, taskIndex, value) => updateTask(day, teamIndex, taskIndex, { newCustomer: false, subscriberReservation: false, customerId: '', client: value, clientAccount: '', clientNameAtService: '', address: '', phone: '' })
  const selectWeeklyCustomerResult = (day, teamIndex, taskIndex, customer) => updateTask(day, teamIndex, taskIndex, customerLinkPatch(dayPlan(day).teams[teamIndex]?.tasks?.[taskIndex], customer, authUser), dayPlan(day).teams[teamIndex]?.tasks?.[taskIndex]?.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')
  const beginWeeklyNewCustomer = (day, teamIndex, taskIndex, value) => updateTask(day, teamIndex, taskIndex, { newCustomer: true, subscriberReservation: false, customerId: '', client: value, clientAccount: '', clientNameAtService: normalizeCustomerName(value), address: '', phone: '' }, 'customers.create')
  const beginWeeklySubscriberReservation = (day, teamIndex, taskIndex, value) => updateTask(day, teamIndex, taskIndex, subscriberReservationPatch(value, authUser), 'planning.reservation.create')
  const addTask = (day, teamIndex, startTime = '', ticket = null) => {
    if (!requirePermission('planning.create')) return
    if (dayHasFinished(day)) { setNotice(finishedDayMessage(day)); return }
    const holidayState = holidayStateForDay(day)
    if (holidayState.blocked) {
      setNotice(holidayState.decision?.status === 'closed' ? 'La fecha fue definida como día no operativo.' : 'Primero definí si el feriado será laboral o no operativo.')
      return
    }
    const advance = advancedGuardForDay(day)
    if (advance) {
      setNotice(advancedSaturdayGuardMessage(advance))
      return
    }
    let ticketDraft = {}
    if (ticket) {
      if (!requirePermission('tickets.linkService')) return
      try { ticketDraft = ticketServiceDraft(ticket, customers, authUser, services) }
      catch (error) { setNotice(error.message); return }
    }
    const task = taskWithServiceEstimate({ ...blankTask(), ...ticketDraft, time: startTime }, ticket ? suggestedServiceForTicket(ticket, services) : null)
    const teamSnapshot = dayPlan(day).teams[teamIndex]
    if (!teamSnapshot) { setNotice('El equipo ya no está disponible. Revisá la planificación.'); return }
    const available = availableGapsForTeam(day, teamIndex, new Date())
    if (!startTime || !available.some(gap => gap.start === startTime)) { setNotice('La disponibilidad cambió. Elegí una franja horaria disponible para agregar el servicio.'); return }
    const taskIndex = teamSnapshot.tasks.length
    // New services live only in the editor until the explicit save succeeds.
    // Opening or abandoning this form must not enqueue an empty task for autosave.
    taskEditorSaveGuardRef.current = false
    setTaskEditorSaving(false)
    setTaskEditorError('')
    setTaskEditor({ day, teamIndex, taskIndex, teamId: teamSnapshot.teamId, teamSnapshot: structuredClone(teamSnapshot), persistedTeam: Boolean(weekly[day]?.teams?.some(team => String(team.teamId) === String(teamSnapshot.teamId))), taskId: task.taskId, baseTask: null, baseRecord: null, initialDraft: structuredClone(task), draft: task, photoData: '', photoRemoved: false })
    if (ticket) {
      weeklyAnchorFollowsCurrentRef.current = false
      setAnchor(day)
      setTicketSchedule(null)
    }
  }
  const removeWeeklyTask = async ({ day, teamId, teamIndex, taskId, historyId, taskIndex, time, wasPlaceholder }) => {
    const selectedTeam = dayPlan(day).teams.find((team, index) => (teamId && String(team.teamId || '') === String(teamId)) || index === teamIndex)
    const selectedTask = selectedTeam?.tasks?.find((task, index) => (taskId && String(task.taskId || '') === String(taskId)) || (historyId && String(task.historyId || '') === String(historyId)) || index === taskIndex)
    if (!selectedTask?.vehicleControl && !requirePermission('planning.remove')) return
    if (selectedTask?.vehicleControl && !allowOmit) { setNotice('Sólo el rol Administrador puede omitir un control vehicular.'); setTaskRemoval(null); return }
    try {
      await persistWeeklyService({ operation: 'task-remove', day, teamId, teamIndex, taskId, historyId, taskIndex, time, wasPlaceholder, fallbackPlan: dayPlan(day) })
      setTaskRemoval(null)
      setNotice(selectedTask?.vehicleControl ? 'El control vehicular fue omitido para esta semana y ya no se mostrará al técnico.' : 'El servicio fue eliminado de la planificación semanal.')
    } catch (error) {
      setTaskRemoval(null)
      setNotice(`No se eliminó el servicio. ${error.message || 'Revisá la versión actual e intentá nuevamente.'}`)
    }
  }
  const openDay = day => {
    if (!requirePermission('weekly.daily')) return
    if (readOnly) return
    if (dayHasFinished(day)) { openDaily(day, []); return }
    const hours = hoursForDay(day)
    if (!hours) { setNotice('Los domingos no están habilitados para programar servicios.'); return }
    const holidayState = holidayStateForDay(day)
    if (holidayState.blocked) { setNotice(holidayState.decision?.status === 'closed' ? 'La fecha fue definida como día no operativo.' : 'Primero definí si el feriado será laboral o no operativo.'); return }
    const advance = advancedGuardForDay(day)
    if (advance) { setNotice(advancedSaturdayGuardMessage(advance)); return }
    const invalidTime = dayPlan(day).teams.flatMap(team => team.tasks).find(task => !taskIsResolvedForPlanning(task, day, operationalHistory) && task.time && (task.time < hours.min || task.time > hours.max))
    if (invalidTime) { setNotice(`Hay horarios fuera del rango permitido para este día (${hours.label}).`); return }
    const taskOutsideHours = dayPlan(day).teams.flatMap(team => (team.tasks || []).map(task => ({ task, hours: hoursForDay(day, team.teamId) }))).find(({ task, hours }) => {
      if (!taskHasContent(task) || taskIsResolvedForPlanning(task, day, operationalHistory)) return false
      const interval = taskOccupiedInterval(taskWithServiceEstimate(task, serviceForWeeklyTask(task)), hours)
      return interval && interval.serviceEnd > serviceTimeInMinutes(hours.max)
    })
    if (taskOutsideHours) { const { task, hours } = taskOutsideHours; const interval = taskOccupiedInterval(taskWithServiceEstimate(task, serviceForWeeklyTask(task)), hours); setNotice(`Hay una franja que termina a las ${interval.serviceEndTime}, fuera del horario habilitado (${hours.label}).`); return }
    const scheduledTasks = dayPlan(day).teams.flatMap((team, teamIndex) => team.tasks.map((task, taskIndex) => ({ task, teamIndex, taskIndex }))).filter(({ task }) => !taskIsResolvedForPlanning(task, day, operationalHistory) && [task.service, task.client, task.address, task.detail, task.phone, task.paymentMethod, task.amount, task.monthlyFee, task.form].some(value => String(value || '').trim()))
    const incompleteTask = scheduledTasks.find(({ task }) => !task.vehicleControl && (!task.time || !task.service || (!task.customerId && !task.subscriberReservation && !(isTrainingService(serviceForWeeklyTask(task)) && String(task.client || '').trim())) || !task.address || (!task.phone && !isTrainingService(serviceForWeeklyTask(task))) || !task.detail || (serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && !task.installationZone) || requiresPaymentAmount(task, serviceForWeeklyTask(task))))
    if (incompleteTask) {
      const { task, teamIndex, taskIndex } = incompleteTask
      const missing = [['hora', task.time], ['tipo de servicio', task.service], ['cliente', task.client], ['dirección', task.address], ['contacto', isTrainingService(serviceForWeeklyTask(task)) || task.phone], ['detalle', task.detail]].filter(([, value]) => !String(value || '').trim()).map(([label]) => label)
      if (serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && !task.installationZone) missing.push('ubicación de la instalación')
      if (requiresPaymentAmount(task, serviceForWeeklyTask(task))) missing.push('monto')
      setNotice(`Completá los campos obligatorios de Equipo ${teamIndex + 1}, tarjeta ${taskIndex + 1}: ${missing.join(', ')}.`)
      return
    }
    const gapConflicts = gapConflictsForDay(day)
    if (gapConflicts.length) { const conflict = gapConflicts[0]; setNotice(planningConflictMessage(day, dayPlan(day).teams[conflict.teamIndex], conflict.teamIndex, conflict)); return }
    const conflicts = conflictsForDay(day)
    if (conflicts.length) { setNotice(`Conflicto de asignación: ${conflicts.map(item => `${item.name} a las ${item.time} (equipos ${item.teams.join(' y ')})`).join('; ')}.`); return }
    const teams = dayPlan(day).teams.map(({ teamId, memberIds, members, tasks }) => ({ teamId, memberIds, members, tasks }))
    openDaily(day, teams)
  }
  const weeklyHistoryRecord = (day, team, teamIndex, task, taskIndex) => ({
    awaitingConfirmation: task.awaitingConfirmation === true,
    id: task.historyId || `work-${task.taskId || `${day}-${teamIndex}-${taskIndex}`}`,
    sourceTaskId: task.taskId,
    ...ticketLinkFields(task),
    date: day,
    time: task.time,
    scheduledTime: task.time,
    estimatedMinutes: serviceEstimateForTask(task, serviceForWeeklyTask(task)),
    estimatedMinutesCustomized: Boolean(task.estimatedMinutesCustomized),
    team: team.label || `Equipo ${teamIndex + 1}`,
    teamId: team.teamId,
    technicianIds: task.vehicleControl && task.technicianIds?.length ? task.technicianIds : team.memberIds || [],
    technicians: task.vehicleControl && task.technicians?.length ? task.technicians : team.members || [],
    serviceTypes: task.serviceTypes,
    serviceId: serviceForWeeklyTask(task)?.id || task.serviceId,
    service: serviceForWeeklyTask(task)?.name || task.service,
    client: task.client,
    customerId: task.customerId || '',
    clientAccount: task.clientAccount || '',
    clientNameAtService: task.clientNameAtService || String(task.client || '').replace(/^[^\s]+\s+/, ''),
    detail: task.detail,
    internalNote: task.internalNote || '',
    internalChecklist: normalizeInternalChecklist(task.internalChecklist),
    ...applicableServiceExtras(task, serviceForWeeklyTask(task)),
    address: task.address, newAddress: task.newAddress || '',
    phone: task.phone,
    installationZone: task.installationZone || '',
    servicePhotoAttached: Boolean(task.servicePhotoAttached),
    servicePhotoUrl: task.servicePhotoUrl || '',
    servicePhotoAttachedAt: task.servicePhotoAttachedAt || '',
    ...serviceTrace(task)
  })
  const displayDate = day => prettyDate(day).replace(/ de (\p{L})/u, (_, letter) => ` de ${letter.toUpperCase()}`)
  return <>
    {ticketSchedule && (() => {
      const day = ticketSchedule.day
      const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day || '')
      const teams = validDay ? dayPlan(day).teams : []
      const teamIndex = teams.findIndex(team => String(team.teamId) === String(ticketSchedule.teamId))
      const hours = validDay ? teams.some(team => hoursForDay(day, team.teamId)) : false
      const holiday = validDay ? holidayStateForDay(day) : null
      const advanced = validDay ? advancedGuardForDay(day) : null
      const unavailable = !validDay ? 'Elegí una fecha.' : day < today ? finishedDayMessage(day) : !hours ? 'La fecha no está habilitada para programar servicios.' : holiday?.blocked ? 'Primero definí la disponibilidad del feriado desde la agenda.' : advanced ? advancedSaturdayGuardMessage(advanced) : ''
      const gaps = !unavailable ? teams.flatMap((team, index) => team.members?.length && hoursForDay(day, team.teamId) ? availableGapsForTeam(day, index, planningClock).map(gap => ({ ...gap, teamId: String(team.teamId), teamLabel: team.label, members: team.members })) : []).sort((a, b) => a.start.localeCompare(b.start) || a.teamLabel.localeCompare(b.teamLabel, 'es', { numeric: true })) : []
      return <TicketServiceSchedule selection={ticketSchedule} suggestedService={suggestedServiceForTicket(ticketSchedule.ticket, services)} today={today} gaps={gaps} unavailable={unavailable} onChange={patch => setTicketSchedule(previous => ({ ...previous, ...patch }))} onClose={() => setTicketSchedule(null)} onContinue={() => addTask(day, teamIndex, ticketSchedule.startTime, ticketSchedule.ticket)} />
    })()}
    {techPicker && <button title="Cerrá el selector de técnicos y volvé a la agenda." className="picker-backdrop" aria-label="Cerrar selector de técnicos" onClick={() => setTechPicker(null)} />}
    {teamRemoval && <Confirm title="Quitar equipo" detail={`¿Querés quitar ${teamRemoval.label} de la planificación del ${prettyDate(teamRemoval.day)}? Se quitará el equipo y su asignación de técnicos de ese día. Si sólo tiene controles vehiculares pendientes, un administrador también los omitirá porque esos vehículos no se utilizarán. Otros servicios o controles completados impiden eliminarlo.`} destructive action={() => removeWeeklyTeam(teamRemoval.day, teamRemoval.teamIndex)} close={() => setTeamRemoval(null)} />}
    {taskRemoval && <Confirm title={taskRemoval.vehicleControl ? 'Omitir control vehicular' : 'Eliminar servicio'} detail={taskRemoval.vehicleControl ? `¿Querés omitir este control para el ${prettyDate(taskRemoval.day)}? El técnico no tendrá que realizarlo y no se volverá a generar al guardar la configuración mensual.` : `¿Querés eliminar el Servicio ${taskRemoval.taskIndex + 1} de ${taskRemoval.label} para el ${prettyDate(taskRemoval.day)}?${taskRemoval.journey ? ' Si la jornada está pendiente, quedará cancelada. Se conservarán su historial y las otras jornadas.' : taskRemoval.historyId ? ' También se quitará el registro pendiente vinculado.' : ''}`} destructive action={() => removeWeeklyTask(taskRemoval)} close={() => setTaskRemoval(null)} />}
    {reorder && <ReorderServicesModal {...reorder} onClose={() => setReorder(null)} onSave={async changes => {
      if (readOnly || !can('weekly.reorder') || reorder.day < localToday()) throw new Error('La jornada ya finalizó o no tenés permiso para editarla.')
      if (holidayCalendar.loading || holidayCalendar.error || holidayStateForDay(reorder.day).blocked || advancedGuardForDay(reorder.day)) throw new Error('La jornada no está habilitada para cambios.')
      await persistWeeklyConfiguration(snapshot => reorderServices(snapshot, { ...reorder, changes, stamp: value => stampServiceRecord(value, authUser), validate: (team, latestHistory) => {
        const currentTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
        for (const change of changes) {
          const task = team.tasks.find(item => item.taskId === change.taskId)
          const schedule = taskMoveScheduleState(reorder.day, taskWithServiceEstimate(task, serviceForWeeklyTask(task)), weekly, team.teamId)
          if (!schedule.valid) throw new Error(schedule.message)
          if (reorder.day === localToday() && change.time < currentTime) throw new Error('El nuevo horario ya pasó. Elegí una hora actual o futura.')
        }
        if (changes[0].time >= changes[1].time) throw new Error('El segundo servicio debe comenzar después del primero.')
        const conflict = minimumServiceGapConflicts([{ ...team, tasks: team.tasks.map(task => { const occupied = taskForScheduleOccupancy(task, reorder.day, latestHistory); return occupied ? taskWithServiceEstimate(occupied, serviceForWeeklyTask(task)) : null }).filter(Boolean) }])[0]
        if (conflict) throw new Error(scheduleConflictMessage(conflict))
      } }))
    }} />}
    {taskMove && (() => {
      const sourcePlan = dayPlan(taskMove.day)
      const sourceTeam = sourcePlan.teams.find(team => taskMove.sourceTeamId && String(team.teamId || '') === String(taskMove.sourceTeamId)) || sourcePlan.teams[taskMove.sourceTeamIndex]
      const validDestinationDay = /^\d{4}-\d{2}-\d{2}$/.test(taskMove.destinationDay || '')
      let destinationPlan = { teams: [] }
      try { if (validDestinationDay) destinationPlan = weeklyMoveDestinationPlan(taskMove) } catch { /* Submit explains changes to the source guard. */ }
      const movingControl = sourceTeam?.tasks?.find(task => task.taskId === taskMove.taskId)
      const destinationOptions = destinationPlan.teams.map((team, index) => ({ team, index })).filter(({ team, index }) => movingControl?.vehicleControl || taskMove.destinationDay !== taskMove.day || (String(team.teamId || '') !== String(sourceTeam?.teamId || '') && index !== taskMove.sourceTeamIndex))
      const selectedDestination = taskMove.advanceToFriday
        ? destinationOptions.find(({ team }) => team.memberIds?.length === 1 && String(team.memberIds[0]) === String(sourceTeam?.memberIds?.[0]))
        : destinationOptions.find(({ index }) => index === taskMove.destinationTeamIndex)
      let controlResponsible = null
      try { if (movingControl?.vehicleControl) controlResponsible = vehicleControlResponsible(selectedDestination?.team, movingControl, taskMove.responsibleId) } catch { /* Explicit choice is required for a crew. */ }
      const moveDraft = movingControl ? { ...movingControl, time: taskMove.time, estimatedMinutes: movingControl.vehicleControl ? 15 : taskMove.estimatedMinutes, estimatedMinutesCustomized: movingControl.vehicleControl ? false : movingControl.estimatedMinutesCustomized === true || Number(taskMove.estimatedMinutes) !== Number(serviceEstimateForTask(movingControl, serviceForWeeklyTask(movingControl))) } : null
      if (moveDraft?.vehicleControl && controlResponsible) { moveDraft.technicianIds = [controlResponsible.id]; moveDraft.technicians = [controlResponsible.name] }
      const moveSchedule = taskMoveScheduleState(taskMove.destinationDay, moveDraft, weekly, selectedDestination?.team?.teamId)
      let swapPreview = null
      try { swapPreview = vehicleControlSwapCandidate(moveDraft, selectedDestination?.team, taskMove.day, taskMove.destinationDay, controlResponsible?.id) } catch { /* The submit handler explains ambiguous controls. */ }
      const sameMovingTask = task => (taskMove.taskId && String(task.taskId || '') === String(taskMove.taskId)) || (taskMove.historyId && String(task.historyId || '') === String(taskMove.historyId))
      const moveConflict = moveDraft && selectedDestination ? minimumServiceGapConflicts([{ ...selectedDestination.team, tasks: [...(selectedDestination.team.tasks || []).filter(task => !sameMovingTask(task) && task !== swapPreview), moveDraft].map(task => {
        const occupancyTask = taskForScheduleOccupancy(task, taskMove.destinationDay, operationalHistory)
        return occupancyTask ? taskWithServiceEstimate(occupancyTask, serviceForWeeklyTask(task)) : null
      }).filter(Boolean) }])[0] : null
      const destinationIsSunday = validDestinationDay && !hoursForDay(taskMove.destinationDay)
      const sameDayWithoutAlternative = taskMove.destinationDay === taskMove.day && !destinationOptions.length
      return <div className="modal-backdrop weekly-editor-backdrop" onMouseDown={() => { if (!taskMoveSaving) setTaskMove(null) }}><section className="modal task-move-modal weekly-move-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-move-title" onMouseDown={event => event.stopPropagation()}><button title="Cerrá esta ventana y volvé a la pantalla anterior." className="modal-close" disabled={taskMoveSaving} onClick={() => { if (!taskMoveSaving) setTaskMove(null) }}><Icon name="close" /></button><p className="eyebrow">REASIGNAR SERVICIO</p><h2 id="weekly-move-title">{taskMove.advanceToFriday ? 'Adelantar al viernes' : 'Cambiar equipo, horario o fecha'}</h2>{taskMove.advanceToFriday && <p>Se conservará el técnico del sábado y se creará su equipo individual si hace falta. Elegí una franja entre las 16:00 y las 20:00. Los demás servicios del sábado se conservarán.</p>}<p>Revisá el destino, el horario y la duración antes de confirmar.</p><label>Origen<input value={`${prettyDate(taskMove.day)} · ${sourceTeam?.label || `Equipo ${taskMove.sourceTeamIndex + 1}`}`} readOnly /></label><label>Nueva fecha<input type="date" min={today} required disabled={taskMove.advanceToFriday} value={taskMove.destinationDay} onChange={event => selectWeeklyTaskMoveDate(event.target.value)} /></label><label>Equipo de destino<select value={selectedDestination ? selectedDestination.index : ''} disabled={taskMove.advanceToFriday || !validDestinationDay || destinationIsSunday || !destinationOptions.length} onChange={event => setTaskMove(previous => ({ ...previous, destinationTeamIndex: Number(event.target.value), responsibleId: '' }))}><option value="" disabled>Seleccionar equipo</option>{destinationOptions.map(({ team, index }) => <option key={team.teamId || index} value={index}>{team.label || `Equipo ${index + 1}`} · {team.members?.join(' / ') || 'Sin técnicos'}</option>)}</select></label>{movingControl?.vehicleControl && <label>Responsable del control<select required value={controlResponsible?.id || ''} disabled={!selectedDestination || taskMoveSaving} onChange={event => setTaskMove(previous => ({ ...previous, responsibleId: event.target.value }))}><option value="" disabled>Seleccionar técnico</option>{(selectedDestination?.team.memberIds || []).map((id, index) => <option key={id} value={id}>{selectedDestination.team.members[index]}</option>)}</select><small>El control se asigna únicamente a esta persona.</small></label>}<label>Hora de inicio<input type="time" required min={taskMove.advanceToFriday ? '16:00' : moveSchedule.hours?.min} max={moveSchedule.hours?.max} value={taskMove.time || ''} onChange={event => setTaskMove(previous => ({ ...previous, time: event.target.value }))} /></label>{movingControl?.vehicleControl ? <label>Tiempo estimado<input value="15 minutos" readOnly /></label> : <ServiceEstimatedDurationField className="task-move-duration" value={taskMove.estimatedMinutes} onChange={estimatedMinutes => setTaskMove(previous => ({ ...previous, estimatedMinutes }))} />}{moveSchedule.interval && <p className="task-occupied-range task-move-range">Franja estimada: {moveSchedule.interval.startTime}–{moveSchedule.interval.serviceEndTime}</p>}{destinationIsSunday && <p className="field-error">Los domingos no están habilitados para programar servicios.</p>}{!destinationIsSunday && moveSchedule.message && <p className="field-error task-move-schedule-error" role="alert">{moveSchedule.message}</p>}{moveConflict && <p className="field-error task-move-schedule-error" role="alert">No se puede reasignar porque {scheduleConflictMessage(moveConflict)}.</p>}{sameDayWithoutAlternative && <p className="weekly-move-help">Este día no tiene otro equipo. Elegí una fecha diferente para reprogramar el servicio.</p>}{swapPreview && <p className="weekly-move-help" role="status">Se intercambiarán los controles: {movingControl.client} pasará a {selectedDestination.team.label} ({controlResponsible?.name}) y {swapPreview.client} pasará a {sourceTeam.label} ({movingControl.technicians?.[0]}). Solo para esta fecha.</p>}<div className="modal-actions"><button title="Cancelá esta operación sin aplicar los cambios del formulario." className="secondary" disabled={taskMoveSaving} onClick={() => setTaskMove(null)}><Icon name="close" size={16} />Cancelar</button><button title="Guardá el traslado al equipo, fecha y horario elegidos; si corresponde, intercambiá los controles indicados." className="primary" disabled={taskMoveSaving || (movingControl?.vehicleControl && !controlResponsible) || !validDestinationDay || destinationIsSunday || !selectedDestination || holidayCalendar.loading || !moveSchedule.valid || Boolean(moveConflict) || (taskMove.advanceToFriday && taskMove.time < '16:00')} onClick={confirmWeeklyTaskMove}><span aria-hidden="true">⇄</span>{taskMoveSaving ? 'Guardando…' : swapPreview ? 'Intercambiar controles' : taskMove.destinationDay === taskMove.day ? 'Reasignar servicio' : 'Reprogramar servicio'}</button></div></section></div>
    })()}
<div className="module-intro weekly-intro"><ModuleIntroduction><p className="eyebrow">PLANIFICACIÓN SEMANAL</p><h1>Agenda semanal</h1>{readOnly && <p className="weekly-description-mobile">Consulta de solo lectura.</p>}</ModuleIntroduction><div className="weekly-actions"><WeeklyServiceSearch anchor={anchor} weekly={weekly} history={history} getPlan={dayPlan} navigate={day => { weeklyAnchorFollowsCurrentRef.current = false; setAnchor(day) }} boardRef={weeklyBoardRef} openService={openTaskEditor} />{onOpenPlanning && ['weeklyHours', 'weeklyTeams', 'weeklyVehicles', 'weeklyGuards'].some(canReadConfiguration) && <button type="button" className="secondary weekly-planning-link" title="Abrí la planificación de recursos del mes seleccionado." onClick={() => onOpenPlanning(monthKey)}><Icon name="settings" size={16} />Planificación</button>}<label className="week-selector">Mostrar desde<input type="date" value={anchor} onChange={event => { if (!event.target.value) return; weeklyAnchorFollowsCurrentRef.current = false; setAnchor(event.target.value) }} /></label>    <nav className="weekly-date-navigation" aria-label="Navegar jornadas de la agenda">
      <button type="button" className="secondary" aria-label="Jornada anterior" title="Retroceder una jornada, omitiendo domingos" onClick={() => { weeklyAnchorFollowsCurrentRef.current = false; setAnchor(value => shiftWeeklyAnchor(value, -1)) }}>← <span>Anterior</span></button>
      <button type="button" className="secondary" title="Volvé a la jornada actual de la agenda semanal." onClick={() => { weeklyAnchorFollowsCurrentRef.current = true; setAnchor(defaultWeeklyAnchor()) }}>Hoy</button>
      <button type="button" className="secondary" aria-label="Jornada siguiente" title="Avanzar una jornada, omitiendo domingos" onClick={() => { weeklyAnchorFollowsCurrentRef.current = false; setAnchor(value => shiftWeeklyAnchor(value, 1)) }}><span>Siguiente</span> →</button>
    </nav></div></div>
    {completedService && <HistoryDetail customers={customers} record={completedService} close={() => setCompletedService(null)} actions={!readOnly && weeklyServiceSource && weeklyModalActions(weeklyServiceSource, true)} />}
    {pastService && <div className="modal-layer"><section className="modal detail-modal history-detail past-service-detail" role="dialog" aria-modal="true" aria-label="Servicio · solo lectura"><button title="Cerrá esta ventana y volvé a la pantalla anterior." type="button" className="close-modal" aria-label="Cerrar" onClick={() => setPastService(null)}><Icon name="close" /></button><p className="eyebrow">{prettyDate(pastService.date)} · SOLO LECTURA</p><h2>{pastService.client || pastService.service}</h2>{!readOnly && weeklyServiceSource && weeklyModalActions(weeklyServiceSource, true)}{[
      ['Resumen del servicio', [
        ['Servicio', serviceTypesLabel(pastService)], ['Estado', pastService.technicalStatus || pastService.status],
        ['Hora', pastService.time || pastService.scheduledTime], ['Tiempo estimado', pastService.estimatedMinutes ? `${pastService.estimatedMinutes} minutos` : ''],
        ['Equipo', pastService.team], ['Técnicos asignados', pastService.technicians?.join(' / ')]
      ]],
      ['Ubicación y contacto', [
        [addressChange.isAddressChange(pastService) ? 'Domicilio actual' : 'Dirección', pastService.address], ...(addressChange.isAddressChange(pastService) ? [['Domicilio nuevo', pastService.newAddress]] : []), ['Contacto', pastService.phone], ['Ubicación de la instalación', pastService.installationZone]
      ]],
      ['Pago y documentación', [
        ['Forma de pago', pastService.paymentMethod], ['Monto', formatCurrencyAmount(pastService.amount)], ['Abono mensual', formatCurrencyAmount(pastService.monthlyFee)], ['Meses congelados', pastService.freezeMonthlyFee ? `${pastService.frozenMonths} meses` : 'No'], ['Formulario', pastService.form], ['Email del formulario', pastService.formEmail]
      ]],
      ['Observaciones e información interna', [
        ['Detalle / observaciones', pastService.detail], ['Informe técnico', pastService.technicalObservation], ['Nota interna', pastService.internalNote]
      ]]
    ].map(([title, fields]) => <section className="past-detail-section" key={title}><h3>{title}</h3><dl className="past-detail-fields">{fields.map(([label, value]) => <div key={label} className={['Detalle / observaciones', 'Informe técnico', 'Nota interna'].includes(label) ? 'past-field-wide' : ['Dirección', 'Técnicos asignados'].includes(label) ? 'past-field-double' : ''}><dt>{label}</dt><dd className={['Monto', 'Abono mensual'].includes(label) ? 'past-field-money' : ''}>{value === '' || value == null ? <span className="past-field-empty">Sin información</span> : String(value)}</dd></div>)}</dl></section>)}{pastService.internalChecklist?.length > 0 && <section className="past-detail-section"><h3>Checklist</h3>{pastService.internalChecklist.map((item, index) => <p key={item.id || index}>{item.completed ? '✓' : '○'} {item.text}</p>)}</section>}<ServicePhoto record={pastService} className="history-service-photo" /><RegistrationForms record={pastService} /><ServiceCustomerMap record={pastService} customers={customers} /><div className="modal-actions"><button title="Cerrá esta ventana y volvé a la pantalla anterior." type="button" className="secondary" onClick={() => setPastService(null)}><Icon name="close" size={16} />Cerrar</button></div></section></div>}
    {dayPreview && <Preview title={`Agenda del ${prettyDate(dayPreview.day)}`} text={dayPreview.text} close={() => setDayPreview(null)} />}
    {taskEditor && (() => {
      const { day, teamIndex, taskIndex } = taskEditor
      const task = taskEditor.draft
      const hours = hoursForDay(day)
      const taskConflict = conflictForWeeklyTask(day, teamIndex, taskIndex, task)
      if (!task || !hours) return null
      return <><div className="modal-backdrop weekly-editor-backdrop" onMouseDown={() => { if (!taskEditorSaving) requestWeeklyLeave(() => setTaskEditor(null)) }}><section key={`${day}-${taskEditor.taskId}-${teamIndex}-${taskIndex}`} className="modal weekly-task-modal" role="dialog" aria-modal="true" aria-label={`Servicio ${taskIndex + 1}`} onMouseDown={event => event.stopPropagation()}><button type="button" className="modal-close" aria-label="Cerrar edición del servicio" title="Cerrá la edición del servicio; si hay cambios sin guardar, podrás guardarlos o descartarlos." onClick={() => { if (!taskEditorSaving) requestWeeklyLeave(() => setTaskEditor(null)) }}><Icon name="close" size={18} /></button><p className="eyebrow">AGENDA SEMANAL · {prettyDate(day)}</p><h2>{task.vehicleControl ? 'Control semanal de vehículo' : `Servicio ${taskIndex + 1}`}</h2><p className="weekly-modal-team">{taskEditor.teamSnapshot?.label || `Equipo ${teamIndex + 1}`} · {taskEditor.teamSnapshot?.members?.join(' / ') || 'Sin técnicos asignados'}</p>{weeklyModalActions(taskEditor)}<RegistrationForms record={historyRecordForTask(task, day, operationalHistory) || taskEditor.baseRecord} onBusyChange={setTaskEditorSaving} />{task.sourceTicketId && <div className="ticket-service-reference"><strong>Ticket#{task.ticketNumber}</strong><small>Este servicio queda asociado al reclamo para informar sus avances.</small></div>}{task.salesBooking && <aside className="sales-feedback"><strong>Reserva de Ventas · {task.salesBooking.byName}</strong><p>Traslados estimados por distancia en línea recta. Revisá dirección, duración y disponibilidad antes de confirmar la visita.</p>{task.salesBooking.reviewLocation && <p>Faltan ubicaciones de visitas contiguas: el traslado requiere revisión de Coordinación.</p>}{task.visitLocation?.coordinates && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.visitLocation.coordinates.join(','))}`} target="_blank" rel="noopener noreferrer">Ver punto indicado por el vendedor</a>}</aside>}<div className="weekly-task-form"><div className="week-task-top"><label><RequiredLabel>Hora</RequiredLabel><BufferedInput disabled={!canEditTask(task, day) || (Boolean(historyRecordForTask(task, day, operationalHistory)) && !can('planning.reschedule'))} aria-required="true" type="time" min={hours.min} max={hours.max} value={task.time} onCommit={value => updateTaskDraft({ time: value })} /></label><ServiceTypesField task={task} services={task.sourceTicketId ? services.filter(service => !isTrainingService(service)) : services} disabled={task.vehicleControl || !canEditTask(task, day)} onChange={patch => updateTaskDraft(patch)} /></div>{task.vehicleControl ? <label className="vehicle-control-fixed-duration"><span><RequiredLabel>Tiempo estimado</RequiredLabel></span><input value="15 minutos" readOnly /></label> : <ServiceEstimatedDurationField disabled={!canEditTask(task, day)} value={serviceEstimateForTask(task, serviceForWeeklyTask(task))} onChange={estimatedMinutes => updateTaskDraft({ estimatedMinutes, estimatedMinutesCustomized: true })} />}{task.time && <small className="task-occupied-range">Franja estimada: {taskOccupiedTimeLabel(taskWithServiceEstimate(task, serviceForWeeklyTask(task)), hoursForDay(day, taskEditor?.teamId))}</small>}{taskConflict && <p className="task-schedule-alert" role="alert"><Icon name="alert" size={16} /><span>{scheduleConflictForTaskMessage(taskConflict, taskIndex)}</span></p>}{task.vehicleControl ? <div className="vehicle-control-planning-fields"><label>Vehículo<input value={task.client || vehicleLabel(task)} readOnly /></label><label><RequiredLabel>Técnico a cargo</RequiredLabel><select disabled={!can('weekly.monthlyVehicles.assign')} value={task.technicianIds?.[0] || ''} onChange={event => { const technician = activeTechs.find(item => String(item.id) === event.target.value); updateTaskDraft({ technicianIds: technician ? [technician.id] : [], technicians: technician ? [technician.name] : [] }) }}><option value="">Seleccionar técnico</option>{activeTechs.map(technician => <option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label><p>Podés reemplazar al responsable para este control ante una contingencia. La asignación mensual predeterminada no se modifica.</p></div> : <>{serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && <fieldset disabled={!canEditTask(task, day)} className="installation-zone weekly-installation-zone"><legend><RequiredLabel>Ubicación de la instalación</RequiredLabel></legend>{INSTALLATION_ZONES.map(([value, label]) => <label key={value}><input aria-required="true" type="radio" name={`weekly-zone-${day}-${teamIndex}-${taskIndex}`} checked={task.installationZone === value} onChange={() => { const nextTask = { ...task, installationZone: value }; updateTaskDraft({ installationZone: value, ...applicableServiceExtras(nextTask, serviceForWeeklyTask(task)) }) }} />{label}</label>)}</fieldset>}
{isTrainingService(serviceForWeeklyTask(task)) ? <label className="weekly-customer-search"><RequiredLabel>Nombre de la capacitación</RequiredLabel><BufferedInput disabled={!canEditTask(task, day)} aria-required="true" placeholder="CAPACITACIÓN CERCO ELÉCTRICO" value={task.client} onCommit={value => updateTaskDraft(trainingClientPatch(value), 'planning.training')} /></label> : task.sourceTicketId ? <label className="weekly-customer-search">Abonado o cliente del ticket<input value={task.client} readOnly /></label> : <CustomerAutocomplete awaitingConfirmation={task.awaitingConfirmation === true} className="weekly-customer-search" value={task.client} customerId={task.customerId} customers={customers} subscriberReservation={task.subscriberReservation} onTextCommit={commitDraftCustomerText} onCustomerSelect={selectDraftCustomer} onAddCustomer={beginDraftNewCustomer} onReserveSubscriber={serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' ? beginDraftSubscriberReservation : undefined} />}
<label><RequiredLabel>{addressChange.isAddressChange(task) ? 'Domicilio actual' : 'Dirección'}</RequiredLabel><BufferedInput aria-required="true" readOnly={!canEditTask(task, day) || (!task.newCustomer && !task.subscriberReservation && !isTrainingService(serviceForWeeklyTask(task)))} title={task.newCustomer || task.subscriberReservation || isTrainingService(serviceForWeeklyTask(task)) ? '' : 'Este dato se modifica desde Abonados y clientes'} value={task.address} onCommit={value => updateTaskDraft({ address: value }, isTrainingService(serviceForWeeklyTask(task)) ? 'planning.training' : undefined)} /></label><AddressChangeFields record={task} disabled={!canEditTask(task, day)} onChange={newAddress => updateTaskDraft({ newAddress })} /><label>{isTrainingService(serviceForWeeklyTask(task)) ? 'Contacto (opcional)' : <RequiredLabel>Contacto</RequiredLabel>}<BufferedInput aria-required={!isTrainingService(serviceForWeeklyTask(task))} readOnly={!canEditTask(task, day) || (!task.newCustomer && !task.subscriberReservation && !isTrainingService(serviceForWeeklyTask(task)))} title={task.newCustomer || task.subscriberReservation || isTrainingService(serviceForWeeklyTask(task)) ? '' : 'Este dato se modifica desde Abonados y clientes'} value={task.phone} onCommit={value => updateTaskDraft({ phone: value }, isTrainingService(serviceForWeeklyTask(task)) ? 'planning.training' : undefined)} /></label><p className="weekly-customer-data-note">{isTrainingService(serviceForWeeklyTask(task)) ? 'Ingresá el nombre y la dirección de la capacitación. El contacto es opcional y no se creará un CLI.' : task.subscriberReservation ? 'Estos datos son provisorios y no crean un CLI. Vinculá el PIG importado cuando esté disponible.' : task.newCustomer ? 'Completá dirección y contacto para crear el cliente CLI al guardar.' : 'Dirección y contacto se administran desde el módulo Abonados y clientes.'}</p><label><RequiredLabel>Detalle</RequiredLabel><BufferedTextarea readOnly={!canEditTask(task, day)} aria-required="true" value={task.detail} onCommit={value => updateTaskDraft({ detail: value })} /></label>{can('records.contact') && <ServiceCustomerMap record={task} customers={customers} />}<AgendaTechnicalNote record={historyRecordForTask(task, day, operationalHistory) || taskEditor.baseRecord} /><ServiceExtraFields className="weekly-extra-fields" task={task} service={serviceForWeeklyTask(task)} buffered onChange={updateTaskDraft} /><ServicePhotoField record={task} photoData={taskEditor.photoData} onPreparing={photoPreparing => setTaskEditor(previous => previous ? { ...previous, photoPreparing } : previous)} removed={taskEditor.photoRemoved} disabled={taskEditorSaving} onChange={({ photoData, removed }) => setTaskEditor(previous => ({ ...previous, photoData, photoRemoved: removed }))} /></>}</div>{taskEditorError && <p className="field-error" role="alert">{taskEditorError}</p>}<div className="modal-actions"><button title="Cerrá la edición del servicio; si hay cambios sin guardar, podrás guardarlos o descartarlos." className="secondary" disabled={taskEditorSaving} onClick={() => { if (!taskEditorSaving) requestWeeklyLeave(() => setTaskEditor(null)) }}><Icon name="close" size={16} />Cancelar</button><button title="Validá y guardá los datos de este servicio para compartirlos con los demás usuarios." className="primary" disabled={taskEditorSaving || !canSaveTask(task, day)} onClick={saveTaskEditor} aria-disabled={taskEditor.photoPreparing}><Icon name="check" size={16} />{taskEditorSaving ? 'Guardando…' : 'Guardar servicio'}</button></div></section></div>{leaveRequest && <div className="modal-layer" style={{ zIndex: 10000 }}><section className="modal unsaved-service-modal" role="alertdialog" aria-modal="true" aria-label="Servicio sin guardar"><h2>Servicio sin guardar</h2><p>El servicio que estabas cargando tiene cambios sin guardar. Podés guardar y continuar, seguir editando o cancelar la carga de esta edición. Cancelar la carga no elimina un servicio ya guardado.</p><div className="modal-actions"><button title="Volvé al formulario para seguir editando sin descartar los cambios." type="button" className="secondary" onClick={() => setLeaveRequest(null)}><Icon name="edit" size={16} />Seguir editando</button><button type="button" className="danger-button" onClick={discardAndLeave} title="Descartá los cambios sin guardar de esta edición y continuá; no elimina un servicio ya guardado."><Icon name="close" size={16} />Cancelar carga</button><button type="button" className="primary" onClick={saveAndLeave} title="Guardá los cambios del servicio antes de continuar con la acción solicitada."><Icon name="check" size={16} />Guardar y continuar</button></div></section></div>}</>
    })()}

    <WeatherCredit />
    <div className="weekly-board" ref={weeklyBoardRef}>
      {days.map(day => {
        const storedPlan = dayPlan(day)
        const advancedGuard = advancedGuardForDay(day)
        const holidayState = holidayStateForDay(day)
        const calendarUnavailable = holidayCalendar.loading || Boolean(holidayCalendar.error)
        const plan = calendarUnavailable || holidayState.blocked ? { ...storedPlan, teams: [] } : suppressAdvancedSaturdayAvailability(storedPlan, advancedGuard)
        const hours = hoursForDay(day)
        const conflicts = conflictsForDay(day)
        const gapConflicts = gapConflictsForDay(day)
        const finishedDay = dayHasFinished(day)
        return <section className={`week-day ${!hours || holidayState.decision?.status === 'closed' ? 'closed-day' : ''} ${finishedDay ? 'finished-day' : ''}`} data-day={day} key={day}>
          <header className={`weekly-weather-header weather-${day >= today ? weather.days.find(item => item.date === day)?.kind || "none" : "none"}`}><WeatherArt kind={day >= today ? weather.days.find(item => item.date === day)?.kind || "none" : "none"} /><div><b>{displayDate(day)}{day === today && <span className="weekly-today">Hoy</span>}</b><WeeklyWeather day={day} today={today} weather={weather} />{finishedDay && <small>Solo lectura</small>}</div>{can('planning.copy') && <button type="button" className="weekly-day-preview-trigger" aria-label={`Vista previa de ${prettyDate(day)}`} title="Ver vista previa de la agenda del día" onClick={() => setDayPreview({ day, text: dayAgendaPreview(day, dayPlan(day).teams.map(team => ({ ...team, tasks: team.tasks.map(task => serviceCopyRecord({ ...task, ...historyRecordForTask(task, day, operationalHistory) }, can)) })), services, operationalHistory) })} />}</header>
          {!hours ? <p className="closed-day-note">Domingo · sin programación</p> : <>
            {calendarUnavailable ? <div className={`weekly-calendar-state ${holidayCalendar.error ? 'error' : ''}`}>{holidayCalendar.error ? 'No se pudo verificar el calendario de feriados.' : 'Verificando feriados nacionales…'}</div> : holidayState.holiday && <HolidayDecisionPanel compact holiday={holidayState.holiday} decision={holidayState.decision} canDecide={granular ? can('weekly.holidays') : authUser?.roleCode === 'administrator'} onDecision={status => recordHolidayDecision(setWeekly, setNotice, day, holidayState.holiday, status, { weekly, history: operationalHistory, setHistory, holidays: holidayCalendar.records })} />}
            {!holidayState.blocked && advancedGuard && <p className={`weekly-guard-advanced ${advancedGuard.hasSaturdayConflict ? 'has-conflict' : ''}`}><Icon name={advancedGuard.hasSaturdayConflict ? 'alert' : 'check'} size={16} /><span>{advancedSaturdayGuardMessage(advancedGuard)}</span></p>}
            {conflicts.length > 0 && <p className="weekly-conflict">Conflicto: {conflicts.map(item => `${item.name} ${item.time}`).join(', ')}</p>}
            {gapConflicts.length > 0 && <p className="weekly-conflict">{planningConflictMessage(day, plan.teams[gapConflicts[0].teamIndex], gapConflicts[0].teamIndex, gapConflicts[0])}</p>}
            <fieldset className="week-teams weekly-day-fields" disabled={finishedDay || readOnly}>{plan.teams.map((team, teamIndex) => {
              const memberSelection = memberSelections[weeklyTeamInteractionKey(day, team.teamId, teamIndex)]
              if (memberSelection) team = { ...team, memberIds: memberSelection.memberIds, members: memberSelection.members }
              const pickerKey = `${day}-${teamIndex}`
              const teamHours = hoursForDay(day, team.teamId)
              const gaps = gapsForTeam(day, team, teamIndex, teamHours)
              return <article className="week-team" key={team.teamId || teamIndex}>
                <div className="week-team-header"><div className="week-team-identity"><strong>{team.label || `Equipo ${teamIndex + 1}`}</strong><span title={team.members?.join(' · ') || 'Sin técnicos'}>{team.members?.length ? team.members.map(weeklyTechnicianName).join(' · ') : 'Sin técnicos'}</span></div>{!readOnly && <div className="weekly-team-actions">{can('planning.teams.delete') && plan.teams.length > 1 && <button className="weekly-remove-team" disabled={Boolean(memberSelection)} title="Solicitá quitar este equipo y su asignación del día; revisá los servicios asociados antes de confirmar." aria-label={`Quitar ${team.label || `Equipo ${teamIndex + 1}`}`} onClick={() => setTeamRemoval({ day, teamIndex, label: team.label || `Equipo ${teamIndex + 1}` })}><Icon name="trash" size={15} /></button>}{can('planning.technicians') && <div className="weekly-technicians-picker"><button className="secondary small weekly-add-tech-button" title="Elegí los técnicos que integrarán este equipo en la fecha seleccionada." aria-label="Agregar técnicos" onClick={() => { setTechPicker(techPicker === pickerKey ? null : pickerKey); setTechFilter('') }}><Icon name="users" size={16} /><span aria-hidden="true">+</span></button>{techPicker === pickerKey && <div className="tech-popover weekly-tech-popover" aria-busy={Boolean(memberSelection)}><div className="weekly-tech-popover-title"><div><strong>Asignar técnicos</strong><small>{team.label || `Equipo ${teamIndex + 1}`}</small></div><span>{team.members?.length || 0} seleccionados</span></div><input autoFocus placeholder="Buscar técnico..." value={techFilter} onChange={event => setTechFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(techFilter.toLowerCase())).map(tech => <label key={tech.id} title={tech.name}><input type="checkbox" checked={(team.memberIds || []).some(id => String(id) === String(tech.id))} onChange={() => toggleWeeklyTech(day, teamIndex, tech.name)} />{tech.firstName || tech.name.split(' ')[0]}</label>)}{!activeTechs.length && <p>No hay técnicos activos.</p>}</div>{memberSelection && <p role="status" aria-live="polite">Guardando selección…</p>}</div>}</div>}</div>}</div>
                {team.tasks.map((task, taskIndex) => <React.Fragment key={task.taskId || taskIndex}>{gaps.filter(gap => gap.beforeIndex === taskIndex).map(gap => gap.kind === 'lunch' ? <LunchCard key="lunch" hours={gap.hours} /> : <div className="weekly-time-gap" key={gap.start}><strong>Disponibilidad horaria desde las {gap.start} hs hasta las {gap.end} hs</strong>{!readOnly && can('planning.create') && !advancedGuard && <button title="Creá un servicio en esta franja horaria disponible del equipo." type="button" className="secondary" onClick={() => addTask(day, teamIndex, gap.start)}><Icon name="plus" size={16} />Agregar servicio</button>}</div>)}<div className={`week-task week-task-summary ${!task.client ? 'available-slot' : ''}`} data-weekly-search={task.client || ''} data-weekly-search-key={`${day}/${teamIndex}/${taskIndex}`} role="button" tabIndex={0} onClick={() => openTaskEditor(day, teamIndex, taskIndex)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTaskEditor(day, teamIndex, taskIndex) } }}>
                  <div className="week-task-title"><span className="week-task-heading"><ServicePreparationButton record={historyRecordForTask(task, day, operationalHistory) || task} disabled={readOnly} persist={persistWeeklyService} onNotice={setNotice} confirmedRevision={confirmedRevision} /><span>Servicio {taskIndex + 1}</span><TaskStatusBadge task={task} date={day} history={operationalHistory} statusOnly /></span><small className="week-task-hour">{task.time || '--:--'} Hs</small></div><strong className="week-task-client">{task.client || 'Disponible'}</strong>{serviceLocality(task) && <span className="week-task-locality">{serviceLocality(task)}</span>}{task.awaitingConfirmation === true && <span className="service-confirmation-label">(A CONFIRMAR)</span>}
                  <TaskStatusBadge task={task} date={day} history={operationalHistory} weekly />
                  {journeyLabel(historyRecordForTask(task, day, operationalHistory), operationalHistory) && <small className="journey-label">{journeyLabel(historyRecordForTask(task, day, operationalHistory), operationalHistory)}</small>}
                  {!task.vehicleControl && <ServicePhoto record={historyRecordForTask(task, day, operationalHistory) || task} className="weekly-service-photo" />}
                  {task.vehicleControl ? <div className="vehicle-control-summary"><span><b>Duración:</b> 15 minutos · {taskOccupiedInterval(task)?.startTime}–{taskOccupiedInterval(task)?.serviceEndTime}</span><span><b>Técnico responsable:</b> {task.technicians?.[0] || 'Sin asignar'}</span><small>Abrí la tarjeta para cambiar excepcionalmente el técnico de este control.</small></div> : <>
                  <div className="week-task-top"><label><RequiredLabel>Hora</RequiredLabel><input disabled={!canEditTask(task, day) || (Boolean(historyRecordForTask(task, day, operationalHistory)) && !can('planning.reschedule'))} aria-required="true" type="time" min={hours.min} max={hours.max} value={task.time} onChange={event => updateTask(day, teamIndex, taskIndex, { time: event.target.value })} /></label><ServiceTypesField task={task} services={services} onChange={patch => updateTask(day, teamIndex, taskIndex, patch)} /></div>
                  <ServiceEstimatedDurationField disabled={!canEditTask(task, day)} value={serviceEstimateForTask(task, serviceForWeeklyTask(task))} onChange={estimatedMinutes => updateTask(day, teamIndex, taskIndex, { estimatedMinutes, estimatedMinutesCustomized: true })} />
                  {task.time && <small className="task-occupied-range">Franja estimada: {taskOccupiedTimeLabel(taskWithServiceEstimate(task, serviceForWeeklyTask(task)), teamHours)}</small>}
                  {(() => { const conflict = conflictForWeeklyTask(day, teamIndex, taskIndex); return conflict && <p className="task-schedule-alert" role="alert"><Icon name="alert" size={15} /><span>{scheduleConflictForTaskMessage(conflict, taskIndex)}</span></p> })()}
                  <CustomerAutocomplete value={task.client} customerId={task.customerId} customers={customers} subscriberReservation={task.subscriberReservation} onTextCommit={value => commitWeeklyCustomerText(day, teamIndex, taskIndex, value)} onCustomerSelect={customer => selectWeeklyCustomerResult(day, teamIndex, taskIndex, customer)} onAddCustomer={value => beginWeeklyNewCustomer(day, teamIndex, taskIndex, value)} onReserveSubscriber={serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' ? value => beginWeeklySubscriberReservation(day, teamIndex, taskIndex, value) : undefined} />
                  <label><RequiredLabel>{addressChange.isAddressChange(task) ? 'Domicilio actual' : 'Dirección'}</RequiredLabel><input aria-required="true" value={task.address} onChange={event => updateTask(day, teamIndex, taskIndex, { address: event.target.value })} /></label><AddressChangeFields record={task} disabled={!canEditTask(task, day)} onChange={newAddress => updateTask(day, teamIndex, taskIndex, { newAddress })} />
                  <label><RequiredLabel>Contacto</RequiredLabel><input aria-required="true" value={task.phone} onChange={event => updateTask(day, teamIndex, taskIndex, { phone: event.target.value })} /></label>
                  {serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && <fieldset disabled={!canEditTask(task, day)} className="installation-zone weekly-installation-zone"><legend><RequiredLabel>Ubicación de la instalación</RequiredLabel></legend>{INSTALLATION_ZONES.map(([value, label]) => <label key={value}><input aria-required="true" type="radio" name={`weekly-card-zone-${day}-${teamIndex}-${taskIndex}`} checked={task.installationZone === value} onChange={() => { const nextTask = { ...task, installationZone: value }; updateTask(day, teamIndex, taskIndex, { installationZone: value, ...applicableServiceExtras(nextTask, serviceForWeeklyTask(task)) }) }} />{label}</label>)}</fieldset>}
                  <label><RequiredLabel>Detalle</RequiredLabel><BufferedTextarea readOnly={!canEditTask(task, day)} aria-required="true" value={task.detail} onCommit={value => updateTask(day, teamIndex, taskIndex, { detail: value })} /></label>
                  <ServiceExtraFields className="weekly-extra-fields" task={task} service={serviceForWeeklyTask(task)} buffered onChange={patch => updateTask(day, teamIndex, taskIndex, patch)} />
                  </>}
                </div></React.Fragment>)}
                {gaps.filter(gap => gap.beforeIndex === team.tasks.length).map(gap => gap.kind === 'lunch' ? <LunchCard key="lunch" hours={gap.hours} /> : <div className="weekly-time-gap" key={gap.start}><strong>Disponibilidad horaria desde las {gap.start} hs hasta las {gap.end} hs</strong>{!readOnly && can('planning.create') && !advancedGuard && <button title="Creá un servicio en esta franja horaria disponible del equipo." type="button" className="secondary" onClick={() => addTask(day, teamIndex, gap.start)}><Icon name="plus" size={16} />Agregar servicio</button>}</div>)}
              </article>
            })}</fieldset>
            {!readOnly && can('planning.teams.create') && !isSaturday(day) && <button title="Agregá otro equipo a la agenda para asignarle técnicos y servicios." className="weekly-add-team" onClick={() => addTeam(day)}><Icon name="plus" size={16} />Agregar otro equipo</button>}
          </>}
        </section>
      })}
    </div>
  </>
}
