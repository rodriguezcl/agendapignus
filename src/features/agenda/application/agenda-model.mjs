import { rescheduleVehicleControlRecords } from "../../../domain/vehicles/vehicle-controls.mjs";
import { prettyDate, currentLocalDate } from "../../../presentation/formatting.mjs";
import { createTaskId, createTeamId } from "../../../infrastructure/browser/identity.mjs";
import { DEFAULT_2026_GUARD_ROTATION, annualGuardForDate, firstSaturdayOfYear } from "../../../domain/agenda/annual-guards.mjs";
import { normalizeServiceName, normalizeSearchText } from "../../../domain/shared/normalization.mjs";
import { findAdvancedSaturdayGuard } from "../../../domain/agenda/weekend-guard.mjs";
import { normalizeInternalChecklist, resolveServiceForTask, applicableServiceExtras, technicianVisibleServiceExtras, formatCurrencyAmount } from "../../services/application/service-fields.mjs";
import { removeOverlappingDefaultSlots, serviceSlotReleased, taskOccupiedInterval } from "../../../domain/agenda/service-scheduling.mjs";
import { historyStatusLabel } from "../../../domain/dashboard/dashboard-metrics.mjs";
import { normalizeAccountKey } from "../../customers/application/customer-model.mjs";
import { rescheduledAgendaTask } from "../../../domain/agenda/reschedule-repair.mjs";
import { journeyLabel } from "../../../domain/agenda/journey-progress.mjs";
import { agendaPreviewTasks } from "../../../domain/agenda/preview-tasks.mjs";
import { planningHoursForDay } from "../../../domain/agenda/service-gaps.mjs";

export const nextLiveScheduleMinute = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const elapsed = Number(parts.hour) * 60 + Number(parts.minute) + (Number(parts.second) > 0 ? 1 : 0)
  return Math.ceil(elapsed / 15) * 15
}

export function recordHolidayDecision(setWeekly, setNotice, date, holiday, status, { weekly = {}, history = [], setHistory, holidays = [] } = {}) {
  const user = globalThis.__pignusCurrentUser
  if (user?.roleCode !== 'administrator') {
    setNotice('Solamente un administrador puede definir la operación durante un feriado.')
    return
  }
  let nextWeekly = {
    ...weekly,
    _holidayOverrides: {
      ...(weekly?._holidayOverrides || {}),
      [date]: {
        status,
        holidayName: holiday?.name || 'Feriado nacional',
        decidedAt: new Date().toISOString(),
        decidedById: user.id,
        decidedByName: user.name
      }
    }
  }
  const sourceHistory = history || globalThis.__pignusHistory || []
  const rescheduledHistory = rescheduleVehicleControlRecords(sourceHistory, { holidays, holidayOverrides: nextWeekly._holidayOverrides })
  const movedControls = sourceHistory.map((record, index) => ({ before: record, after: rescheduledHistory[index] })).filter(({ before, after }) => before?.vehicleControl && before.date !== after.date)
  movedControls.forEach(({ before, after }) => { nextWeekly = moveRecordInWeeklyAgenda(nextWeekly, after, after.date, before.date) })
  setWeekly(nextWeekly)
  const replaceHistory = setHistory || globalThis.__pignusSetHistory
  if (replaceHistory) replaceHistory(previous => rescheduleVehicleControlRecords(previous, { holidays, holidayOverrides: nextWeekly._holidayOverrides }))
  const controlNotice = movedControls.length ? ` Se reprogramaron ${movedControls.length} control(es) vehicular(es) pendiente(s) al último día operativo anterior.` : ''
  setNotice(`${status === 'working' ? `${prettyDate(date)} quedó habilitado como día laboral.` : `${prettyDate(date)} quedó definido como día no operativo.`}${controlNotice}`)
}

export const blankTask = () => ({ taskId: createTaskId(), time: '', serviceId: '', service: '', customerId: '', client: '', clientAccount: '', clientNameAtService: '', address: '', phone: '', detail: '', internalNote: '', internalChecklist: [], paymentMethod: '', amount: '', monthlyFee: '', form: '', formEmail: '' })

export const taskTimeInMinutes = task => {
  const value = String(task?.time || task?.scheduledTime || '').trim()
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

export const sortTasksByTime = tasks => [...(tasks || [])].sort((left, right) => {
  const leftMinutes = taskTimeInMinutes(left)
  const rightMinutes = taskTimeInMinutes(right)
  if (leftMinutes === null && rightMinutes === null) return 0
  if (leftMinutes === null) return 1
  if (rightMinutes === null) return -1
  return leftMinutes - rightMinutes
})

export const sortPlanTasksByTime = plan => ({
  ...plan,
  teams: (plan?.teams || []).map(team => ({ ...team, tasks: sortTasksByTime(team.tasks) }))
})

export const isSaturday = date => Boolean(date) && new Date(`${date}T12:00:00`).getDay() === 6

export const isSunday = date => Boolean(date) && new Date(`${date}T12:00:00`).getDay() === 0

export const default2026GuardRotationFor = activeTechs => {
  const rotation = DEFAULT_2026_GUARD_ROTATION.map(tokens => activeTechs.find(tech => {
    const normalized = normalizeServiceName(tech.name)
    return tokens.every(token => normalized.includes(token))
  })).filter(Boolean)
  return rotation.length === DEFAULT_2026_GUARD_ROTATION.length
    ? rotation.map(tech => ({ technicianId: tech.id, name: tech.name }))
    : []
}

export const guardForDateWithDefaults = (date, weekly, activeTechs) => {
  const configured = annualGuardForDate(date, weekly)
  if (configured) return configured
  const rotation = String(date || '').startsWith('2026-') ? default2026GuardRotationFor(activeTechs) : []
  return rotation.length ? annualGuardForDate(date, { _annualGuards: { 2026: { startDate: firstSaturdayOfYear(2026), rotation } } }) : null
}

export const assignGuardToEmptySaturday = (teams, date, weekly, activeTechs) => {
  if (!isSaturday(date) || !teams?.length || teams.some(team => team?.members?.length || team?.memberIds?.length)) return teams
  const guard = guardForDateWithDefaults(date, weekly, activeTechs)
  if (!guard) return teams
  const technician = activeTechs.find(tech => String(tech.id) === String(guard.technicianId)) || activeTechs.find(tech => normalizeServiceName(tech.name) === normalizeServiceName(guard.name))
  const name = technician?.name || guard.name
  const technicianId = technician?.id || guard.technicianId
  if (!name) return teams
  return teams.map((team, index) => index === 0 ? { ...team, memberIds: technicianId ? [technicianId] : [], members: [name] } : team)
}

export const advancedGuardForSaturdayDate = (date, weekly, saturdayTeams) => {
  if (!isSaturday(date)) return null
  const friday = new Date(`${date}T12:00:00`)
  friday.setDate(friday.getDate() - 1)
  const fridayKey = friday.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  return findAdvancedSaturdayGuard({
    fridayPlan: weekly?.[fridayKey],
    saturdayPlan: { ...(weekly?.[date] || {}), teams: saturdayTeams || weekly?.[date]?.teams || [] }
  })
}

export const taskHasContent = task => Boolean(task && (
  task.historyId || task.customerId || task.serviceId ||
  ['client', 'service', 'address', 'phone', 'detail', 'internalNote'].some(key => String(task[key] || '').trim()) ||
  normalizeInternalChecklist(task.internalChecklist).some(item => item.text.trim())
))

export const serviceTimeInMinutes = time => {
  const match = String(time || '').match(/^(\d{2}):(\d{2})$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export const removeUnavailableDefaultSlots = (tasks = []) => removeOverlappingDefaultSlots(tasks, taskHasContent)

export const conflictTaskIndex = (task, index) => Number.isInteger(Number(task?._scheduleTaskIndex)) ? Number(task._scheduleTaskIndex) : index

export const conflictTaskName = (task, index) => {
  const details = [task?.service, task?.client || task?.clientAccount].map(value => String(value || '').trim()).filter(Boolean)
  return `Servicio ${conflictTaskIndex(task, index) + 1}${details.length ? ` (${details.join(' · ')})` : ''}`
}

export const conflictIntervalDescription = (task, interval) => interval.earlyCompletion
  ? `ocupó de ${interval.startTime} a ${interval.completedTime} y liberó el equipo a las ${interval.releaseTime}`
  : interval.estimatedMinutes < 60
    ? `ocupa de ${interval.startTime} a ${interval.serviceEndTime} y reserva el equipo hasta las ${interval.endTime} por la separación operativa mínima`
    : `ocupa de ${interval.startTime} a ${interval.serviceEndTime}`

export const scheduleConflictMessage = conflict => `${conflictTaskName(conflict.firstTask, conflict.firstTaskIndex)} ${conflictIntervalDescription(conflict.firstTask, conflict.first)}; ${conflictTaskName(conflict.secondTask, conflict.secondTaskIndex)} ${conflictIntervalDescription(conflict.secondTask, conflict.second)}`

export const scheduleConflictForTaskMessage = (conflict, taskIndex) => {
  const firstIndex = conflictTaskIndex(conflict.firstTask, conflict.firstTaskIndex)
  const secondIndex = conflictTaskIndex(conflict.secondTask, conflict.secondTaskIndex)
  const currentIsFirst = firstIndex === taskIndex
  const currentIsSecond = secondIndex === taskIndex
  if (!currentIsFirst && !currentIsSecond) return `No se puede agendar en este horario porque ${scheduleConflictMessage(conflict)}.`
  const currentTask = currentIsFirst ? conflict.firstTask : conflict.secondTask
  const currentInterval = currentIsFirst ? conflict.first : conflict.second
  const currentFallbackIndex = currentIsFirst ? conflict.firstTaskIndex : conflict.secondTaskIndex
  const otherTask = currentIsFirst ? conflict.secondTask : conflict.firstTask
  const otherInterval = currentIsFirst ? conflict.second : conflict.first
  const otherFallbackIndex = currentIsFirst ? conflict.secondTaskIndex : conflict.firstTaskIndex
  const currentName = conflictTaskName(currentTask, currentFallbackIndex)
  const otherName = conflictTaskName(otherTask, otherFallbackIndex)
  const currentOccupation = conflictIntervalDescription(currentTask, currentInterval).replace(/^ocupa/, 'ocuparía').replace(' y reserva ', ' y reservaría ')
  return `El ${currentName} no puede comenzar a las ${currentInterval.startTime} porque se superpone con el ${otherName}, que ${conflictIntervalDescription(otherTask, otherInterval)}. El ${currentName} ${currentOccupation}.`
}

export const planningTeamDescription = (team, teamIndex) => {
  const members = (team?.members || []).map(name => String(name || '').trim()).filter(Boolean)
  const memberList = members.length < 2 ? members[0] : `${members.slice(0, -1).join(', ')} y ${members.at(-1)}`
  return memberList ? `El equipo conformado por ${memberList}` : `El ${team?.label || `Equipo ${teamIndex + 1}`}`
}

export const planningConflictMessage = (date, team, teamIndex, conflict) => `${planningTeamDescription(team, teamIndex)} del ${prettyDate(date).replace(/^./, character => character.toLowerCase())} tiene un conflicto de horarios: ${scheduleConflictMessage(conflict)}.`

export const DEFAULT_SERVICE_TIME_CHANGE_DATE = '2026-09-01'

export const fallbackDefaultServiceTimesForDate = date => String(date || '') >= DEFAULT_SERVICE_TIME_CHANGE_DATE
  ? ['09:00', '14:00']
  : ['08:30', '13:00']

export const validDefaultServiceTimes = times => Array.isArray(times) && times.length === 2 && times.every(time => /^\d{2}:\d{2}$/.test(String(time || ''))) && times[0] !== times[1]

export const monthlyDefaultTimePeriods = (config = {}, month = '') => {
  const savedPeriods = Array.isArray(config?.defaultTimePeriods)
    ? config.defaultTimePeriods
      .filter(period => String(period?.from || '').startsWith(`${month}-`) && validDefaultServiceTimes(period?.times))
      .map(period => ({ from: period.from, times: [...period.times] }))
      .sort((first, second) => first.from.localeCompare(second.from))
    : []
  if (savedPeriods.length) return savedPeriods
  return validDefaultServiceTimes(config?.defaultTimes)
    ? [{ from: `${month}-01`, times: [...config.defaultTimes] }]
    : []
}

export const defaultServiceTimesForDate = (date, weekly = {}) => {
  const month = String(date || '').slice(0, 7)
  const periods = monthlyDefaultTimePeriods(weekly?._monthlyTeams?.[month], month)
  const configured = periods.filter(period => period.from <= date).at(-1)?.times
  return validDefaultServiceTimes(configured) ? configured : fallbackDefaultServiceTimesForDate(date)
}

export const defaultServiceTasksForDate = () => []

export const alignDefaultServiceTimes = (teams = [], date = '', targetTimes = fallbackDefaultServiceTimesForDate(date), sourceTimes = ['08:30', '13:00']) => {
  if (!validDefaultServiceTimes(targetTimes) || !validDefaultServiceTimes(sourceTimes)) return teams
  const replacements = Object.fromEntries(sourceTimes.map((time, index) => [time, targetTimes[index]]))
  return teams.map(team => ({
    ...team,
    tasks: (team.tasks || []).map(task => (!taskHasContent(task) && !task.manualSlot && replacements[task.time])
      ? { ...task, time: replacements[task.time] }
      : task)
  }))
}

export const normalizedTaskValue = value => String(value || '').trim().toLocaleLowerCase('es')

export const taskOccurrenceIdentity = task => {
  if (!taskHasContent(task)) return ''
  const customer = normalizedTaskValue(task?.customerId || task?.clientAccount || task?.account || task?.client)
  const service = normalizedTaskValue(task?.serviceId || task?.service)
  const time = normalizedTaskValue(task?.time || task?.scheduledTime)
  return customer && service && time ? `occurrence:${customer}|${service}|${time}` : ''
}

export const taskIdentityAliases = task => {
  const time = normalizedTaskValue(task?.time || task?.scheduledTime)
  if (!taskHasContent(task)) return [`blank:${time}`]
  return [
    task?.historyId && `history:${task.historyId}`,
    task?.sourceHistoryId && `history:${task.sourceHistoryId}`,
    task?.taskId && `task:${task.taskId}`,
    task?.sourceTaskId && `task:${task.sourceTaskId}`,
    taskOccurrenceIdentity(task)
  ].filter(Boolean)
}

export const historyRecordForTask = (task, date, history = globalThis.__pignusHistory || []) => {
  if (!taskHasContent(task)) return null
  const directAliases = new Set([
    task?.historyId && `history:${task.historyId}`,
    task?.sourceHistoryId && `history:${task.sourceHistoryId}`,
    task?.taskId && `task:${task.taskId}`,
    task?.sourceTaskId && `task:${task.sourceTaskId}`
  ].filter(Boolean))
  const directMatch = history.find(record => (
    (task?.historyId && String(record?.id || '') === String(task.historyId)) ||
    (task?.sourceHistoryId && String(record?.id || '') === String(task.sourceHistoryId)) ||
    taskIdentityAliases(record).some(alias => directAliases.has(alias))
  ))
  if (directMatch) return directMatch
  const occurrence = taskOccurrenceIdentity(task)
  if (!occurrence) return null
  return history.find(record => String(record?.date || '') === String(date || '') && taskOccurrenceIdentity(record) === occurrence) || null
}

export const taskStatus = (task, date, history) => {
  if (!taskHasContent(task)) return ''
  const record = historyRecordForTask(task, date, history)
  return record ? (record.status || record.technicalStatus || 'Pendiente') : 'Sin guardar'
}

export const taskIsResolvedForPlanning = (task, date, history) => {
  const status = taskStatus(task, date, history)
  return ['Completado', 'Avance registrado'].includes(status) || serviceSlotReleased(historyRecordForTask(task, date, history) || task, date)
}

export const taskForScheduleOccupancy = (task, date, history) => {
  if (!taskHasContent(task)) return null
  const record = historyRecordForTask(task, date, history)
  if (serviceSlotReleased(record || task, date)) return null
  const status = record?.status || record?.technicalStatus || task?.status || task?.technicalStatus || 'Pendiente'
  if (['Completado', 'Avance registrado'].includes(status) && String(date || '') !== currentLocalDate()) return null
  if (status === 'Cancelado' && String(date || '') < currentLocalDate()) return null
  return {
    ...task,
    date,
    status,
    technicalStatus: record ? record.technicalStatus || '' : task?.technicalStatus || '',
    completedAt: record?.completedAt || task?.completedAt || '',
    technicalReportedAt: record?.journeyClosedAt || record?.technicalReportedAt || task?.technicalReportedAt || ''
  }
}

export const statusClassName = status => String(status || 'Pendiente').toLowerCase().replace(/\s/g, '-')

export const agendaServiceProgress = (record, fallbackStatus) => {
  const started = record?.startedAt ? new Date(record.startedAt) : null
  const inProgress = fallbackStatus === 'Pendiente' && !record?.technicalStatus && !record?.vehicleControl && started && Number.isFinite(started.getTime())
  return {
    status: inProgress ? 'En proceso' : record ? historyStatusLabel({ ...record, status: fallbackStatus }) : fallbackStatus,
    startedLabel: inProgress ? `Inició a las ${started.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''
  }
}

export const serviceActor = user => {
  const current = user || globalThis.__pignusCurrentUser
  return current ? { id: current.id, name: current.name || current.email || 'Usuario', role: current.role || '', at: new Date().toISOString() } : null
}

export const serviceTrace = record => ({
  ...(record?.serviceJourney ? { serviceJourney: record.serviceJourney } : {}),
  createdBy: record?.createdBy,
  subscriberReservation: Boolean(record?.subscriberReservation),
  reservationCreatedAt: record?.reservationCreatedAt,
  reservationCreatedBy: record?.reservationCreatedBy,
  reservationOriginal: record?.reservationOriginal,
  reservationLinkedAt: record?.reservationLinkedAt,
  reservationLinkedBy: record?.reservationLinkedBy
})

export const stampServiceRecord = (record, user) => {
  if (!taskHasContent(record) || !(user || globalThis.__pignusCurrentUser)) return record
  const actor = serviceActor(user)
  return { ...record, createdBy: record.createdBy || actor }
}

export const traceDate = value => value ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(value)) : ''

export const traceLines = record => {
  const created = record?.createdBy
  if (!created) return ['Registro anterior · autor original no disponible']
  return [`Cargado por: ${created.name || 'Registro anterior'}${created.role ? ` · ${created.role}` : ''}${created.at ? ` · ${traceDate(created.at)}` : ''}`]
}

export const normalizeSaturdayTeams = (teams, date = '', weekly = {}) => {
  const sourceTeams = Array.isArray(teams) ? teams : []
  const base = sourceTeams[0] || {}
  const assignedTeam = sourceTeams.find(team => team?.members?.length || team?.memberIds?.length) || base
  const member = assignedTeam.members?.[0] || ''
  const memberId = assignedTeam.memberIds?.[0] || ''
  const seen = new Set()
  const scheduledTasks = sourceTeams.flatMap(team => team?.tasks || []).filter(taskHasContent).filter(task => {
    const key = String(task.historyId || task.taskId || `${task.time}|${task.customerId || task.client}|${task.serviceId || task.service}`)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const existingBlank = sourceTeams.flatMap(team => team?.tasks || []).find(task => !taskHasContent(task))
  const tasks = scheduledTasks.length ? sortTasksByTime(scheduledTasks) : existingBlank?.manualSlot ? [existingBlank] : []
  return [{
    ...base,
    teamId: base.teamId || createTeamId(),
    label: 'Equipo 1',
    memberIds: memberId ? [memberId] : [],
    members: member ? [member] : [],
    tasks
  }]
}

export const sortHistoryByDateAndTime = (left, right) => String(right.date || '').localeCompare(String(left.date || '')) || String(left.time || left.scheduledTime || '').localeCompare(String(right.time || right.scheduledTime || ''))

export const historyAccount = value => normalizeAccountKey(value?.account || value?.clientAccount || String(value?.client || '').trim().split(/\s+/)[0] || '')

export const recordBelongsToCustomer = (record, customer) => {
  const recordCustomerId = String(record?.customerId || '')
  const customerId = String(customer?.customerId || '')
  if (recordCustomerId && customerId) return recordCustomerId === customerId
  const recordAccount = historyAccount(record)
  const customerAccount = historyAccount(customer)
  return Boolean(recordAccount && customerAccount && recordAccount === customerAccount)
}

export const serviceHistoryForCustomer = (history, customer) => (history || []).filter(record => recordBelongsToCustomer(record, customer)).sort(sortHistoryByDateAndTime)

export const technicalReporter = record => record.technicalReportedByName || (record.technicians?.length === 1 ? record.technicians[0] : record.technicians?.filter(Boolean).join(' / ')) || 'El técnico'

export const teamLabelNumber = team => Number(String(team?.label || '').match(/\d+/)?.[0]) || 0

export const mergeTeamTasks = (current = [], incoming = []) => {
  const combined = [...current, ...incoming]
  // La plantilla mensual aporta turnos vacios para mostrar disponibilidad. Si
  // la agenda guardada ya tiene un servicio real en ese horario, ese servicio
  // ocupa el turno y el placeholder no debe volver a aparecer al recargar.
  const occupiedTimes = new Set(combined
    .filter(taskHasContent)
    .map(task => String(task?.time || task?.scheduledTime || '').trim())
    .filter(Boolean))
  const seen = new Set()
  return sortTasksByTime(combined.filter(task => {
    const time = String(task?.time || task?.scheduledTime || '').trim()
    if (!taskHasContent(task) && time && occupiedTimes.has(time)) return false
    const aliases = taskIdentityAliases(task)
    if (aliases.some(alias => seen.has(alias))) return false
    aliases.forEach(alias => seen.add(alias))
    return true
  }))
}

export const mergeStoredTeamsWithDefaults = (defaults, storedTeams) => {
  const merged = defaults.map(team => ({ ...team, tasks: [...(team.tasks || [])] }))
  ;(storedTeams || []).forEach((stored, storedIndex) => {
    const storedId = String(stored?.teamId || '')
    const storedNumber = teamLabelNumber(stored)
    let targetIndex = storedId ? merged.findIndex(team => String(team.teamId || '') === storedId) : -1
    // Un ID desconocido representa un equipo agregado específicamente al día.
    // No debe absorber un equipo mensual sólo porque ambos muestran el mismo
    // número; la coincidencia por etiqueta queda reservada a datos legados sin ID.
    if (targetIndex < 0 && !storedId && storedNumber) targetIndex = merged.findIndex(team => teamLabelNumber(team) === storedNumber)
    // Compatibilidad con planes antiguos que no tenian ni ID ni numero de equipo.
    if (targetIndex < 0 && !storedId && !storedNumber && merged[storedIndex]) targetIndex = storedIndex
    if (targetIndex < 0) {
      merged.push({ ...stored, tasks: [...(stored.tasks || [])] })
      return
    }
    const base = merged[targetIndex]
    merged[targetIndex] = {
      ...base,
      ...stored,
      // La identidad y el orden de la plantilla mensual son canonicos. Esto
      // evita que un Equipo 3 guardado ocupe visualmente el lugar del Equipo 1.
      teamId: base.teamId || stored.teamId,
      label: base.label || stored.label,
      tasks: mergeTeamTasks(base.tasks, stored.tasks)
    }
  })
  return merged.map(team => ({ ...team, tasks: sortTasksByTime(team.tasks) }))
}

export const removedWeeklySlotMatches = (slot, team, teamIndex, time) => {
  const slotTime = String(slot?.time || '').trim()
  if (!slotTime || slotTime !== String(time || '').trim()) return false
  const slotTeamId = String(slot?.teamId || '')
  const teamId = String(team?.teamId || '')
  if (slotTeamId && teamId && slotTeamId === teamId) return true
  return Number(slot?.teamNumber || 0) === (teamLabelNumber(team) || teamIndex + 1)
}

export const applyRemovedWeeklySlots = (teams = [], removedSlots = []) => {
  if (!removedSlots.length) return teams
  return teams.map((team, teamIndex) => ({
    ...team,
    tasks: (team.tasks || []).filter(task => {
      if (taskHasContent(task) || task?.manualSlot) return true
      const time = task?.time || task?.scheduledTime || ''
      return !removedSlots.some(slot => removedWeeklySlotMatches(slot, team, teamIndex, time))
    })
  }))
}

export const weeklyTaskRemovalAliases = task => [
  task?.taskId && `task:${task.taskId}`,
  task?.historyId && `history:${task.historyId}`
].filter(Boolean)

export const applyRemovedWeeklyTasks = (teams = [], removedTaskIds = []) => {
  const removed = new Set((removedTaskIds || []).map(String))
  if (!removed.size) return teams
  return teams.map(team => ({
    ...team,
    tasks: (team.tasks || []).filter(task => !weeklyTaskRemovalAliases(task).some(alias => removed.has(alias)))
  }))
}

export const removedWeeklyTeamMatches = (marker, team, teamIndex) => {
  const markerTeamId = String(marker?.teamId || '').trim()
  const teamId = String(team?.teamId || '').trim()
  // Si la baja tiene identidad interna, el número visible es sólo descriptivo:
  // después de renumerar puede pertenecer legítimamente a un equipo nuevo.
  if (markerTeamId) return Boolean(teamId && markerTeamId === teamId)
  return Number(marker?.teamNumber || 0) === (teamLabelNumber(team) || teamIndex + 1)
}

export const applyRemovedWeeklyTeams = (teams = [], removedTeams = []) => {
  if (!removedTeams.length) return teams
  return teams.filter((team, teamIndex) => !removedTeams.some(marker => removedWeeklyTeamMatches(marker, team, teamIndex)))
}

export const renumberVisibleWeeklyTeams = (teams = []) => teams.map((team, teamIndex) => ({
  ...team,
  label: /^Equipo \d+$/.test(team?.label || '') ? `Equipo ${teamIndex + 1}` : team?.label
}))

export const dailyPlanWithMonthlyTeams = (day, weekly) => {
  const stored = weekly?.[day]
  const monthlyTeams = weekly?._monthlyTeams?.[day.slice(0, 7)]?.teams
  // Saturdays use the annual guard, not the ordinary monthly crews.
  if (isSaturday(day) || !monthlyTeams?.length) return stored
  const defaults = monthlyTeams.map((team, index) => ({
    teamId: team.teamId || createTeamId(),
    label: team.label || `Equipo ${index + 1}`,
    memberIds: team.memberIds || [],
    members: team.members || [],
    tasks: defaultServiceTasksForDate(day, weekly)
  }))
  const targetTimes = defaultServiceTimesForDate(day, weekly)
  const storedTeams = alignDefaultServiceTimes(stored?.teams || [], day, targetTimes, fallbackDefaultServiceTimesForDate(day))
  // Use the same identity-based merge as the weekly board. Day exceptions win;
  // removal markers are preserved for the loader to apply after this merge.
  return { ...stored, teams: mergeStoredTeamsWithDefaults(defaults, storedTeams) }
}

export const moveRecordInWeeklyAgenda = (weekly, record, nextDate, sourceDate = record?.rescheduledFrom || record?.date, activeTechs = []) => {
  if (!record?.id || !sourceDate || !nextDate) return weekly
  const removedTeams = weekly?.[nextDate]?.removedTeams || []
  const recordTeamNumber = Number(String(record.team || '').match(/\d+/)?.[0]) || 1
  if (removedTeams.some(marker => removedWeeklyTeamMatches(marker, { teamId: record.teamId, label: record.team }, recordTeamNumber - 1))) return weekly
  const removed = weekly?.[nextDate]?.removedTaskIds || []
  if (removed.includes(`history:${record.id}`) || (record.sourceTaskId && (removed.includes(`task:${record.sourceTaskId}`) || removed.includes(String(record.sourceTaskId))))) return weekly
  const matchesRecord = task => String(task.historyId || '') === String(record.id) || (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
  const persistedTask = [weekly?.[nextDate], weekly?.[sourceDate]]
    .flatMap(plan => plan?.teams || [])
    .flatMap(team => team.tasks || [])
    .find(matchesRecord)
  const removeRecord = day => day?.teams?.length ? { ...day, teams: day.teams.map(team => ({ ...team, tasks: (team.tasks || []).filter(task => !matchesRecord(task)) })) } : day
  const createDefaultTeams = date => (isSaturday(date) ? [null] : (weekly?._monthlyTeams?.[date.slice(0, 7)]?.teams || [null, null, null])).map((team, index) => ({
    // Los sábados no tienen un equipo mensual canónico. Si el día ya fue
    // materializado, conservar su ID evita un ciclo semanal ↔ Historial que
    // generaba un equipo nuevo en cada sincronización.
    teamId: team?.teamId || (isSaturday(date) ? weekly?.[date]?.teams?.[index]?.teamId : '') || createTeamId(),
    label: team?.label || `Equipo ${index + 1}`,
    memberIds: team?.memberIds || [],
    members: team?.members || [],
    tasks: isSaturday(date) ? defaultServiceTasksForDate(date, weekly).slice(0, 1) : defaultServiceTasksForDate(date, weekly)
  }))
  // Una fecha que todavía no fue editada no existe en `weekly`: su contenido se
  // dibuja a partir de los equipos mensuales. Al reprogramar hay que materializar
  // esa plantilla completa; crear `{ teams: [] }` hacía desaparecer los demás
  // equipos del día destino.
  const destinationWithDefaults = day => {
    const targetTimes = defaultServiceTimesForDate(nextDate, weekly)
    const storedTeams = alignDefaultServiceTimes(day?.teams || [], nextDate, targetTimes, fallbackDefaultServiceTimesForDate(nextDate))
    const defaults = createDefaultTeams(nextDate)
    // Monthly defaults also contain crews explicitly removed for this date.
    // A hydration repair must not recreate them (with fresh blank task IDs).
    return { ...(day || {}), teams: applyRemovedWeeklyTeams(mergeStoredTeamsWithDefaults(defaults, storedTeams), day?.removedTeams || []) }
  }
  const next = { ...(weekly || {}) }
  next[sourceDate] = removeRecord(next[sourceDate])
  const destination = removeRecord(destinationWithDefaults(next[nextDate]))
  // Una reprogramación hacia un sábado pertenece a la guardia del día destino,
  // no a la dotación que tenía el servicio cancelado en su fecha original.
  const normalizedSaturdayDestination = isSaturday(nextDate)
    ? normalizeSaturdayTeams(destination.teams, nextDate, weekly)
    : null
  const saturdayDestinationForGuard = normalizedSaturdayDestination?.[0]?.guardOverride
    ? normalizedSaturdayDestination
    : normalizedSaturdayDestination?.map((team, index) => index === 0 ? { ...team, memberIds: [], members: [] } : team)
  const destinationTeams = isSaturday(nextDate)
    ? assignGuardToEmptySaturday(saturdayDestinationForGuard, nextDate, weekly, activeTechs)
    : destination.teams
  const teams = [...(destinationTeams || [])]
  const teamNumber = Number(String(record.team || '').match(/\d+/)?.[0]) || 1
  let teamIndex = teams.findIndex(team => record.teamId && String(team.teamId || '') === String(record.teamId))
  if (teamIndex < 0 && teams[teamNumber - 1]) teamIndex = teamNumber - 1
  if (teamIndex < 0) {
    teamIndex = teams.length
    teams.push({ teamId: record.teamId || createTeamId(), label: record.team || `Equipo ${teamNumber}`, memberIds: record.technicianIds || [], members: record.technicians || [], tasks: [] })
  }
  const task = rescheduledAgendaTask(record, persistedTask)
  const currentTasks = teams[teamIndex].tasks || []
  const emptyAtSameTime = currentTasks.findIndex(item => item.time === task.time && !item.customerId && !String(item.client || '').trim() && !item.serviceId && !String(item.service || '').trim())
  const sameCustomer = item => {
    if (task.customerId && item.customerId) return String(item.customerId) === String(task.customerId)
    const taskAccount = normalizeAccountKey(task.clientAccount || String(task.client || '').split(/\s+/)[0])
    const itemAccount = normalizeAccountKey(item.clientAccount || String(item.client || '').split(/\s+/)[0])
    if (taskAccount && itemAccount && /^(PIG|CLI)-?\d+$/i.test(taskAccount) && /^(PIG|CLI)-?\d+$/i.test(itemAccount)) return taskAccount === itemAccount
    return normalizeSearchText(task.clientNameAtService || task.client) === normalizeSearchText(item.clientNameAtService || item.client)
  }
  // Si alguien cargó manualmente la misma visita y luego otro usuario la
  // reprograma desde Historial, prevalece el registro reprogramado. Solamente se
  // reemplaza cuando coinciden equipo, hora y cliente; otro cliente nunca se pisa.
  const duplicateAtSameTime = currentTasks.findIndex(item => item.time === task.time && sameCustomer(item))
  const replaceIndex = duplicateAtSameTime >= 0 ? duplicateAtSameTime : emptyAtSameTime
  const mergedTasks = replaceIndex >= 0
    ? currentTasks.map((item, index) => index === replaceIndex ? task : item)
    : [...currentTasks, task]
  // La dotacion del equipo destino es la que debe prevalecer. Una visita puede
  // reprogramarse con menos (o distintos) tecnicos que los del dia original.
  // Solo heredamos la asignacion anterior cuando el equipo destino esta vacio.
  const destinationHasTechnicians = (teams[teamIndex].memberIds || []).length > 0 || (teams[teamIndex].members || []).length > 0
  teams[teamIndex] = {
    ...teams[teamIndex],
    teamId: teams[teamIndex].teamId || record.teamId || createTeamId(),
    memberIds: destinationHasTechnicians ? (teams[teamIndex].memberIds || []) : (record.technicianIds || []),
    members: destinationHasTechnicians ? (teams[teamIndex].members || []) : (record.technicians || []),
    tasks: sortTasksByTime(mergedTasks)
  }
  next[nextDate] = { ...destination, teams: isSaturday(nextDate) ? normalizeSaturdayTeams(teams, nextDate, weekly) : teams }
  return next
}

export function dayAgendaPreview(date, teams, services, history = [], includeUnconfirmed = false) {
  const serviceForTask = task => resolveServiceForTask(task, services)
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
  const taskMessage = task => `${journeyLabel(task, history) ? journeyLabel(task, history) + '\n' : ''}🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${task.awaitingConfirmation === true ? '\n🟡 *(A CONFIRMAR)*' : ''}${task.subscriberReservation ? '\n🟡 *Reserva de nuevo abonado · PIG pendiente*' : ''}${previewDetails(task)}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}`
  const teamMessage = (team, index) => `👥 *${team.label || `Equipo ${index + 1}`}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.filter(taskHasContent).map(taskMessage).join('\n\n')}`
  const messageSections = teams.flatMap((team, index) => {
    const tasks = includeUnconfirmed ? team.tasks.filter(taskHasContent) : agendaPreviewTasks(team.tasks.filter(taskHasContent))
    return tasks.length ? [teamMessage({ ...team, tasks }, index)] : []
  })
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${messageSections.join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  return message
}

export const taskOccupiedTimeLabel = (task, hours) => {
  const interval = taskOccupiedInterval(task, hours)
  return interval ? `${interval.startTime}–${interval.serviceEndTime}` : ''
}

export const taskMoveScheduleState = (day, task, weekly = {}, teamId = '') => {
  const hours = planningHoursForDay(day, weekly, teamId)
  const interval = taskOccupiedInterval(task, hours)
  if (!hours) return { hours, interval, valid: false, message: 'La fecha seleccionada no tiene una jornada laboral habilitada.' }
  if (!interval) return { hours, interval, valid: false, message: 'Indicá una hora y un tiempo estimado válidos.' }
  const outside = interval.start < serviceTimeInMinutes(hours.min) || interval.serviceEnd > serviceTimeInMinutes(hours.max)
  return {
    hours,
    interval,
    valid: !outside,
    message: outside ? `La franja ${interval.startTime}–${interval.serviceEndTime} excede el horario habilitado (${hours.label}). Ajustá la hora o el tiempo estimado.` : ''
  }
}

export const prettyReportDateTime = value => value ? `${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value))}, ${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))} Hs` : ''

export function technicianTimeConflicts(teams, employees = []) {
  const bookings = new Map()
  teams.forEach((team, teamIndex) => {
    const employeeIds = team.memberIds || []
    const employeeNames = team.members || []
    ;(team.tasks || []).filter(task => task.time && [task.service, task.customerId, task.client].some(value => String(value || '').trim())).forEach(task => {
      const taskEmployeeIds = task.vehicleControl && task.technicianIds?.length ? task.technicianIds : employeeIds
      const taskEmployeeNames = task.vehicleControl && task.technicians?.length ? task.technicians : employeeNames
      const technicians = taskEmployeeIds.length
        ? taskEmployeeIds.map(id => ({ key: String(id), name: employees.find(employee => String(employee.id) === String(id))?.name || taskEmployeeNames[taskEmployeeIds.findIndex(value => String(value) === String(id))] || 'Técnico' }))
        : taskEmployeeNames.map(name => ({ key: `name:${normalizeSearchText(name)}`, name }))
      technicians.forEach(technician => {
        const key = `${technician.key}|${task.time}`
        const current = bookings.get(key) || { name: technician.name, time: task.time, teams: [] }
        current.teams.push(teamIndex + 1)
        bookings.set(key, current)
      })
    })
  })
  return [...bookings.values()]
    .map(item => ({ ...item, teams: [...new Set(item.teams)] }))
    .filter(item => item.teams.length > 1)
}
