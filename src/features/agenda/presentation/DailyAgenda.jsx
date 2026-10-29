import addressChange from '../../../../api/_lib/address-change.cjs'
import AddressChangeFields from '../../../components/AddressChangeFields.jsx'
import { canWriteRecord } from '../../../domain/access/record-scope.mjs'
import { ticketLinkFields, ticketReferenceDetail } from '../application/ticket-service-draft.mjs'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { isGranular } from '../../../domain/access/permissions.mjs'
import { permittedPlanningPatch, canEditPlanningFields, canSavePlanningFields, serviceCopyRecord } from '../application/planning-permissions.mjs'
import { sortServicesAlphabetically } from "../../../domain/services/service-order.mjs";
import React, { useEffect, useState, useRef, useMemo } from "react";
import { appendTraceElement } from "../../../presentation/service-trace-dom.mjs";
import { prettyDate, currentLocalDate } from "../../../presentation/formatting.mjs";
import { blankTask, applyRemovedWeeklyTeams, applyRemovedWeeklySlots, applyRemovedWeeklyTasks, historyRecordForTask, sortTasksByTime, taskHasContent, taskStatus, isSunday, advancedGuardForSaturdayDate, isSaturday, assignGuardToEmptySaturday, normalizeSaturdayTeams, dailyPlanWithMonthlyTeams, defaultServiceTasksForDate, renumberVisibleWeeklyTeams, removeUnavailableDefaultSlots, defaultServiceTimesForDate, alignDefaultServiceTimes, fallbackDefaultServiceTimesForDate, serviceTrace, taskIsResolvedForPlanning, taskForScheduleOccupancy, serviceTimeInMinutes, nextLiveScheduleMinute, planningConflictMessage, technicianTimeConflicts, stampServiceRecord, mergeStoredTeamsWithDefaults, taskMoveScheduleState, scheduleConflictMessage, recordHolidayDecision, taskOccupiedTimeLabel, scheduleConflictForTaskMessage } from "../application/agenda-model.mjs";
import ModuleIntroduction from "../../../components/ModuleIntroduction.jsx";
import { serviceTypesLabel } from "../../../domain/services/multi-service.mjs";
import { formatCurrencyAmount, taskWithServiceEstimate, resolveServiceForTask, normalizeInternalChecklist, applicableServiceExtras, requiresPaymentAmount, invalidFormEmail, technicianVisibleServiceExtras, serviceEstimateForTask, INSTALLATION_ZONES } from "../../services/application/service-fields.mjs";
import { ServicePhoto, ServicePhotoManager } from "../../attachments/presentation/ServicePhoto.jsx";
import { CustomerAutocomplete, BufferedInput, HolidayDecisionPanel, LunchCard, TaskStatusBadge, ServiceEstimatedDurationField, BufferedTextarea, ServiceExtraFields, ServiceConfirmationButton } from "./AgendaFields.jsx";
import { serviceScheduleConflicts, normalizeServiceEstimatedMinutes, MAX_SERVICE_ESTIMATED_MINUTES } from "../../../domain/agenda/service-scheduling.mjs";
import { useNationalHolidays } from "../application/useNationalHolidays.js";
import { holidayForDate, holidayDecisionForDate, holidayIsBlocked } from "../../../domain/agenda/holidays.mjs";
import { createTaskId, createTeamId, createCustomerId } from "../../../infrastructure/browser/identity.mjs";
import { isTrainingService, trainingClientPatch, serviceCode } from "../../../domain/services/service.mjs";
import { clearSubscriberReservationPatch, customerLinkPatch, subscriberReservationPatch } from "../application/customer-linking.mjs";
import { showAgendaValidationModal, showMissingTechniciansModal } from "./agenda-dialogs.mjs";
import { journeyLabel, ServiceJourneys } from "../../../components/ServiceJourneys.jsx";
import { agendaPreviewTasks } from "../../../domain/agenda/preview-tasks.mjs";
import { copyTextToClipboard } from "../../../infrastructure/browser/clipboard.mjs";
import { serviceHasChanges, restoreSavedService } from "../../../domain/agenda/service-changes.mjs";
import { focusPendingService } from "../../../presentation/components/forms/focus-pending-service.mjs";
import { advancedSaturdayGuardMessage } from "../../../domain/agenda/weekend-guard.mjs";
import { normalizeAccountKey, blankCustomer, nextCustomerCode } from "../../customers/application/customer-model.mjs";
import { normalizeSearchText, normalizeCustomerName } from "../../../domain/shared/normalization.mjs";
import { Confirm } from "../../../presentation/components/Confirm.jsx";
import Icon from "../../../components/ui/Icon.jsx";
import RequiredLabel from "../../../presentation/components/forms/RequiredLabel.jsx";
import { teamServiceGaps, planningHoursForDay } from "../../../domain/agenda/service-gaps.mjs";
import { withLunchNotice } from "../../../domain/agenda/lunch-placement.mjs";
import { vehicleLabel } from "../../../domain/vehicles/vehicle-controls.mjs";
import ServiceTypesField from "../../../components/ServiceTypesField.jsx";
import { Preview } from "../../../presentation/components/AgendaPreview.jsx";

export function Agenda({ navigationGuardRef, persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady, authUser }) {
  const SERVICES = sortServicesAlphabetically(services.filter(service => service.status === 'Activo')).map(service => service.name)
  useEffect(() => {
    const tasks = teams.flatMap(team => team.tasks || [])
    const rows = document.querySelectorAll('.team-card .task-row')
    rows.forEach((row, index) => {
      const task = tasks[index]
      if (!task?.vehicleControl) return
      row.classList.add('vehicle-control-task')
      const serviceSelect = row.querySelector('.daily-field-service select')
      if (serviceSelect?.options?.[0]) { serviceSelect.options[0].textContent = task.service; serviceSelect.disabled = true }
      const customerInput = row.querySelector('.customer-autocomplete input')
      if (customerInput) customerInput.readOnly = true
    })
  }, [teams])
  const [preview, setPreview] = useState(false); const [techOpen, setTechOpen] = useState(null); const [techFilter, setTechFilter] = useState('')
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const records = teams.flatMap(team => team.tasks || [])
      document.querySelectorAll('.content > .team-card .task-row').forEach((node, index) => {
        appendTraceElement(node, records[index])
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [teams, history, date])
  const agendaText = `Agenda de trabajo – ${prettyDate(date)}\n\n${teams.map((team, i) => `Equipo ${i + 1}: ${team.members.join(' / ') || 'Sin asignar'}\n${team.tasks.map(t => `${t.time || '--:--'} · ${t.service || 'Servicio'} · ${t.client || 'Cliente'}${t.detail ? `\nDetalle: ${t.detail}` : ''}${t.address ? `\nDirección: ${t.address}` : ''}${t.phone ? `\nContacto: ${t.phone}` : ''}`).join('\n\n')}`).join('\n\n')}`
  const chooseCustomer = (ti, i, value) => { const c = customers.find(x => x.account === value || x.name === value || `${x.name} · ${x.account}` === value); updateTask(ti, i, c ? { client: c.name, address: c.address, phone: c.phone } : { client: value }) }
  const toggleTech = (ti, name) => setTeams(prev => prev.map((t, i) => i !== ti ? t : { ...t, members: t.members.includes(name) ? t.members.filter(x => x !== name) : [...t.members, name] }))
  const addTask = ti => setTeams(prev => prev.map((t, i) => i === ti ? { ...t, tasks: [...t.tasks, blankTask()] } : t))
  return <AgendaLayout navigationGuardRef={navigationGuardRef} {...{ persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }} />

}

export function AgendaLayout({ navigationGuardRef, persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }) {
  return <AgendaWorkspace navigationGuardRef={navigationGuardRef} {...{ persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }} />


}

export function historicalAgendaTeams(date, weekly, history) {
  const day = weekly?.[date] || {}
  const removed = new Set((day.removedTaskIds || []).map(String))
  const result = applyRemovedWeeklyTeams(applyRemovedWeeklySlots(applyRemovedWeeklyTasks(day.teams || [], day.removedTaskIds || []), day.removedSlots || []), day.removedTeams || [])
    .map(team => ({ ...team, tasks: (team.tasks || []).map(task => ({ ...task, ...historyRecordForTask(task, date, history) })) }))
  for (const record of history.filter(item => item.date === date)) {
    if (removed.has(String(record.sourceTaskId || '')) || removed.has(`task:${record.sourceTaskId}`) || removed.has(`history:${record.id}`)) continue
    if (result.some(team => team.tasks.some(task => String(task.historyId || task.id || '') === String(record.id) || (record.sourceTaskId && task.taskId === record.sourceTaskId)))) continue
    let team = result.find(item => record.teamId ? item.teamId === record.teamId : item.label === record.team)
    if (!team) {
      team = { teamId: record.teamId, label: record.team || 'Equipo', members: record.technicians || [], tasks: [] }
      result.push(team)
    }
    team.tasks.push({ ...record, historyId: record.id, taskId: record.sourceTaskId })
  }
  return result.map(team => ({ ...team, tasks: sortTasksByTime(team.tasks) }))
}

export function HistoricalDailyAgenda({ date, setDate, weekly, history }) {
  const historicalTeams = historicalAgendaTeams(date, weekly, history)
  return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">PLANIFICACIÓN DIARIA · SOLO LECTURA</p><h1>Agenda del día</h1><p>Jornada finalizada. Podés consultar la información guardada, sin modificarla.</p></ModuleIntroduction></div>
    <div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>
    {!historicalTeams.length && <p>No hay una agenda guardada para esta fecha.</p>}
    {historicalTeams.map((team, index) => <article className="team-card" key={team.teamId || index}><div className="team-header"><strong>{team.label || `Equipo ${index + 1}`}</strong><span>{team.members?.join(' · ') || 'Sin técnicos asignados'}</span></div><div className="historical-day-services">{team.tasks.map((task, taskIndex) => {
      const pastService = { ...task, team: team.label || `Equipo ${index + 1}`, technicians: task.technicians || team.members }
      return <section className="historical-day-service" key={task.taskId || task.id || taskIndex}><h2>Servicio {taskIndex + 1} · {task.time} hs</h2>{!taskHasContent(task) ? <p>Turno sin servicio asignado</p> : <><h3>{task.client || task.service}</h3><HistoricalServiceFields pastService={pastService} /></>}</section>
    })}</div></article>)}</>
}

export function HistoricalServiceFields({ pastService }) {
  const { can } = usePermissions()
  pastService = serviceCopyRecord(pastService, can)
  return <>{[
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
    ].map(([title, fields]) => <section className="past-detail-section" key={title}><h3>{title}</h3><dl className="past-detail-fields">{fields.map(([label, value]) => <div key={label} className={['Detalle / observaciones', 'Informe técnico', 'Nota interna'].includes(label) ? 'past-field-wide' : ['Dirección', 'Técnicos asignados'].includes(label) ? 'past-field-double' : ''}><dt>{label}</dt><dd className={['Monto', 'Abono mensual'].includes(label) ? 'past-field-money' : ''}>{value === '' || value == null ? <span className="past-field-empty">Sin información</span> : String(value)}</dd></div>)}</dl></section>)}{pastService.internalChecklist?.length > 0 && <section className="past-detail-section"><h3>Checklist</h3>{pastService.internalChecklist.map((item, index) => <p key={item.id || index}>{item.completed ? '✓' : '○'} {item.text}</p>)}</section>}<ServicePhoto record={pastService} className="history-service-photo" /></>
}

export function AgendaWorkspace({ navigationGuardRef, persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }) {
  if (String(date || '') < currentLocalDate()) return <HistoricalDailyAgenda {...{ date, setDate, weekly, history }} />
  return <AgendaWorkspaceForm navigationGuardRef={navigationGuardRef} {...{ persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }} />


}

export function DailyCustomerField({ task, customers, teamIndex, taskIndex, onTextCommit, onCustomerSelect, onAddCustomer, onReserveSubscriber, required = true, disabled = false }) {
  return <CustomerAutocomplete
    disabled={disabled}
    awaitingConfirmation={task.awaitingConfirmation === true}
    className="daily-field-customer"
    value={task.client}
    customerId={task.customerId}
    subscriberReservation={task.subscriberReservation}
    required={required}
    customers={customers}
    onTextCommit={value => onTextCommit(teamIndex, taskIndex, value)}
    onCustomerSelect={customer => onCustomerSelect(teamIndex, taskIndex, customer)}
    onAddCustomer={onAddCustomer ? value => onAddCustomer(teamIndex, taskIndex, value) : undefined}
    onReserveSubscriber={onReserveSubscriber
      ? value => onReserveSubscriber(teamIndex, taskIndex, value)
      : undefined}
  />
}

export function AgendaWorkspaceForm({ navigationGuardRef, persistWeeklyService, persistAgendaRecords, date, setDate, teams, setTeams, activeTechs, customers, setCustomers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }) {
  const { can, user: permissionUser } = usePermissions()
  const canWriteTask = task => canWriteRecord({ technicianIds: teams.find(team => team.tasks.some(item => item === task || (task.taskId && item.taskId === task.taskId)))?.memberIds || [], ...task, ...historyRecordForTask(task, date, history) }, permissionUser || globalThis.__pignusCurrentUser, customers)
  const canEditTask = task => canWriteTask(task) && canEditPlanningFields(can, Boolean(historyRecordForTask(task, date, history)))
  const canSaveTask = task => canWriteTask(task) && canSavePlanningFields(can, Boolean(historyRecordForTask(task, date, history)))
  const canWritePlan = ['planning.create', 'planning.edit', 'planning.notes', 'planning.checklist', 'planning.commercial', 'planning.freeze', 'planning.confirm', 'planning.linkAccount', 'planning.reservation.link', 'planning.teams.create', 'planning.teams.delete', 'planning.technicians'].some(can)
  const requirePermission = key => { if (can(key)) return true; setNotice('No tenés permiso para realizar esta acción.'); return false }
  const applyTaskPatch = updateTask
  updateTask = (teamIndex, taskIndex, patch, action) => {
    const task = teams[teamIndex]?.tasks?.[taskIndex]
    if (!task || (historyRecordForTask(task, date, history) && !canWriteTask(task))) return
    const allowed = permittedPlanningPatch(patch, { can, existing: Boolean(historyRecordForTask(task, date, history)), task, action })
    if (Object.keys(allowed).length) applyTaskPatch(teamIndex, taskIndex, allowed)
  }
  const minimumServiceGapConflicts = teams => serviceScheduleConflicts(teams, taskHasContent, weekly)

  setCustomers = setCustomers || globalThis.__pignusSetCustomers
  const authUser = permissionUser || globalThis.__pignusCurrentUser || null
  const [taskMove, setTaskMove] = useState(null)
  const singleSaveRef = useRef(false)
  const [singleSaving, setSingleSaving] = useState(false)
  const [dailySaveError, setDailySaveError] = useState(null)
  const dailyCompleted = task => taskStatus(task, date, history) === 'Completado'
  const [dailyLeave, setDailyLeave] = useState(null)
  const [dailyResume, setDailyResume] = useState(null)
  const [dailyPlanningClock, setDailyPlanningClock] = useState(Date.now)
  const [gapTaskFocus, setGapTaskFocus] = useState(null)
  useEffect(() => {
    const timer = window.setInterval(() => setDailyPlanningClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!gapTaskFocus) return
    const row = [...document.querySelectorAll('[data-daily-task-id]')].find(node => node.dataset.dailyTaskId === gapTaskFocus)
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.querySelector('.daily-field-service select')?.focus({ preventScroll: true })
    setGapTaskFocus(null)
  }, [gapTaskFocus, teams])
  const taskMoveSavingRef = useRef(false)
  const holidayCalendar = useNationalHolidays([authUser ? String(date || '').slice(0, 4) : '', taskMove?.destinationDay?.slice(0, 4) || ''])
  const holiday = holidayForDate(holidayCalendar.records, date)
  const holidayDecision = holidayDecisionForDate(weekly, date)
  const sundayBlocked = isSunday(date)
  const holidayBlocked = holidayIsBlocked(holiday, holidayDecision)
  const holidayCalendarUnavailable = holidayCalendar.loading || Boolean(holidayCalendar.error)
  const pastDayBlocked = String(date || '') < currentLocalDate()
  const advancedGuard = useMemo(() => advancedGuardForSaturdayDate(date, weekly, teams), [date, weekly, teams])
  const saveAgenda = () => requestAgendaAction('save')
  const [preview, setPreview] = useState(false)
  const [techOpen, setTechOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [customerProposal, setCustomerProposal] = useState(null)
  const loadedAgendaDate = useRef('')
  useEffect(() => {
    if (!isSaturday(date)) return
    setTeams(previous => {
      const normalized = assignGuardToEmptySaturday(normalizeSaturdayTeams(previous, date, weekly), date, weekly, activeTechs)
      return JSON.stringify(previous) === JSON.stringify(normalized) ? previous : normalized
    })
  }, [date, setTeams, weekly?._annualGuards, activeTechs.map(tech => `${tech.id}:${tech.name}`).join('|')])
  useEffect(() => {
    const addTeamButton = document.querySelector('.content .add-team')
    if (addTeamButton) addTeamButton.hidden = isSaturday(date)
  }, [date, teams])
  useEffect(() => {
    // Ambos módulos escriben sobre el mismo día: los cambios de la agenda del día
    // se reflejan inmediatamente en la agenda semanal, conservando campos extra.
    if (pastDayBlocked || !canWritePlan) return
    if (loadedAgendaDate.current !== date) return
    if (advancedGuard || sundayBlocked || holidayBlocked || holidayCalendarUnavailable) return
    const hasContent = teams.some(team => team.members?.length || team.tasks.some(task => Object.entries(task).some(([key, value]) => !['time', 'taskId', 'historyId'].includes(key) && String(value || '').trim())))
    if (!hasContent) return
    setWeekly(previous => {
      const savedDay = previous[date] || {}
      const consumedSavedTeams = new Set()
      const nextTeams = teams.map((team, teamIndex) => {
        const savedTeams = savedDay.teams || []
        let savedTeamIndex = savedTeams.findIndex((candidate, candidateIndex) => (
          !consumedSavedTeams.has(candidateIndex) &&
          team.teamId && candidate.teamId && String(candidate.teamId) === String(team.teamId)
        ))
        if (savedTeamIndex < 0 && savedTeams[teamIndex] && !consumedSavedTeams.has(teamIndex)) savedTeamIndex = teamIndex
        if (savedTeamIndex >= 0) consumedSavedTeams.add(savedTeamIndex)
        const savedTeam = savedTeamIndex >= 0 ? savedTeams[savedTeamIndex] : {}
        const savedTasks = savedTeam.tasks || []
        return {
          ...savedTeam,
          ...team,
          label: team.label || savedTeam.label || `Equipo ${teamIndex + 1}`,
          members: team.members || [],
          memberIds: team.memberIds || savedTeam.memberIds || [],
          tasks: sortTasksByTime(team.tasks.map((task, taskIndex) => {
            const savedTask = savedTasks.find(candidate => (
              task.taskId && candidate.taskId && String(candidate.taskId) === String(task.taskId)
            )) || savedTasks.find(candidate => (
              task.historyId && candidate.historyId && String(candidate.historyId) === String(task.historyId)
            )) || ((!task.taskId && !task.historyId) ? savedTasks[taskIndex] : null)
            return savedTask ? { ...savedTask, ...task } : { ...task }
          }))
        }
      })
      const nextDay = { ...savedDay, teams: nextTeams }
      return JSON.stringify(savedDay) === JSON.stringify(nextDay) ? previous : { ...previous, [date]: nextDay }
    })
  }, [date, teams, setWeekly, pastDayBlocked, advancedGuard, sundayBlocked, holidayBlocked, holidayCalendarUnavailable])
  useEffect(() => {
    // Migra agendas creadas antes del identificador estable sin alterar sus datos.
    setTeams(previous => {
      let changed = false
      const next = previous.map(team => ({ ...team, tasks: team.tasks.map(task => {
        if (task.taskId) return task
        changed = true
        return { ...task, taskId: createTaskId() }
      }) }))
      return changed ? next : previous
    })
  }, [setTeams])
  // Reconstruye la agenda desde los registros ya guardados para la fecha elegida.
  const loadAgendaForDate = (nextDate, { announce = true } = {}) => {
    loadedAgendaDate.current = nextDate
    setDate(nextDate)
    if (String(nextDate || '') < currentLocalDate()) return
    if (isSunday(nextDate)) {
      if (announce) setNotice('Los domingos son días no operativos y no admiten servicios.')
      return
    }
    const saved = history.filter(record => record.date === nextDate && ['Pendiente', 'Reprogramado', 'Requiere revisión'].includes(record.status || 'Pendiente'))
    const weeklyDay = dailyPlanWithMonthlyTeams(nextDate, weekly)
    if (!saved.length && !weeklyDay?.teams?.length) {
      const tasks = isSaturday(nextDate) ? defaultServiceTasksForDate(nextDate, weekly).slice(0, 1) : defaultServiceTasksForDate(nextDate, weekly)
      const emptyTeams = [{ teamId: createTeamId(), memberIds: [], members: [], tasks }]
      setTeams(isSaturday(nextDate) ? assignGuardToEmptySaturday(emptyTeams, nextDate, weekly, activeTechs) : emptyTeams)
      if (announce) setNotice('No hay una agenda guardada para la fecha seleccionada. Podés crear una nueva.')
      return
    }
    const byTeam = new Map()
    const visibleWeeklyTeams = renumberVisibleWeeklyTeams(applyRemovedWeeklyTeams(applyRemovedWeeklySlots(applyRemovedWeeklyTasks(weeklyDay?.teams || [], weeklyDay?.removedTaskIds || []), weeklyDay?.removedSlots || []), weeklyDay?.removedTeams || []))
      .map(team => ({ ...team, tasks: removeUnavailableDefaultSlots((team.tasks || []).map(task => taskWithServiceEstimate(task, resolveServiceForTask(task, services)))) }))
    ;visibleWeeklyTeams.forEach((team, index) => {
      const position = Number(String(team.label || '').match(/\d+/)?.[0]) || index + 1
      const teamKey = team.teamId || `legacy-team-${position}`
      const targetTimes = defaultServiceTimesForDate(nextDate, weekly)
      const alignedTeam = alignDefaultServiceTimes([team], nextDate, targetTimes, fallbackDefaultServiceTimesForDate(nextDate))[0] || team
      byTeam.set(teamKey, {
        ...alignedTeam,
        position,
        teamId: team.teamId || createTeamId(),
        memberIds: team.memberIds || [],
        members: team.members || [],
        tasks: (alignedTeam.tasks || []).map(task => ({ ...blankTask(), ...task }))
      })
    })
    const plannedTeamKeys = new Set(byTeam.keys())
    saved.forEach(record => {
      const number = Number(String(record.team || '').match(/\d+/)?.[0]) || 1
      const teamKey = record.teamId || `legacy-team-${number}`
      const current = byTeam.get(teamKey) || { position: number, teamId: record.teamId || createTeamId(), memberIds: record.technicianIds || [], members: record.technicians || [], tasks: [] }
      current.teamId ||= record.teamId || createTeamId()
      // La dotación semanal es la asignación vigente del equipo. El historial
      // conserva la instantánea que tenía cada servicio al guardarse y sólo se
      // usa como respaldo para equipos antiguos que ya no están planificados.
      if (!plannedTeamKeys.has(teamKey)) {
        current.memberIds = record.technicianIds?.length ? record.technicianIds : current.memberIds
        current.members = record.technicians?.length ? record.technicians : current.members
      }
      // Se aceptan los nombres anteriores del campo para recuperar también agendas ya existentes.
      const recoveredTask = taskWithServiceEstimate({ awaitingConfirmation: record.awaitingConfirmation === true, vehicleControl: Boolean(record.vehicleControl), taskId: record.sourceTaskId || record.id || createTaskId(), historyId: record.id, time: record.time || record.scheduledTime || record.hora || record.Hora || '', serviceTypes: record.serviceTypes, serviceCharges: record.serviceCharges, serviceId: record.serviceId || '', service: record.service || '', estimatedMinutes: record.estimatedMinutes, estimatedMinutesCustomized: record.estimatedMinutesCustomized, customerId: record.customerId || '', client: record.client || '', clientAccount: record.clientAccount || record.account || '', clientNameAtService: record.clientNameAtService || '', address: record.address || '', newAddress: record.newAddress || '', phone: record.phone || '', detail: record.detail || '', internalNote: record.internalNote || '', internalChecklist: normalizeInternalChecklist(record.internalChecklist), paymentMethod: record.paymentMethod || '', amount: record.amount || '', monthlyFee: record.monthlyFee || '', freezeMonthlyFee: record.freezeMonthlyFee ?? null, frozenMonths: Number(record.frozenMonths || 0), form: record.form || '', formEmail: record.formEmail || '', installationZone: record.installationZone || '', ...serviceTrace(record) }, resolveServiceForTask(record, services))
      const sameTask = task => (record.id && String(task.historyId || '') === String(record.id)) || (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
      if (current.tasks.some(sameTask)) current.tasks = current.tasks.map(task => sameTask(task) ? { ...task, ...recoveredTask } : task)
      else current.tasks.push(recoveredTask)
      byTeam.set(teamKey, current)
    })
    const recoveredTeams = [...byTeam.values()].sort((a, b) => a.position - b.position).map(({ position, ...team }) => ({ ...team, tasks: sortTasksByTime(removeUnavailableDefaultSlots(team.tasks).filter(task => taskHasContent(task) || task.manualSlot)) }))
    const targetTimes = defaultServiceTimesForDate(nextDate, weekly)
    setTeams(isSaturday(nextDate) ? assignGuardToEmptySaturday(normalizeSaturdayTeams(recoveredTeams, nextDate, weekly), nextDate, weekly, activeTechs) : alignDefaultServiceTimes(recoveredTeams, nextDate, targetTimes, fallbackDefaultServiceTimesForDate(nextDate)))
    const reprogrammedCount = saved.filter(record => record.rescheduledFrom).length
    if (announce && reprogrammedCount) {
      setNotice(`Se cargó la agenda del ${prettyDate(nextDate)} con ${reprogrammedCount} servicio(s) reprogramado(s).`)
    }
  }
  useEffect(() => {
    // La fecha ya aparece seleccionada al entrar al módulo; por eso no se
    // dispara el evento nativo del selector. Recuperamos una sola vez su agenda
    // cuando la base de datos terminó de cargar, sin pisar ediciones posteriores.
    if (!databaseReady || loadedAgendaDate.current === date) return
    loadAgendaForDate(date, { announce: false })
  }, [databaseReady, date, history, weekly])
  useEffect(() => {
    const input = document.querySelector('.agenda-toolbar input[type="date"]')
    if (!input) return undefined
    const selectDate = event => loadAgendaForDate(event.target.value)
    input.addEventListener('change', selectDate, true)
    return () => input.removeEventListener('change', selectDate, true)
  }, [history, weekly])
  useEffect(() => {
    // Evita copiar al portapapeles o guardar antes de validar la asignación de técnicos.
    const copyButton = document.querySelector('.module-intro .action-group .primary')
    if (!copyButton) return undefined
    const intercept = event => { event.preventDefault(); event.stopPropagation(); copyAgenda() }
    copyButton.addEventListener('click', intercept, true)
    return () => copyButton.removeEventListener('click', intercept, true)
  }, [date, teams, history, activeTechs])
  const activeServices = sortServicesAlphabetically(services.filter(service => service.status === 'Activo'))
  const serviceForTask = task => resolveServiceForTask(task, services)
  const selectTaskService = (teamIndex, taskIndex, selectedId) => {
    const selected = services.find(service => String(service.id) === String(selectedId))
    const currentTask = teams[teamIndex]?.tasks[taskIndex]
    const nextTask = selected
      ? { ...currentTask, ...(isTrainingService(selected) ? trainingClientPatch(currentTask.client || '') : {}), serviceId: selected.id, service: selected.name, estimatedMinutes: normalizeServiceEstimatedMinutes(selected.estimatedMinutes), estimatedMinutesCustomized: false, installationZone: serviceCode(selected) === 'alarm-installation' ? currentTask?.installationZone || '' : '' }
      : { ...currentTask, serviceId: '', service: '', estimatedMinutes: undefined, estimatedMinutesCustomized: false, installationZone: '' }
    updateTask(teamIndex, taskIndex, { ...nextTask, ...clearSubscriberReservationPatch(selected && serviceCode(selected) === 'alarm-installation' ? null : currentTask), ...applicableServiceExtras(nextTask, selected) })
  }
  const conflictForDailyTask = (teamIndex, taskIndex) => {
    const team = teams[teamIndex]
    if (!team) return null
    const target = team.tasks?.[taskIndex]
    if (!target || taskIsResolvedForPlanning(target, date, history)) return null
    const activeTasks = (team.tasks || []).map((task, index) => {
      const occupancyTask = taskForScheduleOccupancy(task, date, history)
      return occupancyTask ? { ...taskWithServiceEstimate(occupancyTask, serviceForTask(task)), _scheduleTaskIndex: index } : null
    }).filter(Boolean)
    return minimumServiceGapConflicts([{ ...team, tasks: activeTasks }])
      .find(conflict => conflict.firstTask._scheduleTaskIndex === taskIndex || conflict.secondTask._scheduleTaskIndex === taskIndex) || null
  }
  const agendaTeamsWithRealServices = (agendaTeams = teams) => agendaTeams.map(team => ({
    ...team,
    tasks: (team.tasks || []).filter(task => taskHasContent(task) && !taskIsResolvedForPlanning(task, date, history))
  }))
  const hasPendingAgendaServices = teams.some(team => (team.tasks || []).some(task => taskHasContent(task) && !taskIsResolvedForPlanning(task, date, history)))
  const hasResolvedAgendaServices = teams.some(team => (team.tasks || []).some(task => taskHasContent(task) && taskIsResolvedForPlanning(task, date, history)))
  const showSaveAgenda = hasPendingAgendaServices || !hasResolvedAgendaServices
  const validateAgenda = (agendaTeams = teams, onlyTaskId = null) => {
    const missing = []
    agendaTeams.forEach((team, teamIndex) => team.tasks.forEach((task, taskIndex) => {
      if (task.vehicleControl || !taskHasContent(task) || taskIsResolvedForPlanning(task, date, history)) return
      if (onlyTaskId && task.taskId !== onlyTaskId) return
      const existingService = Boolean(historyRecordForTask(task, date, history))
      if (existingService && !canEditTask(task)) return
      const fields = []
      if (!task.time) fields.push('hora')
      if (!task.service) fields.push('tipo de servicio')
      if (!task.customerId && !task.subscriberReservation && !(isTrainingService(serviceForTask(task)) && String(task.client || '').trim())) fields.push('abonado o cliente registrado, o reserva PIG')
      if (task.subscriberReservation && serviceCode(serviceForTask(task)) !== 'alarm-installation') fields.push('una cuenta CLI o PIG registrada; Reserva PIG sólo corresponde a Instalación de alarma')
      if ((!existingService || can('records.contact')) && !task.address) fields.push('dirección')
      if ((!existingService || can('records.contact')) && !task.phone && !isTrainingService(serviceForTask(task))) fields.push('contacto')
      if (serviceCode(serviceForTask(task)) === 'alarm-installation' && !task.installationZone) fields.push('ubicación de la instalación')
      if ((!existingService || can('planning.commercial')) && requiresPaymentAmount(task, serviceForTask(task))) fields.push('monto')
      if ((!existingService || can('planning.commercial')) && invalidFormEmail(task, serviceForTask(task))) fields.push('email del formulario válido')
      if (fields.length) missing.push(`Equipo ${teamIndex + 1}, servicio ${taskIndex + 1}: ${fields.join(', ')}`)
      const taskStart = serviceTimeInMinutes(task.time)
      if (date === currentLocalDate() && !historyRecordForTask(task, date, history) && taskStart !== null && taskStart < nextLiveScheduleMinute()) missing.push(`Equipo ${teamIndex + 1}, servicio ${taskIndex + 1}: elegí un horario futuro desde el próximo cuarto de hora disponible.`)
    }))
    const occupancyTeams = agendaTeams.map(team => ({
      ...team,
      tasks: (team.tasks || []).map(task => {
        const occupancyTask = taskForScheduleOccupancy(task, date, history)
        return occupancyTask ? taskWithServiceEstimate(occupancyTask, serviceForTask(task)) : null
      }).filter(Boolean)
    }))
    minimumServiceGapConflicts(occupancyTeams).forEach(conflict => missing.push(planningConflictMessage(date, occupancyTeams[conflict.teamIndex], conflict.teamIndex, conflict)))
    if (!missing.length) return true
    showAgendaValidationModal(missing)
    return false
  }
  const clearAgenda = async () => { if (!requirePermission('agenda.clear')) return; if (isGranular(authUser) && ((teams.some(team => team.tasks.some(taskHasContent)) && !can('planning.remove')) || (teams.length > 1 && !can('planning.teams.delete')))) { setNotice('Para vaciar esta agenda también necesitás permiso para quitar sus servicios y equipos.'); return } if (confirmation !== 'clear') { if (!await registerHistory()) return; setNotice('La agenda fue copiada al portapapeles y registrada en el historial.'); return }; const today = currentLocalDate(); setTeams([{ teamId: createTeamId(), memberIds: [], members: [], tasks: isSaturday(today) ? defaultServiceTasksForDate(today, weekly).slice(0, 1) : defaultServiceTasksForDate(today, weekly) }]); setDate(today); setNotice('La agenda quedó limpia y lista para una nueva planificación.') }
  const copyAgenda = async () => {
    if (!requirePermission('planning.copy')) return
    const copied = await copyTextToClipboard(message)
    setNotice(copied ? 'La agenda fue copiada al portapapeles.' : 'No se pudo acceder al portapapeles.')
  }
  const previewValue = value => String(value || '').trim() || 'Sin información'
  const previewDetails = task => {
    const service = serviceForTask(task)
    const extras = applicableServiceExtras(task, service)
    const technicianExtras = technicianVisibleServiceExtras(extras)
    const lines = [
      `Observación: ${previewValue(task.detail)}`,
      technicianExtras.paymentMethod && `Forma de pago: ${technicianExtras.paymentMethod}`,
      technicianExtras.paymentMethod && `Monto: ${previewValue(formatCurrencyAmount(technicianExtras.amount))}`,
      technicianExtras.form && `Formulario: ${technicianExtras.form}`
    ].filter(Boolean)
    return `\n📝 *Detalle:*\n${lines.join('\n')}`
  }
  const taskMessage = input => { const task = serviceCopyRecord(input, can); return `${journeyLabel(task, history) ? journeyLabel(task, history) + '\n' : ''}🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${task.awaitingConfirmation === true ? '\n🟡 *(A CONFIRMAR)*' : ''}${task.subscriberReservation ? '\n🟡 *Reserva de nuevo abonado · PIG pendiente*' : ''}${previewDetails(task)}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}` }
  const teamMessage = (team, index) => `👥 *Equipo ${index + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.filter(taskHasContent).map(taskMessage).join('\n\n')}`
  const individualTaskMessage = (task, team, teamIndex) => `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n👥 *Equipo ${teamIndex + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${taskMessage(task)}`
  const messageSections = teams.flatMap((team, index) => {
    const tasks = agendaPreviewTasks(team.tasks.filter(taskHasContent))
    return tasks.length ? [teamMessage({ ...team, tasks }, index)] : []
  })
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${messageSections.join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  const copySingleTask = async (task, team, teamIndex, taskIndex) => {
    if (!requirePermission('planning.copy')) return
    const copied = await copyTextToClipboard(individualTaskMessage(task, team, teamIndex))
    setNotice(copied
      ? `El servicio ${taskIndex + 1} del Equipo ${teamIndex + 1} fue copiado al portapapeles.`
      : 'No se pudo acceder al portapapeles. Revisá los permisos del navegador e intentá nuevamente.')
  }
  const registerHistory = async (agendaTeams = teams, onlyTaskId = null) => {
    const changed = agendaTeams.flatMap(team => team.tasks).filter(task => (!onlyTaskId || task.taskId === onlyTaskId) && taskHasContent(task) && !dailyCompleted(task) && (!isGranular(authUser) || dailyServiceHasChanges(task)))
    if (changed.some(task => !canSaveTask(task))) { setDailySaveError({ taskId: onlyTaskId, message: 'No tenés permiso para guardar uno de estos servicios.' }); return false }
    setDailySaveError(null)
    if (onlyTaskId && teams.some(team => team.tasks.some(task => task.taskId === onlyTaskId && dailyCompleted(task)))) {
      setDailySaveError({ taskId: onlyTaskId, message: 'Este servicio ya fue completado. Los cambios no se guardaron. Actualizá la agenda para consultar su información.' })
      return false
    }
    agendaTeams = agendaTeamsWithRealServices(agendaTeams)
    if (pastDayBlocked) {
      setNotice(`La jornada del ${prettyDate(date)} ya finalizó. Consultá o corregí sus servicios desde Historial.`)
      return false
    }
    if (sundayBlocked) {
      setNotice('Los domingos son días no operativos y no admiten servicios.')
      return false
    }
    if (holidayBlocked) {
      setNotice(holidayDecision?.status === 'closed' ? 'La fecha fue definida como día no operativo.' : 'Primero definí si el feriado será laboral o no operativo.')
      return false
    }
    if (holidayCalendarUnavailable) {
      setNotice('No se puede guardar hasta verificar el calendario de feriados nacionales.')
      return false
    }
    if (!validateAgenda(agendaTeams, onlyTaskId)) return false
    const previous = history
    try {
      // Automatic vehicle controls already have their own persisted record and assignee.
      // Saving/copying the daily agenda must not rebuild them with the team's members.
      const records = agendaTeams.flatMap((team, teamIndex) => team.tasks.filter(task => !task.vehicleControl && !dailyCompleted(task) && (!onlyTaskId || task.taskId === onlyTaskId) && (!isGranular(authUser) || changed.includes(task))).map((task, taskIndex) => ({
        // historyId se conserva al recuperar o editar una agenda ya registrada.
        // Para un servicio nuevo se usa el taskId, que permanece aunque cambien sus datos.
        id: task.historyId || `work-${task.taskId || `${date}-${teamIndex}-${taskIndex}`}`,
        sourceTaskId: task.taskId,
        ...ticketLinkFields(task, historyRecordForTask(task, date, history)),
        awaitingConfirmation: task.awaitingConfirmation === true,
        date, time: task.time, scheduledTime: task.time, estimatedMinutes: serviceEstimateForTask(task, serviceForTask(task)), estimatedMinutesCustomized: Boolean(task.estimatedMinutesCustomized), team: `Equipo ${teamIndex + 1}`,
        // El historial conserva el titular original aunque la cuenta se reasigne después.
        teamId: team.teamId, technicianIds: team.memberIds || [], technicians: team.members, serviceTypes: task.serviceTypes, serviceId: serviceForTask(task)?.id || task.serviceId, service: serviceForTask(task)?.name || task.service, client: task.client,
        customerId: task.customerId || '',
        clientAccount: task.clientAccount || '',
        clientNameAtService: task.clientNameAtService || task.client.replace(/^[^\s]+\s+/, ''), detail: ticketReferenceDetail(task.detail, ticketLinkFields(task, historyRecordForTask(task, date, history)).ticketNumber),
        internalNote: task.internalNote || '', internalChecklist: normalizeInternalChecklist(task.internalChecklist),
        ...applicableServiceExtras(task, serviceForTask(task)),
        address: task.address, newAddress: task.newAddress || '', phone: task.phone, installationZone: task.installationZone || '', servicePhotoAttached: Boolean(task.servicePhotoAttached), servicePhotoUrl: task.servicePhotoUrl || '', servicePhotoAttachedAt: task.servicePhotoAttachedAt || '', ...serviceTrace(task)
      })))
      if (!records.length) return true
      const accountKey = record => String(record.clientAccount || record.account || String(record.client || '').trim().split(' ')[0] || '').trim().toUpperCase()
      const serviceKey = record => String(record.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/nueva/g, '').replace(/\s+/g, ' ').trim()
      const timeKey = record => String(record.time || record.scheduledTime || '').trim()
      const teamKey = record => String(record.teamId || record.team || '').trim().toLowerCase()
      const replacements = records.map(record => {
        // Los trabajos actuales se vinculan exclusivamente por su identificador. El
        // fallback sólo migra filas históricas sin sourceTaskId y exige coincidir en
        // cliente, servicio, hora y equipo para no fusionar dos visitas legítimas.
        const existing = previous.find(item => item.id === record.id || (
          !item.sourceTaskId &&
          item.date === record.date &&
          accountKey(item) && accountKey(item) === accountKey(record) &&
          serviceKey(item) === serviceKey(record) &&
          timeKey(item) === timeKey(record) &&
          teamKey(item) === teamKey(record)
        ))
        return existing ? { ...existing, ...record, id: existing.id } : { ...record, status: 'Pendiente' }
      })
      const replacedIds = new Set(replacements.map(record => record.id))
      let payload
      if (onlyTaskId) {
        const team = teams.find(team => team.tasks.some(task => task.taskId === onlyTaskId))
        const task = team?.tasks.find(task => task.taskId === onlyTaskId)
        const record = replacements[0]
        if (!team?.members?.length || !task || !record) throw new Error('Asigná al menos un técnico antes de guardar el servicio.')
        record.team = `Equipo ${teams.indexOf(team) + 1}`
        payload = await persistWeeklyService({ dailyDraft: true, day: date, team, task: { ...task, historyId: record.id, status: record.status },
          record, baseRecord: historyRecordForTask(task, date, history) || null,
          baseTask: weekly[date]?.teams?.flatMap(item => item.tasks || []).find(item => item.taskId === onlyTaskId) || null })
      } else payload = await persistAgendaRecords(previous.filter(record => replacedIds.has(record.id)), replacements)
      const persistedHistory = Array.isArray(payload?.state?.history) ? payload.state.history : []
      const missingRecords = replacements.filter(record => !persistedHistory.some(item => (
        String(item.id || '') === String(record.id || '') ||
        (record.sourceTaskId && String(item.sourceTaskId || '') === String(record.sourceTaskId))
      )))
      if (missingRecords.length) throw new Error('El servidor no confirmó todos los servicios en el historial. Intentá guardar nuevamente.')
    } catch (error) {
      setDailySaveError({ taskId: onlyTaskId, message: `No se guardaron los servicios. ${error.message}` })
      return false
    }
    return true
  }

  const dailyServiceHasChanges = task => {
    if (!taskHasContent(task)) return false
    const saved = historyRecordForTask(task, date, history)
    const editable = value => ({ ...value, ...applicableServiceExtras(value, serviceForTask(value)), estimatedMinutes: serviceEstimateForTask(value, serviceForTask(value)) })
    return serviceHasChanges(editable(task), saved ? editable(saved) : null)
  }
  const pendingDailyServices = teams.flatMap((team, teamIndex) => team.tasks.map((task, taskIndex) => ({ task, teamIndex, taskIndex })))
    .filter(({ task }) => canSaveTask(task) && !task.vehicleControl && !dailyCompleted(task) && taskHasContent(task) && dailyServiceHasChanges(task))
  const saveDailyService = async taskId => {
    if (singleSaveRef.current) return false
    singleSaveRef.current = true
    setSingleSaving(true)
    try {
      const target = teams.flatMap(team => team.tasks).findIndex(task => task.taskId === taskId)
      const row = document.querySelectorAll('.content .team-card .task-row')[target]
      if (row) document.dispatchEvent(new CustomEvent('pignus:validate-required', { detail: { scope: row } }))
      const saved = await registerHistory(teams, taskId)
      if (!saved && row) row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return saved
    } finally { singleSaveRef.current = false; setSingleSaving(false) }
  }
  useEffect(() => {
    if (!navigationGuardRef) return
    navigationGuardRef.current = action => {
      if (singleSaveRef.current) return
      if (pendingDailyServices.length) setDailyLeave({ action })
      else action()
    }
    navigationGuardRef.current.hasDraft = () => singleSaveRef.current || pendingDailyServices.length > 0
    return () => { navigationGuardRef.current = null }
  })
  useEffect(() => {
    if (!dailyResume) return
    setDailyResume(null)
    if (pendingDailyServices.length) setDailyLeave(dailyResume)
    else dailyResume.action()
  }, [dailyResume])
  const continueDailyEditing = () => {
    const taskId = pendingDailyServices[0]?.task.taskId
    setDailyLeave(null)
    // Wait for modal removal and its automatic focus restoration before moving to the card.
    requestAnimationFrame(() => requestAnimationFrame(() => focusPendingService(taskId)))
  }
  const cancelDailyAndContinue = () => {
    if (!dailyLeave || singleSaveRef.current) return
    const first = pendingDailyServices[0]
    const request = dailyLeave
    if (first) {
      // Discard only this edit; an existing service must never become an empty slot.
      setTeams(previous => previous.map(team => ({ ...team, tasks: team.tasks.map(task => {
        if (task.taskId !== first.task.taskId) return task
        const saved = historyRecordForTask(task, date, history)
        return saved ? restoreSavedService(task, saved) : { ...blankTask(), taskId: task.taskId, time: task.time }
      }) })))
    }
    setDailyLeave(null)
    setDailyResume(request)
  }
  const saveDailyAndContinue = async () => {
    const request = dailyLeave
    const first = pendingDailyServices[0]
    setDailyLeave(null)
    if (!first) { request.action(); return }
    if (await saveDailyService(first.task.taskId)) setDailyResume(request)
  }

  const finishAgendaAction = async (action, agendaTeams = teams) => {
    if (!await registerHistory(agendaTeams)) return
    if (action === 'copy') navigator.clipboard?.writeText(message)
    setNotice(action === 'copy' ? 'La agenda fue copiada al portapapeles y registrada en el historial.' : 'La agenda fue guardada en el historial.')
  }
  const requestAgendaAction = (action, allowWithoutTechnicians = false, agendaTeams = teams, skipCustomerProposal = false) => {
    if (action === 'copy') return copyAgenda()
    agendaTeams = agendaTeamsWithRealServices(agendaTeams)
    if (pastDayBlocked) {
      setNotice(`La jornada del ${prettyDate(date)} ya finalizó. Consultá o corregí sus servicios desde Historial.`)
      return
    }
    if (advancedGuard) {
      setNotice(advancedSaturdayGuardMessage(advancedGuard))
      return
    }
    if (sundayBlocked) {
      setNotice('Los domingos son días no operativos y no admiten servicios.')
      return
    }
    if (holidayBlocked) {
      setNotice(holidayDecision?.status === 'closed' ? 'La fecha fue definida como día no operativo.' : 'Primero definí si el feriado será laboral o no operativo.')
      return
    }
    if (holidayCalendarUnavailable) {
      setNotice('No se puede guardar hasta verificar el calendario de feriados nacionales.')
      return
    }
    const meaningful = value => String(value || '').trim() && String(value || '').trim() !== '-'
    const existingUpdates = new Map()
    const newClients = new Map()
    agendaTeams.forEach(team => team.tasks.forEach(task => {
      if (isTrainingService(serviceForTask(task))) return
      const account = normalizeAccountKey(task.clientAccount || String(task.client || '').trim().split(/\s+/)[0])
      const customer = customers.find(item => String(item.customerId || '') === String(task.customerId || '')) || customers.find(item => normalizeAccountKey(item.account) === account)
      if (customer) {
        const address = !meaningful(customer.address) && meaningful(task.address) ? task.address.trim() : customer.address
        const phone = !meaningful(customer.phone) && meaningful(task.phone) ? task.phone.trim() : customer.phone
        if (can('customers.edit') && (address !== customer.address || phone !== customer.phone)) existingUpdates.set(String(customer.customerId), { ...customer, address, street: customer.street || address, phone })
      } else if (can('customers.create') && task.newCustomer && String(task.client || '').trim()) {
        const key = normalizeSearchText(task.client)
        if (!newClients.has(key)) newClients.set(key, { name: String(task.client).trim(), address: meaningful(task.address) ? task.address.trim() : '', phone: meaningful(task.phone) ? task.phone.trim() : '' })
      }
    }))
    if (!skipCustomerProposal && (existingUpdates.size || newClients.size)) {
      setCustomerProposal({ action, allowWithoutTechnicians, existingUpdates: [...existingUpdates.values()], newClients: [...newClients.values()] })
      return
    }
    if (!validateAgenda(agendaTeams)) return
    const missingTeams = agendaTeams.map((team, index) => team.tasks.length && !team.members.length ? `Equipo ${index + 1}` : '').filter(Boolean)
    if (missingTeams.length && !allowWithoutTechnicians) { showMissingTechniciansModal(missingTeams, () => requestAgendaAction(action, true, agendaTeams, true)); return }
    const conflicts = technicianTimeConflicts(agendaTeamsWithRealServices(agendaTeams), activeTechs)
    if (conflicts.length) {
      setNotice(`Conflicto de asignación: ${conflicts.map(item => `${item.name} a las ${item.time} (equipos ${item.teams.join(' y ')})`).join('; ')}.`)
      return
    }
    finishAgendaAction(action, agendaTeams)
  }
  const applyCustomerProposal = () => {
    if (!customerProposal) return
    let nextCustomers = customers.map(customer => customerProposal.existingUpdates.find(update => String(update.customerId) === String(customer.customerId)) || customer)
    const created = new Map()
    customerProposal.newClients.forEach(entry => {
      const customer = { ...blankCustomer, customerId: createCustomerId(), kind: 'client', account: nextCustomerCode(nextCustomers, 'client'), name: normalizeCustomerName(entry.name), type: 'Cliente de servicio', address: entry.address, street: entry.address, phone: entry.phone }
      nextCustomers = [...nextCustomers, customer]
      created.set(normalizeSearchText(entry.name), customer)
    })
    const nextTeams = teams.map(team => ({ ...team, tasks: team.tasks.map(task => {
      if (task.customerId || !task.newCustomer) return task
      const customer = created.get(normalizeSearchText(task.client))
      return customer ? { ...task, newCustomer: false, customerId: customer.customerId, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name, address: task.address || customer.address, phone: task.phone || customer.phone } : task
    }) }))
    window.dispatchEvent(new CustomEvent('pignus:replace-customers', { detail: { customers: nextCustomers } }))
    setTeams(nextTeams)
    const { action, allowWithoutTechnicians } = customerProposal
    setCustomerProposal(null)
    requestAgendaAction(action, allowWithoutTechnicians, nextTeams, true)
  }
  if (customerProposal) {
    const existingNames = customerProposal.existingUpdates.map(customer => customer.name).join(', ')
    const newNames = customerProposal.newClients.map(customer => customer.name).join(', ')
    const detail = [
      existingNames && `Se completarán dirección y/o contacto de: ${existingNames}.`,
      newNames && `Se crearán como clientes con código CLI automático: ${newNames}.`
    ].filter(Boolean).join(' ')
    return <Confirm title="Actualizar datos de clientes" detail={detail} action={applyCustomerProposal} confirmLabel="Sí, actualizar y continuar" close={() => setCustomerProposal(null)} />
  }
  const toggleTech = (teamIndex, technician) => can('planning.technicians') && setTeams(previous => {
    const target = previous[teamIndex] || {}
    const selected = (target.memberIds || []).some(id => String(id) === String(technician.id))
    return previous.map((team, index) => {
      if (index !== teamIndex) return team
      if (isSaturday(date)) {
        if (selected) return team
        return { ...team, teamId: team.teamId || createTeamId(), memberIds: [technician.id], members: [technician.name], tasks: (team.tasks || []).map(task => stampServiceRecord(task, authUser)) }
      }
      const memberIds = (team.memberIds || []).filter(id => String(id) !== String(technician.id))
      const members = (team.members || []).filter(name => name !== technician.name)
      if (!selected) {
        memberIds.push(technician.id)
        members.push(technician.name)
      }
      return { ...team, teamId: team.teamId || createTeamId(), memberIds, members, tasks: (team.tasks || []).map(task => stampServiceRecord(task, authUser)) }
    })
  })
  const commitCustomerText = (teamIndex, taskIndex, value) => updateTask(teamIndex, taskIndex, {
    newCustomer: false,
    subscriberReservation: false,
    customerId: '',
    client: value,
    clientAccount: '',
    clientNameAtService: '',
    address: '',
    phone: ''
  })
  const selectCustomerResult = (teamIndex, taskIndex, customer) => updateTask(teamIndex, taskIndex, customerLinkPatch(teams[teamIndex]?.tasks?.[taskIndex], customer, authUser), teams[teamIndex]?.tasks?.[taskIndex]?.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')
  const beginNewCustomer = (teamIndex, taskIndex, value) => updateTask(teamIndex, taskIndex, { newCustomer: true, subscriberReservation: false, customerId: '', client: value, clientAccount: '', clientNameAtService: normalizeCustomerName(value), address: '', phone: '' }, 'customers.create')
  const beginSubscriberReservation = (teamIndex, taskIndex, value) => updateTask(teamIndex, taskIndex, subscriberReservationPatch(value, authUser), 'planning.reservation.create')
  const moveDayPlan = day => {
    if (day === date) return { teams }
    const defaults = (isSaturday(day) ? [null] : weekly?._monthlyTeams?.[day.slice(0, 7)]?.teams || []).map((team, index) => ({
      ...team, teamId: team?.teamId || weekly?.[day]?.teams?.[index]?.teamId || `daily-move-${day}-${index}`,
      label: team?.label || `Equipo ${index + 1}`, members: team?.members || [], memberIds: team?.memberIds || [],
      tasks: defaultServiceTasksForDate(day, weekly)
    }))
    const stored = weekly?.[day] || {}
    const storedTeams = alignDefaultServiceTimes(stored.teams || [], day, defaultServiceTimesForDate(day, weekly), fallbackDefaultServiceTimesForDate(day))
    let destinationTeams = mergeStoredTeamsWithDefaults(defaults, storedTeams)
    destinationTeams = renumberVisibleWeeklyTeams(applyRemovedWeeklyTeams(applyRemovedWeeklySlots(applyRemovedWeeklyTasks(destinationTeams, stored.removedTaskIds || []), stored.removedSlots || []), stored.removedTeams || []))
    if (isSaturday(day)) destinationTeams = assignGuardToEmptySaturday(normalizeSaturdayTeams(destinationTeams, day, weekly), day, weekly, activeTechs)
    return { ...stored, teams: destinationTeams }
  }
  const openTaskMove = (teamIndex, taskIndex) => {
    if (!requirePermission('planning.reschedule')) return
    const sourceTeam = teams[teamIndex]
    const task = sourceTeam?.tasks?.[taskIndex]
    if (!task) return
    setTaskMove({ sourceTeamId: sourceTeam.teamId, sourceTeamIndex: teamIndex, taskId: task.taskId, taskIndex,
      destinationDay: date, destinationTeamIndex: teams.findIndex((_, index) => index !== teamIndex),
      time: task.time || task.scheduledTime || '', estimatedMinutes: serviceEstimateForTask(task, serviceForTask(task)) })
  }
  const confirmTaskMove = async () => {
    if (!requirePermission('planning.reschedule')) return
    if (!taskMove || taskMoveSavingRef.current) return
    const sourceTeam = teams.find(team => team.teamId === taskMove.sourceTeamId) || teams[taskMove.sourceTeamIndex]
    const task = sourceTeam?.tasks?.find(task => task.taskId === taskMove.taskId) || sourceTeam?.tasks?.[taskMove.taskIndex]
    const day = taskMove.destinationDay
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { setNotice('Seleccioná una fecha válida.'); return }
    const destinationTeam = moveDayPlan(day).teams[taskMove.destinationTeamIndex]
    if (!task || !destinationTeam) { setNotice('Seleccioná una fecha y un equipo de destino.'); return }
    if (day < currentLocalDate() || isSunday(day)) { setNotice('Elegí hoy o una fecha futura habilitada, excepto domingo.'); return }
    if (day === date && destinationTeam.teamId === sourceTeam.teamId) { setNotice('Elegí otro equipo o una fecha diferente.'); return }
    if (holidayCalendar.loading || holidayCalendar.error) { setNotice('Esperá a que se verifique el calendario de feriados antes de reasignar.'); return }
    if (holidayIsBlocked(holidayForDate(holidayCalendar.records, day), holidayDecisionForDate(weekly, day))) { setNotice('La fecha de destino no está habilitada. Revisá la configuración del feriado.'); return }
    if (advancedGuardForSaturdayDate(day, weekly, moveDayPlan(day).teams)) { setNotice('La guardia de ese sábado fue adelantada. Elegí la fecha de la guardia.'); return }
    if (!destinationTeam.members?.length) { setNotice('El equipo de destino no tiene técnicos asignados.'); return }
    const durationCustomized = task.estimatedMinutesCustomized === true || Number(taskMove.estimatedMinutes) !== Number(serviceEstimateForTask(task, serviceForTask(task)))
    const movedTask = stampServiceRecord({ ...task, time: taskMove.time, estimatedMinutes: taskMove.estimatedMinutes, estimatedMinutesCustomized: durationCustomized }, authUser)
    const schedule = taskMoveScheduleState(day, movedTask, weekly, destinationTeam.teamId)
    if (!schedule.valid) { setNotice(schedule.message); return }
    const destinationGap = minimumServiceGapConflicts([{ ...destinationTeam, tasks: [...(destinationTeam.tasks || []).filter(item => item.taskId !== task.taskId), movedTask].map(item => {
      const occupancy = taskForScheduleOccupancy(item, day, history)
      return occupancy ? taskWithServiceEstimate(occupancy, serviceForTask(item)) : null
    }).filter(Boolean) }])[0]
    if (destinationGap) { setNotice(`No se puede reasignar porque ${scheduleConflictMessage(destinationGap)}.`); return }
    const baseRecord = historyRecordForTask(task, date, history) || null
    const changedDate = day !== date
    const record = stampServiceRecord({
      ...baseRecord, ...movedTask, id: baseRecord?.id || task.historyId || `work-${task.taskId}`,
      sourceTaskId: task.taskId, date: day, time: movedTask.time, scheduledTime: movedTask.time,
      teamId: destinationTeam.teamId, team: destinationTeam.label || `Equipo ${taskMove.destinationTeamIndex + 1}`,
      technicianIds: destinationTeam.memberIds || [], technicians: destinationTeam.members || [],
      estimatedMinutes: movedTask.estimatedMinutes, estimatedMinutesCustomized: durationCustomized,
      status: changedDate ? 'Pendiente' : baseRecord?.status || task.status || 'Pendiente', scheduledDate: '',
      ...(changedDate ? { rescheduledFrom: date, reprogrammedAt: new Date().toISOString() } : {})
    }, authUser)
    taskMoveSavingRef.current = true
    try {
      await persistWeeklyService({ day, team: destinationTeam, task: { ...movedTask, historyId: record.id, status: record.status },
        record, baseRecord, baseTask: weekly?.[date]?.teams?.flatMap(team => team.tasks || []).find(item => item.taskId === task.taskId) || null,
        sourceDay: date, sourceTeamId: sourceTeam.teamId })
      setTaskMove(null)
      setNotice(`El servicio fue reasignado a ${record.team} para el ${prettyDate(day)}.`)
    } catch (error) { setNotice(`No se pudo reasignar el servicio. ${error.message || 'Intentá nuevamente.'}`) }
    finally { taskMoveSavingRef.current = false }
  }
  useEffect(() => {
    if (!taskMove) return undefined
    const sourceTeam = teams.find(team => team.teamId === taskMove.sourceTeamId) || teams[taskMove.sourceTeamIndex]
    const originalTask = sourceTeam?.tasks?.find(task => task.taskId === taskMove.taskId) || sourceTeam?.tasks?.[taskMove.taskIndex]
    const moveDraft = originalTask ? { ...originalTask, time: taskMove.time, estimatedMinutes: taskMove.estimatedMinutes, estimatedMinutesCustomized: originalTask.estimatedMinutesCustomized === true || Number(taskMove.estimatedMinutes) !== Number(serviceEstimateForTask(originalTask, serviceForTask(originalTask))) } : null
    const schedule = taskMoveScheduleState(taskMove.destinationDay, moveDraft, weekly, selectedTeam?.teamId)
    const selectedTeam = moveDayPlan(taskMove.destinationDay).teams[taskMove.destinationTeamIndex]
    const destinationGap = moveDraft && selectedTeam ? minimumServiceGapConflicts([{ ...selectedTeam, tasks: [...(selectedTeam.tasks || []).filter(item => item.taskId !== moveDraft.taskId), moveDraft].map(item => {
      const occupancy = taskForScheduleOccupancy(item, taskMove.destinationDay, history)
      return occupancy ? taskWithServiceEstimate(occupancy, serviceForTask(item)) : null
    }).filter(Boolean) }])[0] : null
    const layer = document.createElement('div')
    layer.className = 'modal-layer task-move-layer'
    const modal = document.createElement('section')
    modal.className = 'modal task-move-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-label', 'Cambiar equipo o fecha')
    const title = document.createElement('h2')
    title.textContent = 'Cambiar equipo, horario o fecha'
    const detail = document.createElement('p')
    detail.textContent = 'Elegí el destino y ajustá la hora o el tiempo estimado antes de confirmar. Todos los cambios se guardarán en una única operación.'
    const dateLabel = document.createElement('label')
    dateLabel.textContent = 'Nueva fecha'
    const dateInput = document.createElement('input')
    dateInput.type = 'date'
    dateInput.min = currentLocalDate()
    dateInput.value = taskMove.destinationDay
    dateLabel.append(dateInput)
    const label = document.createElement('label')
    label.textContent = 'Equipo de destino'
    const select = document.createElement('select')
    label.append(select)
    const error = document.createElement('p')
    error.className = 'field-error'
    const timeLabel = document.createElement('label')
    timeLabel.textContent = 'Hora de inicio'
    const timeInput = document.createElement('input')
    timeInput.type = 'time'
    timeInput.value = taskMove.time || ''
    timeInput.min = schedule.hours?.min || ''
    timeInput.max = schedule.hours?.max || ''
    timeLabel.append(timeInput)
    const duration = normalizeServiceEstimatedMinutes(taskMove.estimatedMinutes)
    const durationField = document.createElement('div')
    durationField.className = 'task-duration-field task-move-duration'
    const durationTitle = document.createElement('span')
    durationTitle.textContent = 'Tiempo estimado *'
    const durationControls = document.createElement('div')
    const hoursLabel = document.createElement('label')
    const hoursInput = document.createElement('input')
    hoursInput.type = 'number'; hoursInput.inputMode = 'numeric'; hoursInput.min = '0'; hoursInput.max = '12'; hoursInput.step = '1'; hoursInput.value = String(Math.floor(duration / 60))
    const hoursSuffix = document.createElement('small'); hoursSuffix.textContent = 'h'; hoursLabel.append(hoursInput, hoursSuffix)
    const minutesLabel = document.createElement('label')
    const minutesSelect = document.createElement('select')
    for (const value of [0, 15, 30, 45]) { const option = document.createElement('option'); option.value = String(value); option.textContent = String(value).padStart(2, '0'); minutesSelect.append(option) }
    minutesSelect.value = String(duration % 60)
    const minutesSuffix = document.createElement('small'); minutesSuffix.textContent = 'min'; minutesLabel.append(minutesSelect, minutesSuffix)
    durationControls.append(hoursLabel, minutesLabel); durationField.append(durationTitle, durationControls)
    const range = document.createElement('p')
    range.className = 'task-occupied-range task-move-range'
    range.textContent = schedule.interval ? `Franja estimada: ${schedule.interval.startTime}–${schedule.interval.serviceEndTime}` : ''
    const scheduleError = document.createElement('p')
    scheduleError.className = 'field-error task-move-schedule-error'
    scheduleError.setAttribute('role', 'alert')
    scheduleError.textContent = schedule.message || (destinationGap ? `No se puede reasignar porque ${scheduleConflictMessage(destinationGap)}.` : '')
    const populate = day => {
      select.replaceChildren()
      const options = /^\d{4}-\d{2}-\d{2}$/.test(day) ? moveDayPlan(day).teams : []
      options.forEach((team, index) => {
        if (day === date && team.teamId === taskMove.sourceTeamId) return
        const option = document.createElement('option')
        option.value = String(index)
        option.textContent = `${team.label || 'Equipo ' + (index + 1)} · ${team.members?.join(' / ') || 'Sin técnicos'}`
        select.append(option)
      })
      error.textContent = select.options.length ? '' : 'No hay equipos disponibles. Elegí otra fecha o configurá sus equipos en Agenda semanal.'
    }
    populate(taskMove.destinationDay)
    if ([...select.options].some(option => Number(option.value) === taskMove.destinationTeamIndex)) select.value = String(taskMove.destinationTeamIndex)
    const actions = document.createElement('div')
    actions.className = 'confirm-actions'
    const cancel = document.createElement('button'); cancel.title = "Cancelá la reasignación sin cambiar el equipo ni la fecha del servicio."
    cancel.type = 'button'
    cancel.className = 'secondary'
    cancel.textContent = 'Cancelar'
    cancel.onclick = () => { if (!taskMoveSavingRef.current) setTaskMove(null) }
    const confirm = document.createElement('button'); confirm.title = "Guardá el traslado del servicio al equipo, fecha y horario seleccionados."
    confirm.type = 'button'
    confirm.className = 'primary'
    confirm.textContent = 'Reasignar servicio'
    confirm.disabled = !select.options.length
    dateInput.onchange = () => {
      populate(dateInput.value)
      setTaskMove(previous => ({ ...previous, destinationDay: dateInput.value, destinationTeamIndex: select.value === '' ? -1 : Number(select.value) }))
    }
    select.onchange = () => setTaskMove(previous => ({ ...previous, destinationTeamIndex: Number(select.value) }))
    timeInput.onchange = () => setTaskMove(previous => ({ ...previous, time: timeInput.value }))
    const updateDuration = () => {
      const estimatedMinutes = Math.min(MAX_SERVICE_ESTIMATED_MINUTES, Math.max(15, Number(hoursInput.value) * 60 + Number(minutesSelect.value)))
      setTaskMove(previous => ({ ...previous, estimatedMinutes }))
    }
    hoursInput.onchange = updateDuration
    minutesSelect.onchange = updateDuration
    confirm.disabled = confirm.disabled || !schedule.valid || Boolean(destinationGap)
    confirm.onclick = async () => {
      confirm.disabled = true
      cancel.disabled = true
      dateInput.disabled = true
      select.disabled = true
      confirm.textContent = 'Guardando…'
      try { await confirmTaskMove() } finally {
        confirm.disabled = !select.options.length || !schedule.valid || Boolean(destinationGap)
        cancel.disabled = dateInput.disabled = select.disabled = false
        confirm.textContent = 'Reasignar servicio'
      }
    }
    actions.append(cancel, confirm)
    modal.append(title, detail, dateLabel, label, timeLabel, durationField, range, error, scheduleError, actions)
    layer.append(modal)
    document.body.append(layer)
    return () => layer.remove()
  }, [taskMove, teams, weekly, history, holidayCalendar.loading, holidayCalendar.error, holidayCalendar.records])
  const dailyLeaveModal = dailyLeave && <div className="modal-layer" style={{ zIndex: 10000 }}><section className="modal unsaved-service-modal" role="alertdialog" aria-modal="true" aria-label="Servicios sin guardar"><h2>Servicios sin guardar</h2><p>Hay {pendingDailyServices.length} servicio(s) de esta agenda sin guardar. Podés guardar, seguir editando o cancelar la carga del servicio pendiente. Los servicios ya guardados se conservan.</p><div className="modal-actions"><button title="Volvé al formulario para seguir editando sin descartar los cambios." type="button" className="secondary" onClick={continueDailyEditing}><Icon name="edit" size={16} />Seguir editando</button><button title="Descartá los cambios sin guardar de esta edición y continuá; no elimina un servicio ya guardado." type="button" className="danger-button" onClick={cancelDailyAndContinue}><Icon name="close" size={16} />Cancelar carga</button><button title="Guardá los cambios del servicio antes de continuar con la acción solicitada." type="button" className="primary" onClick={saveDailyAndContinue}><Icon name="check" size={16} />Guardar y continuar</button></div></section></div>
  const dailyCustomerField = (task, teamIndex, taskIndex) => {
    const required = taskHasContent(task)
    return isTrainingService(serviceForTask(task))
      ? <label className="daily-field-customer"><RequiredLabel required={required}>Nombre de la capacitación</RequiredLabel><BufferedInput disabled={!canEditTask(task)} aria-required={required} placeholder="CAPACITACIÓN CERCO ELÉCTRICO" value={task.client} onCommit={value => updateTask(teamIndex, taskIndex, trainingClientPatch(value), 'planning.training')} /></label>
      : <DailyCustomerField disabled={Boolean(historyRecordForTask(task, date, history)) && !canWriteTask(task)} task={task} customers={customers} teamIndex={teamIndex} taskIndex={taskIndex} required={required} onTextCommit={commitCustomerText} onCustomerSelect={selectCustomerResult} onAddCustomer={beginNewCustomer} onReserveSubscriber={serviceCode(serviceForTask(task)) === 'alarm-installation' ? beginSubscriberReservation : undefined} />
  }
  const dailyScheduleTeams = teams.map(team => ({ ...team, tasks: team.tasks.map(task => taskWithServiceEstimate({ ...historyRecordForTask(task, date, history), ...task, date }, serviceForTask(task))) }))
  const gapsForDailyTeam = (teamIndex, now) => teamServiceGaps(dailyScheduleTeams, teamIndex, { ...planningHoursForDay(date, weekly, teams[teamIndex]?.teamId), fullAvailability: true, day: date, now }, team => planningHoursForDay(date, weekly, team.teamId))
  const dailyGaps = teams.map((team, teamIndex) => withLunchNotice(team.tasks, gapsForDailyTeam(teamIndex, dailyPlanningClock), planningHoursForDay(date, weekly, team.teamId)))
  const addDailyGapTask = (teamIndex, start) => {
    if (!requirePermission('planning.create')) return
    const gap = gapsForDailyTeam(teamIndex, Date.now()).find(item => item.start === start)
    if (!gap) { setDailyPlanningClock(Date.now()); setNotice('La disponibilidad cambió. Revisá los horarios antes de agregar el servicio.'); return }
    const task = { ...blankTask(), time: gap.start }
    setTeams(previous => previous.map((team, index) => index === teamIndex ? { ...team, tasks: [...team.tasks.slice(0, gap.beforeIndex), task, ...team.tasks.slice(gap.beforeIndex)] } : team))
    setGapTaskFocus(task.taskId)
  }
  if (pastDayBlocked) {
    return <>{dailyLeaveModal}<div className="module-intro"><ModuleIntroduction><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Jornada finalizada</h1><p>Las fechas pasadas son de solo lectura en las agendas. Consultá o corregí los servicios registrados desde Historial.</p></ModuleIntroduction></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required min={currentLocalDate()} type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div><p className="weekly-guard-advanced"><Icon name="lock" size={16} /><span>Esta jornada ya finalizó y no admite equipos ni servicios nuevos.</span></p></>
  }
  if (sundayBlocked) {
    return <>{dailyLeaveModal}<div className="module-intro"><ModuleIntroduction><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Agenda del domingo bloqueada</h1><p>Los domingos son días no operativos y no admiten equipos, técnicos ni servicios.</p></ModuleIntroduction></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div><p className="weekly-guard-advanced"><Icon name="lock" size={16} /><span>Domingo sin programación. Seleccioná otro día para organizar servicios.</span></p></>
  }
  if (holidayCalendarUnavailable || holidayBlocked) {
    const closedHoliday = holiday && holidayDecision?.status === 'closed'
    return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>{closedHoliday ? 'Agenda del feriado bloqueada' : 'Organizá los trabajos del día'}</h1><p>{closedHoliday ? `${holiday.name} fue definido como día no operativo y no admite servicios.` : 'La disponibilidad se habilita después de verificar el calendario laboral.'}</p></ModuleIntroduction></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{holidayCalendar.loading ? <div className="holiday-calendar-state"><span className="loading-spinner" />Verificando feriados nacionales…</div> : holidayCalendar.error ? <div className="holiday-calendar-state error"><Icon name="alert" /><div><b>No se pudo verificar el calendario nacional</b><p>{holidayCalendar.error}</p></div><button title="Recargá la página para volver a intentar la conexión; los datos no guardados pueden perderse." className="secondary" onClick={() => window.location.reload()}>Reintentar</button></div> : <HolidayDecisionPanel holiday={holiday} decision={holidayDecision} canDecide={isGranular(authUser) ? can('weekly.holidays') : authUser?.roleCode === 'administrator'} onDecision={status => recordHolidayDecision(setWeekly, setNotice, date, holiday, status, { weekly, history, setHistory, holidays: holidayCalendar.records })} />}</>
  }
  if (advancedGuard) {
    return <><div className="module-intro"><ModuleIntroduction><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Agenda del sábado bloqueada</h1><p>La guardia de fin de semana ya fue cubierta el viernes y no admite nuevos equipos, técnicos ni servicios.</p></ModuleIntroduction></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div><p className={`weekly-guard-advanced ${advancedGuard.hasSaturdayConflict ? 'has-conflict' : ''}`}><Icon name={advancedGuard.hasSaturdayConflict ? 'alert' : 'check'} size={16} /><span>{advancedSaturdayGuardMessage(advancedGuard)}</span></p></>
  }
  return <>{dailyLeaveModal}<div className="module-intro"><ModuleIntroduction><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></ModuleIntroduction><div className="action-group">{can('agenda.clear') && <button title="Solicitá borrar los equipos y servicios de esta agenda; se pedirá confirmación." className="secondary" onClick={() => setConfirmation('clear')}><Icon name="trash" />Limpiar agenda</button>}{can('planning.copy') && <button title="Revisá el texto de la agenda antes de copiarlo y compartirlo." className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button>}{canWritePlan && showSaveAgenda && <button title="Guardá los servicios de la agenda y habilitalos según su estado y confirmación." type="button" className="secondary save-agenda-button" onClick={saveAgenda}><Icon name="check" />Guardar agenda</button>}{can('planning.copy') && <button title="Copiá el texto de la agenda al portapapeles para pegarlo y compartirlo." className="primary" onClick={copyAgenda}><Icon name="copy" />Copiar agenda</button>}</div></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, teamIndex) => <article className="team-card" key={team.teamId || teamIndex}><div className="team-header"><div className="daily-team-heading"><span className="team-number">{teamIndex + 1}</span><div className="daily-team-identity"><strong>Equipo {teamIndex + 1}</strong><span className="daily-team-member-names" title={team.members.join(' · ') || 'Sin técnicos'}>{team.members.length ? team.members.map(name => String(name).trim().split(/\s+/)[0]).join(' · ') : 'Sin técnicos'}</span></div>{can('planning.teams.delete') && teams.length > 1 && <button title="Solicitá quitar este equipo y su asignación del día; revisá los servicios asociados antes de confirmar." className="team-delete" onClick={() => setConfirmation({ type: 'team', index: teamIndex })}><Icon name="trash" size={16} />Eliminar equipo</button>}</div><div className="technicians-picker"><span className="technician-assignment-label"><RequiredLabel>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</RequiredLabel></span><button disabled={!can('planning.technicians')} title="Elegí los técnicos que integrarán este equipo en la fecha seleccionada." className="secondary small" onClick={() => { setTechOpen(techOpen === teamIndex ? null : teamIndex); setFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{can('planning.technicians') && techOpen === teamIndex && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={filter} onChange={event => setFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(filter.toLowerCase())).map(tech => <label key={tech.id}><input type="checkbox" checked={(team.memberIds || []).some(id => String(id) === String(tech.id))} onChange={() => toggleTech(teamIndex, tech)} />{tech.name}</label>)}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, taskIndex) => <React.Fragment key={task.taskId || task.historyId || taskIndex}>{dailyGaps[teamIndex].filter(gap => gap.beforeIndex === taskIndex).map(gap => gap.kind === 'lunch' ? <LunchCard key="lunch" hours={gap.hours} /> : <div className="weekly-time-gap daily-time-gap" key={gap.start}><strong>Disponibilidad horaria desde las {gap.start} hs hasta las {gap.end} hs</strong>{can('planning.create') && <button title="Creá un servicio en esta franja horaria disponible del equipo." type="button" className="secondary" onClick={() => addDailyGapTask(teamIndex, gap.start)}><Icon name="plus" size={16} />Agregar servicio</button>}</div>)}<div className={dailyCompleted(task) ? "task-row task-row-completed" : "task-row"} data-daily-task-id={task.taskId} tabIndex={-1} key={task.taskId || task.historyId || `${team.teamId || teamIndex}-${taskIndex}`}><div className="task-title"><span>{taskIndex + 1}</span><b>{task.vehicleControl ? 'Control vehicular' : 'Servicio'}</b></div>{dailySaveError && (!dailySaveError.taskId || dailySaveError.taskId === task.taskId) && <p className="field-error" role="alert" style={{ gridColumn: '1 / -1' }}>{dailySaveError.message}</p>}{dailyCompleted(task) ? <div className="daily-completed-summary"><div className="daily-completed-identity"><strong>{historyRecordForTask(task, date, history)?.client || task.client}</strong><p><time>{task.time}</time> · {historyRecordForTask(task, date, history)?.service || task.service}</p></div><div className="daily-completed-status"><TaskStatusBadge task={task} date={date} history={history} /><small className="daily-completed-readonly"><Icon name="lock" size={12} />Solo lectura</small></div></div> : task.vehicleControl ? <div className="vehicle-control-daily-fields"><span><b>Hora:</b> {task.time} hs</span><span><b>Tipo:</b> {task.service}</span><span><b>Duración:</b> 15 minutos</span><span><b>Vehículo:</b> {task.client || vehicleLabel(task)}</span><span><b>Técnico responsable:</b> {task.technicians?.[0] || team.members?.[0] || 'Sin asignar'}</span></div> : <><label className="daily-field-time"><RequiredLabel>Hora</RequiredLabel><input disabled={!canEditTask(task) || (Boolean(historyRecordForTask(task, date, history)) && !can('planning.reschedule'))} aria-required="true" type="time" value={task.time} onChange={event => updateTask(teamIndex, taskIndex, { time: event.target.value })} /></label><label className="daily-field-service"><RequiredLabel>Tipo de servicio</RequiredLabel><ServiceTypesField disabled={!canEditTask(task)} task={task} services={services} onChange={patch => updateTask(teamIndex, taskIndex, patch)} /></label>
<div className="daily-field-duration"><ServiceEstimatedDurationField disabled={!canEditTask(task)} required={taskHasContent(task)} value={serviceEstimateForTask(task, serviceForTask(task))} onChange={estimatedMinutes => updateTask(teamIndex, taskIndex, { estimatedMinutes, estimatedMinutesCustomized: true })} />{journeyLabel(historyRecordForTask(task, date, history), history) && <small className="journey-label">{journeyLabel(historyRecordForTask(task, date, history), history)}</small>}</div>
{task.time && <small className="task-occupied-range">Franja estimada: {taskOccupiedTimeLabel(taskWithServiceEstimate(task, serviceForTask(task)), planningHoursForDay(date, weekly, team.teamId))}</small>}
{(() => { const conflict = conflictForDailyTask(teamIndex, taskIndex); return conflict && <p className="task-schedule-alert" role="alert"><Icon name="alert" size={16} /><span>{scheduleConflictForTaskMessage(conflict, taskIndex)}</span></p> })()}
<TaskStatusBadge task={task} date={date} history={history} />
{!task.vehicleControl && <ServicePhotoManager record={{ ...(historyRecordForTask(task, date, history) || {}), ...task }} onMetadataChange={patch => { updateTask(teamIndex, taskIndex, patch); setHistory(previous => previous.map(record => String(record.id) === String(task.historyId) || String(record.sourceTaskId) === String(task.taskId) ? { ...record, ...patch } : record)) }} />}
{dailyCustomerField(task, teamIndex, taskIndex)}
<label className="daily-field-address"><RequiredLabel>{addressChange.isAddressChange(task) ? 'Domicilio actual' : 'Dirección'}</RequiredLabel><input disabled={!canEditTask(task)} aria-required="true" value={task.address} onChange={event => updateTask(teamIndex, taskIndex, { address: event.target.value }, isTrainingService(serviceForTask(task)) ? 'planning.training' : undefined)} /></label><AddressChangeFields record={task} disabled={!canEditTask(task)} onChange={newAddress => updateTask(teamIndex, taskIndex, { newAddress })} /><label className="daily-field-contact">{isTrainingService(serviceForTask(task)) ? 'Contacto (opcional)' : <RequiredLabel>Contacto</RequiredLabel>}<input disabled={!canEditTask(task)} aria-required={!isTrainingService(serviceForTask(task))} value={task.phone} onChange={event => updateTask(teamIndex, taskIndex, { phone: event.target.value }, isTrainingService(serviceForTask(task)) ? 'planning.training' : undefined)} /></label><label className="observations daily-field-observations">Observaciones<BufferedTextarea readOnly={!canEditTask(task)} value={task.detail} onCommit={value => updateTask(teamIndex, taskIndex, { detail: value })} /></label>{serviceCode(serviceForTask(task)) === 'alarm-installation' && <fieldset disabled={!canEditTask(task)} className="installation-zone"><legend><RequiredLabel>Ubicación de la instalación</RequiredLabel></legend>{INSTALLATION_ZONES.map(([value, label]) => <label key={value}><input type="radio" aria-required="true" name={`zone-${teamIndex}-${taskIndex}`} checked={task.installationZone === value} onChange={() => { const nextTask = { ...task, installationZone: value }; updateTask(teamIndex, taskIndex, { installationZone: value, ...applicableServiceExtras(nextTask, serviceForTask(task)) }) }} />{label}</label>)}</fieldset>}<ServiceExtraFields className="daily-extra-fields" task={task} service={serviceForTask(task)} buffered readOnly={!canWriteTask(task)} onChange={patch => updateTask(teamIndex, taskIndex, patch)} /></>}<div className="daily-task-actions">{!task.vehicleControl && !dailyCompleted(task) && <>{canSaveTask(task) && dailyServiceHasChanges(task) && <button title="Validá y guardá los datos de este servicio para compartirlos con los demás usuarios." type="button" className="primary daily-save-button" disabled={singleSaving} onClick={() => saveDailyService(task.taskId)}><Icon name="check" size={16} /><span>{singleSaving ? 'Guardando…' : 'Guardar'}</span></button>}<ServiceJourneys record={historyRecordForTask(task, date, history)} disabled={dailyServiceHasChanges(task)} action /><ServiceConfirmationButton task={task} day={date} history={history} persist={persistWeeklyService} disabled={Boolean(historyRecordForTask(task, date, history)) && dailyServiceHasChanges(task)} onDraftChange={!historyRecordForTask(task, date, history) ? patch => updateTask(teamIndex, taskIndex, patch) : undefined} />{can('planning.copy') && <button type="button" className="icon-btn daily-copy-button" title="Copiá los datos de este servicio para crear otra planificación." aria-label={`Copiar servicio ${taskIndex + 1} del Equipo ${teamIndex + 1}`} onClick={() => copySingleTask(task, team, teamIndex, taskIndex)}><Icon name="copy" size={16} /><span>Copiar</span></button>}{can('planning.reschedule') && taskHasContent(task) && <button type="button" className="icon-btn move daily-move-button" title="Elegí otro equipo o fecha para trasladar este servicio." aria-label={`Reasignar servicio ${taskIndex + 1} a otro equipo`} onClick={() => openTaskMove(teamIndex, taskIndex)}><span aria-hidden="true">⇄</span><span>Reasignar</span></button>}{can('planning.remove') && (team.tasks.length > 1 || taskHasContent(task)) && <button type="button" className="icon-btn delete daily-delete-button" title="Solicitá eliminar este servicio de la agenda; revisá el cliente antes de confirmar." aria-label={`Eliminar servicio ${taskIndex + 1} del Equipo ${teamIndex + 1}`} onClick={() => setConfirmation({ type: 'task', journey: Boolean(task.serviceJourney || historyRecordForTask(task, date, history)?.serviceJourney), client: task.client || 'Servicio sin cliente', action: async () => { if (!requirePermission('planning.remove')) return; try { await persistWeeklyService({ operation: 'task-remove', day: date, teamId: team.teamId, teamIndex, taskIndex, taskId: task.taskId, historyId: task.historyId, time: task.time, wasPlaceholder: !taskHasContent(task), fallbackPlan: { teams } }); setNotice('El servicio fue eliminado correctamente.') } catch (error) { setNotice(`No se eliminó el servicio. ${error.message}`) } } })}><Icon name="trash" size={16} /><span>Eliminar</span></button>}</>}</div></div></React.Fragment>)}{dailyGaps[teamIndex].filter(gap => gap.beforeIndex === team.tasks.length).map(gap => gap.kind === 'lunch' ? <LunchCard key="lunch" hours={gap.hours} /> : <div className="weekly-time-gap daily-time-gap" key={gap.start}><strong>Disponibilidad horaria desde las {gap.start} hs hasta las {gap.end} hs</strong>{can('planning.create') && <button title="Creá un servicio en esta franja horaria disponible del equipo." type="button" className="secondary" onClick={() => addDailyGapTask(teamIndex, gap.start)}><Icon name="plus" size={16} />Agregar servicio</button>}</div>)}</div></article>)}{can('planning.teams.create') && <button title="Agregá otro equipo a la agenda para asignarle técnicos y servicios." className="add-team" onClick={() => setTeams([...teams, { teamId: createTeamId(), memberIds: [], members: [], tasks: [] }])}><Icon name="plus" />Agregar otro equipo</button>}{confirmation?.type === 'task' && <Confirm title="Eliminar servicio" detail={`¿Querés eliminar ${confirmation.client} de esta agenda? Revisá el cliente antes de confirmar.${confirmation.journey ? ' Si la jornada está pendiente, quedará cancelada. Se conservarán su historial y las otras jornadas.' : ''}`} destructive action={confirmation.action} close={() => setConfirmation(null)} />}{preview && <Preview title="Vista previa de la agenda" text={message} onCopy={copyAgenda} close={() => setPreview(false)} />}{confirmation === 'clear' && <Confirm title="Limpiar agenda" detail="¿Querés borrar todos los equipos y servicios cargados?" destructive action={clearAgenda} close={() => setConfirmation(null)} />}{confirmation?.type === 'team' && <Confirm title="Eliminar equipo" detail={`¿Querés eliminar el Equipo ${confirmation.index + 1}? Se quitará el equipo y su asignación de técnicos de ese día. Si sólo tiene controles vehiculares pendientes, un administrador también los omitirá porque esos vehículos no se utilizarán. Otros servicios o controles completados impiden eliminarlo.`} destructive action={async () => { if (!requirePermission('planning.teams.delete')) return; const target = teams[confirmation.index]; if (!target) return; try { await persistWeeklyService({ operation: 'team-remove', day: date, teamId: target.teamId, teamIndex: confirmation.index, fallbackPlan: { teams } }); setTechOpen(null); setNotice('El equipo y su asignación fueron eliminados; sus controles vehiculares pendientes, si los había, fueron omitidos.'); } catch (error) { setNotice(`No se eliminó el equipo. ${error.message}`); } }} close={() => setConfirmation(null)} />}</>
}
