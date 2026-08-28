import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/ui/Icon.jsx'
import { HelpShell } from './HelpCenter.jsx'
import { visibleAnnualMonthLabels } from './annual-chart.mjs'
import { reportDownloadName, triggerBrowserDownload } from './browser-download.mjs'
import { filterTechnicianHistory, technicianTeamLabel } from './technician-history.mjs'
import { AUTH_LOGIN_TIMEOUT_MS, fetchAuthWithRetry, fetchWithTimeout } from './fetch-timeout.mjs'
import { sortOperationalHistory } from './history-order.mjs'
import { submitTechnicianStatus } from './technician-status.mjs'
import { countYearToDateAlarmInstallations, countYearToDateCompletedRecords } from './dashboard-metrics.mjs'
import { advancedSaturdayGuardMessage, findAdvancedSaturdayGuard, suppressAdvancedSaturdayAvailability } from './weekend-guard.mjs'
import { annualGuardForDate, DEFAULT_2026_GUARD_ROTATION, firstSaturdayOfYear } from './annual-guards.mjs'
import { monthlyTeamRotation } from './monthly-team-rotation.mjs'
import { holidayDecisionForDate, holidayDecisionLabel, holidayForDate, holidayIsBlocked } from './holidays.mjs'
import './weekly.css'
import './weekly-enhancements.css'

const currentLocalDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
import './ui-polish.css'
import './login.css'

function RequiredLabel({ children }) {
  return <span className="field-label-text">{children}<span className="required-mark" aria-hidden="true">*</span></span>
}

function useNationalHolidays(years) {
  const yearKey = [...new Set((years || []).filter(Boolean).map(String))].sort().join(',')
  const [state, setState] = useState({ key: '', records: [], loading: true, error: '' })
  useEffect(() => {
    const requestedYears = yearKey.split(',').filter(Boolean)
    if (!requestedYears.length) { setState({ key: yearKey, records: [], loading: false, error: '' }); return undefined }
    let active = true
    setState(previous => ({ ...previous, key: yearKey, loading: true, error: '' }))
    Promise.all(requestedYears.map(async year => {
      const response = await fetchWithTimeout(`/api/holidays?year=${encodeURIComponent(year)}`, { cache: 'no-store', credentials: 'same-origin' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'No se pudo consultar el calendario de feriados.')
      return payload.holidays || []
    })).then(groups => {
      if (active) setState({ key: yearKey, records: groups.flat(), loading: false, error: '' })
    }).catch(error => {
      if (active) setState({ key: yearKey, records: [], loading: false, error: error.message })
    })
    return () => { active = false }
  }, [yearKey])
  return state.key === yearKey ? state : { records: [], loading: true, error: '' }
}

function HolidayDecisionPanel({ holiday, decision, canDecide, onDecision, compact = false }) {
  if (!holiday) return null
  const status = holidayDecisionLabel(decision)
  return <section className={`holiday-decision ${compact ? 'compact' : ''} ${decision?.status || 'pending'}`} role="status"><div className="holiday-decision-icon"><Icon name="calendar" size={20} /></div><div className="holiday-decision-copy"><p className="eyebrow">FERIADO NACIONAL · {status.toUpperCase()}</p><h3>{holiday.name}</h3><p>{decision?.status === 'working' ? 'La fecha fue habilitada como jornada laboral y admite servicios normalmente.' : decision?.status === 'closed' ? 'La fecha fue definida como no operativa. La agenda permanece bloqueada.' : 'Antes de cargar servicios, definí si la empresa trabajará durante este feriado.'}</p>{decision?.decidedByName && <small>Definido por {decision.decidedByName}.</small>}</div>{canDecide ? <div className="holiday-decision-actions"><button type="button" className={decision?.status === 'working' ? 'primary' : 'secondary'} onClick={() => onDecision('working')}><Icon name="check" size={16} />Día laboral</button><button type="button" className={decision?.status === 'closed' ? 'danger-button' : 'secondary'} onClick={() => onDecision('closed')}><Icon name="lock" size={16} />Día no operativo</button></div> : !decision && <small className="holiday-admin-note">Pendiente de definición por un administrador.</small>}</section>
}

function recordHolidayDecision(setWeekly, setNotice, date, holiday, status) {
  const user = globalThis.__pignusCurrentUser
  if (user?.roleCode !== 'administrator') {
    setNotice('Solamente un administrador puede definir la operación durante un feriado.')
    return
  }
  setWeekly(previous => ({
    ...previous,
    _holidayOverrides: {
      ...(previous?._holidayOverrides || {}),
      [date]: {
        status,
        holidayName: holiday?.name || 'Feriado nacional',
        decidedAt: new Date().toISOString(),
        decidedById: user.id,
        decidedByName: user.name
      }
    }
  }))
  setNotice(status === 'working' ? `${prettyDate(date)} quedó habilitado como día laboral.` : `${prettyDate(date)} quedó definido como día no operativo.`)
}

const copyTextToClipboard = async text => {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Algunos navegadores móviles bloquean la API moderna aun bajo HTTPS.
  }
  if (!globalThis.document?.body) return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.append(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

const INSTALLATION_ZONES = [
  ['docta', 'Docta Urbanización'],
  ['nobu-town', 'Nobu Town'],
  ['residencial', 'Residencial']
]
// Identificador interno e inmutable del servicio. No depende del cliente, hora ni
// equipo, que pueden cambiar durante la planificación sin crear otro historial.
const createTaskId = () => globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`
const createTeamId = () => globalThis.crypto?.randomUUID?.() || `team-${Date.now()}-${Math.random().toString(36).slice(2)}`
const blankTask = () => ({ taskId: createTaskId(), time: '', serviceId: '', service: '', customerId: '', client: '', clientAccount: '', clientNameAtService: '', address: '', phone: '', detail: '', paymentMethod: '', amount: '', monthlyFee: '', form: '' })
const taskTimeInMinutes = task => {
  const value = String(task?.time || task?.scheduledTime || '').trim()
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}
const sortTasksByTime = tasks => [...(tasks || [])].sort((left, right) => {
  const leftMinutes = taskTimeInMinutes(left)
  const rightMinutes = taskTimeInMinutes(right)
  if (leftMinutes === null && rightMinutes === null) return 0
  if (leftMinutes === null) return 1
  if (rightMinutes === null) return -1
  return leftMinutes - rightMinutes
})
const sortPlanTasksByTime = plan => ({
  ...plan,
  teams: (plan?.teams || []).map(team => ({ ...team, tasks: sortTasksByTime(team.tasks) }))
})
const isSaturday = date => Boolean(date) && new Date(`${date}T12:00:00`).getDay() === 6
const default2026GuardRotationFor = activeTechs => {
  const rotation = DEFAULT_2026_GUARD_ROTATION.map(tokens => activeTechs.find(tech => {
    const normalized = normalizeServiceName(tech.name)
    return tokens.every(token => normalized.includes(token))
  })).filter(Boolean)
  return rotation.length === DEFAULT_2026_GUARD_ROTATION.length
    ? rotation.map(tech => ({ technicianId: tech.id, name: tech.name }))
    : []
}
const guardForDateWithDefaults = (date, weekly, activeTechs) => {
  const configured = annualGuardForDate(date, weekly)
  if (configured) return configured
  const rotation = String(date || '').startsWith('2026-') ? default2026GuardRotationFor(activeTechs) : []
  return rotation.length ? annualGuardForDate(date, { _annualGuards: { 2026: { startDate: firstSaturdayOfYear(2026), rotation } } }) : null
}
const assignGuardToEmptySaturday = (teams, date, weekly, activeTechs) => {
  if (!isSaturday(date) || !teams?.length || teams.some(team => team?.members?.length || team?.memberIds?.length)) return teams
  const guard = guardForDateWithDefaults(date, weekly, activeTechs)
  if (!guard) return teams
  const technician = activeTechs.find(tech => String(tech.id) === String(guard.technicianId)) || activeTechs.find(tech => normalizeServiceName(tech.name) === normalizeServiceName(guard.name))
  const name = technician?.name || guard.name
  const technicianId = technician?.id || guard.technicianId
  if (!name) return teams
  return teams.map((team, index) => index === 0 ? { ...team, memberIds: technicianId ? [technicianId] : [], members: [name] } : team)
}
const advancedGuardForSaturdayDate = (date, weekly, saturdayTeams) => {
  if (!isSaturday(date)) return null
  const friday = new Date(`${date}T12:00:00`)
  friday.setDate(friday.getDate() - 1)
  const fridayKey = friday.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  return findAdvancedSaturdayGuard({
    fridayPlan: weekly?.[fridayKey],
    saturdayPlan: { ...(weekly?.[date] || {}), teams: saturdayTeams || weekly?.[date]?.teams || [] }
  })
}
const taskHasContent = task => Boolean(task && (
  task.historyId || task.customerId || task.serviceId ||
  ['client', 'service', 'address', 'phone', 'detail'].some(key => String(task[key] || '').trim())
))
const DEFAULT_SERVICE_TIME_CHANGE_DATE = '2026-09-01'
const fallbackDefaultServiceTimesForDate = date => String(date || '') >= DEFAULT_SERVICE_TIME_CHANGE_DATE
  ? ['09:00', '14:00']
  : ['08:30', '13:00']
const validDefaultServiceTimes = times => Array.isArray(times) && times.length === 2 && times.every(time => /^\d{2}:\d{2}$/.test(String(time || ''))) && times[0] !== times[1]
const defaultServiceTimesForDate = (date, weekly = {}) => {
  const configured = weekly?._monthlyTeams?.[String(date || '').slice(0, 7)]?.defaultTimes
  return validDefaultServiceTimes(configured) ? configured : fallbackDefaultServiceTimesForDate(date)
}
const defaultServiceTasksForDate = (date, weekly) => defaultServiceTimesForDate(date, weekly).map(time => ({ ...blankTask(), time }))
const alignDefaultServiceTimes = (teams = [], date = '', targetTimes = fallbackDefaultServiceTimesForDate(date), sourceTimes = ['08:30', '13:00']) => {
  if (!validDefaultServiceTimes(targetTimes) || !validDefaultServiceTimes(sourceTimes)) return teams
  const replacements = Object.fromEntries(sourceTimes.map((time, index) => [time, targetTimes[index]]))
  return teams.map(team => ({
    ...team,
    tasks: (team.tasks || []).map(task => (!taskHasContent(task) && !task.manualSlot && replacements[task.time])
      ? { ...task, time: replacements[task.time] }
      : task)
  }))
}
const applyMonthlyDefaultTimes = (weekly = {}, month = '', sourceTimes, targetTimes) => Object.fromEntries(Object.entries(weekly || {}).map(([key, value]) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !key.startsWith(`${month}-`)) return [key, value]
  const replacements = Object.fromEntries(sourceTimes.map((time, index) => [time, targetTimes[index]]))
  return [key, {
    ...value,
    teams: alignDefaultServiceTimes(value?.teams || [], key, targetTimes, sourceTimes),
    removedSlots: (value?.removedSlots || []).map(slot => replacements[slot.time] ? { ...slot, time: replacements[slot.time] } : slot)
  }]
}))
const normalizedTaskValue = value => String(value || '').trim().toLocaleLowerCase('es')
const taskOccurrenceIdentity = task => {
  if (!taskHasContent(task)) return ''
  const customer = normalizedTaskValue(task?.customerId || task?.clientAccount || task?.account || task?.client)
  const service = normalizedTaskValue(task?.serviceId || task?.service)
  const time = normalizedTaskValue(task?.time || task?.scheduledTime)
  return customer && service && time ? `occurrence:${customer}|${service}|${time}` : ''
}
const taskIdentityAliases = task => {
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
const historyRecordForTask = (task, date, history = globalThis.__pignusHistory || []) => {
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
const taskStatus = (task, date, history) => {
  if (!taskHasContent(task)) return ''
  const record = historyRecordForTask(task, date, history)
  return record?.status || record?.technicalStatus || 'Pendiente'
}
const statusClassName = status => String(status || 'Pendiente').toLowerCase().replace(/\s/g, '-')
function TaskStatusBadge({ task, date, history, weekly = false }) {
  const status = taskStatus(task, date, history)
  if (!status) return null
  const service = String(task?.service || 'Sin tipo de servicio').trim()
  return <div className={`agenda-task-status ${weekly ? 'weekly-agenda-task-status' : 'daily-agenda-task-status'}`}><em className={`work-status ${statusClassName(status)}`}>{status}</em>{weekly && <em className={`role-chip agenda-service-chip ${serviceColorClass(service)}`} title={service}>{service}</em>}</div>
}
const serviceActor = user => {
  const current = user || globalThis.__pignusCurrentUser
  return current ? { id: current.id, name: current.name || current.email || 'Usuario', role: current.role || '', at: new Date().toISOString() } : null
}
const serviceTrace = record => ({ createdBy: record?.createdBy })
const stampServiceRecord = (record, user) => {
  if (!taskHasContent(record) || !(user || globalThis.__pignusCurrentUser)) return record
  const actor = serviceActor(user)
  return { ...record, createdBy: record.createdBy || actor }
}
const traceDate = value => value ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(value)) : ''
function ServiceTrace({ record, compact = false }) {
  const created = record?.createdBy
  if (!created) return <div className={`service-trace ${compact ? 'compact' : ''}`}><span>Registro anterior</span><small>No se dispone del autor original.</small></div>
  return <div className={`service-trace ${compact ? 'compact' : ''}`}><span><b>Cargado por:</b> {created.name || 'Registro anterior'}{created.role ? ` · ${created.role}` : ''}{created.at ? ` · ${traceDate(created.at)}` : ''}</span></div>
}
const serviceTraceMarkup = record => taskHasContent(record) ? <ServiceTrace record={record} compact /> : null
const traceLines = record => {
  const created = record?.createdBy
  if (!created) return ['Registro anterior · autor original no disponible']
  return [`Cargado por: ${created.name || 'Registro anterior'}${created.role ? ` · ${created.role}` : ''}${created.at ? ` · ${traceDate(created.at)}` : ''}`]
}
const appendTraceElement = (container, record) => {
  if (!container || !taskHasContent(record)) return
  container.querySelector(':scope > .service-trace')?.remove()
  const trace = document.createElement('div')
  trace.className = 'service-trace compact'
  traceLines(record).forEach(line => { const span = document.createElement('span'); span.textContent = line; trace.append(span) })
  container.append(trace)
}
// Los sábados opera un único técnico. Los servicios que pudieran existir en
// equipos históricos se consolidan sin perderlos y se elimina cualquier
// tarjeta vacía que compita con un servicio real del mismo horario.
const normalizeSaturdayTeams = (teams, date = '', weekly = {}) => {
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
  const saturdayDefaultTime = defaultServiceTimesForDate(date, weekly)[0]
  const existingBlankTime = existingBlank?.manualSlot && existingBlank?.time ? existingBlank.time : saturdayDefaultTime
  const tasks = scheduledTasks.length ? sortTasksByTime(scheduledTasks) : [{ ...(existingBlank || blankTask()), time: existingBlankTime }]
  return [{
    ...base,
    teamId: base.teamId || createTeamId(),
    label: 'Equipo 1',
    memberIds: memberId ? [memberId] : [],
    members: member ? [member] : [],
    tasks
  }]
}
const sortHistoryByDateAndTime = (left, right) => String(right.date || '').localeCompare(String(left.date || '')) || String(left.time || left.scheduledTime || '').localeCompare(String(right.time || right.scheduledTime || ''))
const historyAccount = value => normalizeAccountKey(value?.account || value?.clientAccount || String(value?.client || '').trim().split(/\s+/)[0] || '')
const recordBelongsToCustomer = (record, customer) => {
  const recordCustomerId = String(record?.customerId || '')
  const customerId = String(customer?.customerId || '')
  if (recordCustomerId && customerId) return recordCustomerId === customerId
  const recordAccount = historyAccount(record)
  const customerAccount = historyAccount(customer)
  return Boolean(recordAccount && customerAccount && recordAccount === customerAccount)
}
const serviceHistoryForCustomer = (history, customer) => (history || []).filter(record => recordBelongsToCustomer(record, customer)).sort(sortHistoryByDateAndTime)
const technicalReporter = record => record.technicalReportedByName || (record.technicians?.length === 1 ? record.technicians[0] : record.technicians?.filter(Boolean).join(' / ')) || 'El técnico'
// La proyección gerencial considera la capacidad operativa habitual de lunes a
// viernes. Los sábados y domingos no consumen ni agregan días a la estimación.
const countBusinessDays = (year, month, throughDay) => {
  const daysInMonth = new Date(year, month, 0).getDate()
  const lastDay = Math.max(0, Math.min(Number(throughDay ?? daysInMonth), daysInMonth))
  let total = 0
  for (let day = 1; day <= lastDay; day += 1) {
    const weekday = new Date(year, month - 1, day, 12).getDay()
    if (weekday >= 1 && weekday <= 5) total += 1
  }
  return total
}
const teamLabelNumber = team => Number(String(team?.label || '').match(/\d+/)?.[0]) || 0
const mergeTeamTasks = (current = [], incoming = []) => {
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
const mergeStoredTeamsWithDefaults = (defaults, storedTeams) => {
  const merged = defaults.map(team => ({ ...team, tasks: [...(team.tasks || [])] }))
  ;(storedTeams || []).forEach((stored, storedIndex) => {
    const storedId = String(stored?.teamId || '')
    const storedNumber = teamLabelNumber(stored)
    let targetIndex = storedId ? merged.findIndex(team => String(team.teamId || '') === storedId) : -1
    if (targetIndex < 0 && storedNumber) targetIndex = merged.findIndex(team => teamLabelNumber(team) === storedNumber)
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

const removedWeeklySlotMatches = (slot, team, teamIndex, time) => {
  const slotTime = String(slot?.time || '').trim()
  if (!slotTime || slotTime !== String(time || '').trim()) return false
  const slotTeamId = String(slot?.teamId || '')
  const teamId = String(team?.teamId || '')
  if (slotTeamId && teamId && slotTeamId === teamId) return true
  return Number(slot?.teamNumber || 0) === (teamLabelNumber(team) || teamIndex + 1)
}

const applyRemovedWeeklySlots = (teams = [], removedSlots = []) => {
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

const appendRemovedWeeklySlot = (removedSlots = [], team, teamIndex, time) => {
  const marker = {
    teamId: team?.teamId || '',
    teamNumber: teamLabelNumber(team) || teamIndex + 1,
    time: String(time || '').trim()
  }
  if (!marker.time) return removedSlots
  if (removedSlots.some(slot => removedWeeklySlotMatches(slot, team, teamIndex, marker.time))) return removedSlots
  return [...removedSlots, marker]
}
const moveRecordInWeeklyAgenda = (weekly, record, nextDate, sourceDate = record?.rescheduledFrom || record?.date) => {
  if (!record?.id || !sourceDate || !nextDate) return weekly
  const matchesRecord = task => String(task.historyId || '') === String(record.id) || (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
  const removeRecord = day => day?.teams?.length ? { ...day, teams: day.teams.map(team => ({ ...team, tasks: (team.tasks || []).filter(task => !matchesRecord(task)) })) } : day
  const createDefaultTeams = date => (isSaturday(date) ? [null] : (weekly?._monthlyTeams?.[date.slice(0, 7)]?.teams || [null, null, null])).map((team, index) => ({
    teamId: team?.teamId || createTeamId(),
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
    return { ...(day || {}), teams: mergeStoredTeamsWithDefaults(defaults, storedTeams) }
  }
  const next = { ...(weekly || {}) }
  next[sourceDate] = removeRecord(next[sourceDate])
  const destination = removeRecord(destinationWithDefaults(next[nextDate]))
  const teams = [...(destination.teams || [])]
  const teamNumber = Number(String(record.team || '').match(/\d+/)?.[0]) || 1
  let teamIndex = teams.findIndex(team => record.teamId && String(team.teamId || '') === String(record.teamId))
  if (teamIndex < 0 && teams[teamNumber - 1]) teamIndex = teamNumber - 1
  if (teamIndex < 0) {
    teamIndex = teams.length
    teams.push({ teamId: record.teamId || createTeamId(), label: record.team || `Equipo ${teamNumber}`, memberIds: record.technicianIds || [], members: record.technicians || [], tasks: [] })
  }
  const task = { taskId: record.sourceTaskId || record.id, historyId: record.id, time: record.time || record.scheduledTime || '', serviceId: record.serviceId || '', service: record.service || '', customerId: record.customerId || '', client: record.client || '', clientAccount: record.clientAccount || record.account || '', clientNameAtService: record.clientNameAtService || '', address: record.address || '', phone: record.phone || '', detail: record.detail || '', paymentMethod: record.paymentMethod || '', amount: record.amount || '', monthlyFee: record.monthlyFee || '', form: record.form || '', installationZone: record.installationZone || '', ...serviceTrace(record) }
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
const blankEmployee = { firstName: '', lastName: '', name: '', roleId: 3, role: 'Técnico', phone: '', email: '', password: '', status: 'Activo' }
const blankCustomer = { customerId: '', kind: 'client', account: '', name: '', type: '', street: '', locality: '', province: '', phone: '', address: '', fields: {} }

// El navegador conserva únicamente preferencias visuales. Los datos operativos
// siempre se cargan desde la API después de autenticar la sesión y nunca deben
// sobrevivir al cierre de sesión ni mezclarse entre usuarios del mismo equipo.
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

// Dealer/Cuenta is the external system's unique customer identifier. Keeping a
// canonical form prevents duplicated clients when an export changes its casing
// or accidentally includes whitespace around the account code.
const normalizeAccountKey = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '')
const createCustomerId = () => globalThis.crypto?.randomUUID?.() || `customer-${Date.now()}-${Math.random().toString(36).slice(2)}`
const customerKind = customer => customer?.kind === 'subscriber' || String(customer?.account || '').toUpperCase().startsWith('PIG-') ? 'subscriber' : 'client'
const customerKindLabel = customer => customerKind(customer) === 'subscriber' ? 'Abonado' : 'Cliente'
const nextCustomerCode = (customers, kind) => {
  const prefix = kind === 'subscriber' ? 'PIG' : 'CLI'
  const highest = customers.reduce((max, customer) => {
    const match = String(customer.account || '').toUpperCase().match(new RegExp(`^${prefix}-(\\d+)$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`
}
// Catálogo único: evita que un módulo quede fuera de la matriz de permisos.
const MODULE_PERMISSIONS = [
  ['dashboard', 'Menú principal', 'Ver indicadores y resumen operativo'],
  ['weekly', 'Agenda semanal', 'Planificar los servicios de toda la semana'],
  ['agenda', 'Agenda del día', 'Crear y editar equipos y servicios'],
  ['history', 'Historial', 'Consultar y gestionar trabajos registrados'],
  ['accounts', 'Abonados y clientes', 'Consultar y administrar abonados y clientes'],
  ['employees', 'Empleados', 'Administrar técnicos y accesos'],
  ['services', 'Tipo de servicio', 'Administrar el catálogo de servicios'],
  ['vehicles', 'Vehículos', 'Administrar la flota de la empresa'],
  ['settings', 'Configuración', 'Modificar roles y permisos'],
  ['audit', 'Auditoría', 'Consultar acciones y accesos del sistema']
]
const DEFAULT_MODULE_PERMISSIONS = Object.fromEntries(MODULE_PERMISSIONS.map(([key]) => [key, false]))

// Versión histórica preservada temporalmente durante la migración a components/ui/Icon.jsx.
function LegacyIcon({ name, size = 18 }) {
  const paths = { menu: 'M3 6h18M3 12h18M3 18h18', calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18-8a4 4 0 1 0 0-8m-2 2a4 4 0 1 0-8 0', accounts: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5', settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-13v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.7-1.4 1.4M6.7 17.3l-1.4 1.4m13.4 0-1.4-1.4M6.7 6.7 5.3 5.3', copy: 'M9 8h10v12H9zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6', plus: 'M12 5v14M5 12h14', edit: 'm4 16.5-.5 4 4-.5L19 8.5l-3.5-3.5L4 16.5ZM13.5 7l3.5 3.5', trash: 'M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14', upload: 'M12 16V3m0 0L7 8m5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5', search: 'm21 21-4.5-4.5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0', moon: 'M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z', sun: 'M12 3v2m0 14v2M3 12h2m14 0h2m-3.6-5.4 1.4-1.4M5.2 18.8l1.4-1.4m0-10.8L5.2 5.2m13.6 13.6-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', close: 'M6 6l12 12M18 6 6 18', check: 'm5 12 4 4L19 6', lock: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5z' }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.settings} /></svg>
}
const initials = name => name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase()
const normalizeRoleName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const roleCode = role => role?.code || ({ administrador: 'administrator', tecnico: 'technician', coordinador: 'coordinator', usuario: 'user' }[normalizeRoleName(role?.name)] || `role-${role?.id}`)
const normalizeServiceName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
// Las búsquedas operativas no dependen de tildes, mayúsculas, espacios ni
// signos. "instalacion", "Instalación" y "INSTALACION" son equivalentes.
const normalizeSearchText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es')
  .replace(/[^a-z0-9]/g, '')
const normalizeCustomerName = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR')

function CustomerAutocomplete({ value = '', customerId = '', customers = [], onTextCommit, onCustomerSelect, className = '' }) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => setQuery(value || ''), [value])

  const normalizedQuery = normalizeSearchText(query)
  const selectedCustomer = customers.find(customer => String(customer.customerId || '') === String(customerId || ''))
  const selectedLabel = selectedCustomer ? `${selectedCustomer.account} ${selectedCustomer.name}` : ''
  const selectionIsIntact = Boolean(selectedCustomer) && normalizeSearchText(selectedLabel) === normalizedQuery
  const suggestions = useMemo(() => {
    if (normalizedQuery.length < 2 || selectionIsIntact) return []
    return customers
      .map(customer => {
        const searchable = normalizeSearchText(`${customer.account} ${customer.name}`)
        const account = normalizeSearchText(customer.account)
        const name = normalizeSearchText(customer.name)
        const priority = account.startsWith(normalizedQuery) ? 0 : name.startsWith(normalizedQuery) ? 1 : searchable.includes(normalizedQuery) ? 2 : 3
        return { customer, priority }
      })
      .filter(item => item.priority < 3)
      .sort((left, right) => left.priority - right.priority || String(left.customer.name).localeCompare(String(right.customer.name), 'es'))
      .slice(0, 12)
      .map(item => item.customer)
  }, [customers, normalizedQuery, selectionIsIntact])

  useEffect(() => setActiveIndex(-1), [normalizedQuery])

  const choose = customer => {
    setQuery(`${customer.account} ${customer.name}`)
    setOpen(false)
    setActiveIndex(-1)
    onCustomerSelect(customer)
  }
  const commitText = () => {
    const exact = customers.find(customer => [customer.account, customer.name, `${customer.account} ${customer.name}`, `${customer.name} ${customer.account}`]
      .some(label => normalizeSearchText(label) === normalizedQuery))
    if (exact) choose(exact)
    else if (query !== value) onTextCommit(query)
  }
  const handleKeyDown = event => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(index => Math.min(index + 1, suggestions.length - 1))
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const customer = suggestions[activeIndex >= 0 ? activeIndex : 0]
      if (customer) choose(customer)
      else commitText()
    } else if (event.key === 'Escape') {
      setQuery(value || '')
      setOpen(false)
    }
  }

  const showResults = open && normalizedQuery.length >= 2 && !selectionIsIntact
  return <div className={`customer-autocomplete ${className}`.trim()}>
    <label><RequiredLabel>Cliente o cuenta</RequiredLabel></label>
    <div className="customer-autocomplete-control">
      <input autoComplete="off" spellCheck={false} role="combobox" aria-required="true" aria-autocomplete="list" aria-expanded={showResults} placeholder="Buscá por nombre o cuenta" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true) }} onKeyDown={handleKeyDown} onBlur={() => { commitText(); setOpen(false) }} />
      <span aria-hidden="true">⌄</span>
    </div>
    {showResults && <div className="customer-autocomplete-results" role="listbox">
      {suggestions.map((customer, index) => <button type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'active' : ''} key={customer.customerId || customer.account} onMouseDown={event => { event.preventDefault(); choose(customer) }}><strong>{customer.account}</strong><span>{customer.name}</span></button>)}
      {!suggestions.length && <p>No encontramos coincidencias. Podés seguir escribiendo para registrar un cliente nuevo.</p>}
    </div>}
  </div>
}

const serviceCode = service => service?.code || (normalizeServiceName(service?.name) === 'instalacion de alarma' ? 'alarm-installation' : `service-${service?.id}`)
const PAYMENT_SERVICE_NAMES = new Set([
  'instalacion de camara',
  'instalacion de camaras',
  'instalacion de cerco electrico',
  'service de alarma',
  'service de camara',
  'service de camaras',
  'service de cerco electrico',
  'otro service'
])
const FORM_OPTIONS = ['Completo', 'Incompleto (Abonado completa a mano)']
const PAYMENT_OPTIONS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'A confirmar', 'No aplica']
const normalizeCurrencyAmount = value => {
  const input = String(value ?? '').trim().replace(/[^\d.,]/g, '')
  if (!input) return ''
  const normalized = input.includes(',') ? input.replace(/\./g, '').replace(',', '.') : input
  const [integerPart = '', ...decimalParts] = normalized.split('.')
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0'
  const decimals = decimalParts.join('').slice(0, 2)
  return decimalParts.length ? `${integer}.${decimals}` : integer
}
const formatCurrencyAmount = value => {
  const normalized = normalizeCurrencyAmount(value)
  if (!normalized) return ''
  const amount = Number(normalized)
  if (!Number.isFinite(amount)) return ''
  const hasDecimals = normalized.includes('.') && Number(normalized.split('.')[1] || 0) !== 0
  return `$ ${amount.toLocaleString('es-AR', { minimumFractionDigits: hasDecimals ? 2 : 0, maximumFractionDigits: 2 })}`
}
const normalizeFormValue = value => {
  const normalized = normalizeServiceName(value)
  if (normalized === 'completo') return FORM_OPTIONS[0]
  if (normalized.startsWith('incompleto')) return FORM_OPTIONS[1]
  return ''
}
const serviceExtraAvailability = (service, installationZone = '') => {
  const alarmInstallation = serviceCode(service) === 'alarm-installation'
  const residentialAlarm = alarmInstallation && installationZone === 'residencial'
  const ownershipChange = normalizeServiceName(service?.name).includes('titularidad')
  return {
    paymentMethod: residentialAlarm || PAYMENT_SERVICE_NAMES.has(normalizeServiceName(service?.name)),
    monthlyFee: residentialAlarm,
    form: alarmInstallation || ownershipChange
  }
}
const applicableServiceExtras = (task, service) => {
  const available = serviceExtraAvailability(service, task?.installationZone)
  const paymentMethod = available.paymentMethod ? task?.paymentMethod || '' : ''
  return {
    paymentMethod,
    amount: paymentMethod && paymentMethod !== 'No aplica' ? task?.amount || '' : '',
    monthlyFee: available.monthlyFee ? task?.monthlyFee || '' : '',
    form: available.form ? normalizeFormValue(task?.form) : ''
  }
}
const requiresPaymentAmount = (task, service) => {
  const paymentMethod = serviceExtraAvailability(service, task?.installationZone).paymentMethod ? String(task?.paymentMethod || '').trim() : ''
  return Boolean(paymentMethod && !['A confirmar', 'No aplica'].includes(paymentMethod) && !String(task?.amount || '').trim())
}
const weeklyTaskMissingFields = (task, service) => {
  const missing = [['hora', task?.time], ['tipo de servicio', task?.service], ['cliente', task?.customerId], ['dirección', task?.address], ['contacto', task?.phone], ['detalle', task?.detail]]
    .filter(([, value]) => !String(value || '').trim())
    .map(([label]) => label)
  if (serviceCode(service) === 'alarm-installation' && !task?.installationZone) missing.push('ubicación de la instalación')
  if (requiresPaymentAmount(task, service)) missing.push('monto')
  return missing
}
const weeklyTaskReadyToSave = (task, team, service) => taskHasContent(task) && weeklyTaskMissingFields(task, service).length === 0 && (team?.members || []).length > 0
const prettyDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^./, x => x.toUpperCase()) : ''
// Cada familia de trabajo tiene un color consistente en el historial para facilitar su lectura.
const serviceColorClass = service => {
  const normalized = String(service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (normalized.includes('retiro')) return 'service-retirement'
  if (normalized.includes('titularidad')) return 'service-ownership'
  if (normalized.includes('camara')) return 'service-cameras'
  if (normalized.includes('cerco')) return 'service-fence'
  if (normalized.includes('alarma')) return 'service-alarm'
  if (normalized.includes('relevamiento')) return 'service-survey'
  if (normalized.includes('ampliacion') || normalized.includes('mejora')) return 'service-upgrade'
  return 'service-other'
}
// Unifica el horario operativo en Argentina aunque el servidor guarde fechas en UTC.
const prettyReportDateTime = value => value ? `${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value))}, ${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))} Hs` : ''
function showAgendaValidationModal(missing) {
  document.getElementById('agenda-validation-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-validation-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Completá los campos obligatorios'
  const detail = document.createElement('p'); detail.textContent = 'Antes de guardar o copiar la agenda, revisá los siguientes servicios:'
  const list = document.createElement('ul'); list.className = 'validation-list'
  missing.forEach(item => { const entry = document.createElement('li'); entry.textContent = item; list.append(entry) })
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const close = document.createElement('button'); close.className = 'primary'; close.type = 'button'; close.textContent = 'Entendido'; close.onclick = () => layer.remove()
  actions.append(close); modal.append(icon, title, detail, list, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}

// Advertencia previa: permite detectar equipos sin técnicos antes de guardar o copiar.
function showMissingTechniciansModal(teamNumbers, onContinue) {
  document.getElementById('agenda-technicians-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-technicians-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Técnicos sin asignar'
  const detail = document.createElement('p'); detail.textContent = `La asignación de al menos un técnico es obligatoria. ${teamNumbers.join(', ')} no tiene técnicos asignados.`
  const note = document.createElement('p'); note.className = 'modal-helper'; note.textContent = 'Podés volver para asignarlos o continuar excepcionalmente bajo tu responsabilidad.'
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const cancel = document.createElement('button'); cancel.className = 'secondary'; cancel.type = 'button'; cancel.textContent = 'Volver y asignar'; cancel.onclick = () => layer.remove()
  actions.append(cancel); modal.append(icon, title, detail, note, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}

// Evita asignaciones dobles accidentales, sin impedir los casos operativos en que sí son necesarias.
function showDuplicateTechniciansModal(duplicates, availableTechnicians, onCorrect, onContinue) {
  document.getElementById('agenda-duplicates-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-duplicates-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal duplicate-technicians-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Técnicos asignados en más de un equipo'
  const detail = document.createElement('p'); detail.textContent = duplicates.map(item => `${item.name}: ${item.teams.map(team => `Equipo ${team + 1}`).join(' y ')}`).join('. ')
  const helper = document.createElement('p'); helper.className = 'modal-helper'; helper.textContent = availableTechnicians.length ? 'Podés reemplazar las asignaciones repetidas por técnicos aún disponibles.' : 'No hay técnicos disponibles para reemplazar las asignaciones repetidas.'
  const replacements = []
  if (availableTechnicians.length) duplicates.forEach(item => item.teams.slice(1).forEach(teamIndex => {
    const field = document.createElement('label'); field.textContent = `Reemplazar a ${item.name} en Equipo ${teamIndex + 1}`
    const select = document.createElement('select')
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Seleccionar técnico'; select.append(placeholder)
    availableTechnicians.forEach(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option) })
    field.append(select); modal.append(field)
    replacements.push({ teamIndex, name: item.name, select })
  }))
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const correct = document.createElement('button'); correct.className = 'secondary'; correct.type = 'button'; correct.textContent = 'Corregir asignación'; correct.disabled = !availableTechnicians.length
  correct.onclick = () => { const changes = replacements.filter(item => item.select.value).map(item => ({ teamIndex: item.teamIndex, name: item.name, replacement: item.select.value })); if (!changes.length) return; layer.remove(); onCorrect(changes) }
  const proceed = document.createElement('button'); proceed.className = 'primary'; proceed.type = 'button'; proceed.textContent = 'Continuar de todos modos'; proceed.onclick = () => { layer.remove(); onContinue() }
  // Sin técnicos disponibles, el botón permite volver a la agenda para corregir manualmente.
  correct.disabled = false
  correct.onclick = () => {
    if (!availableTechnicians.length) { layer.remove(); return }
    const changes = replacements.filter(item => item.select.value).map(item => ({ teamIndex: item.teamIndex, name: item.name, replacement: item.select.value }))
    if (!changes.length) return
    layer.remove(); onCorrect(changes)
  }
  actions.append(correct, proceed); modal.append(icon, title, detail, helper, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}

// Un técnico puede integrar distintos equipos durante el día. Sólo existe un
// conflicto cuando tiene servicios reales a la misma hora en equipos distintos.
function technicianTimeConflicts(teams, employees = []) {
  const bookings = new Map()
  teams.forEach((team, teamIndex) => {
    const employeeIds = team.memberIds || []
    const employeeNames = team.members || []
    ;(team.tasks || []).filter(task => task.time && [task.service, task.customerId, task.client].some(value => String(value || '').trim())).forEach(task => {
      const technicians = employeeIds.length
        ? employeeIds.map(id => ({ key: String(id), name: employees.find(employee => String(employee.id) === String(id))?.name || employeeNames[employeeIds.findIndex(value => String(value) === String(id))] || 'Técnico' }))
        : employeeNames.map(name => ({ key: `name:${normalizeSearchText(name)}`, name }))
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

/** Pantalla aislada de autenticación; la contraseña sólo viaja al endpoint de acceso. */
function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [requestingReset, setRequestingReset] = useState(false)
  const submit = async event => {
    event.preventDefault()
    // Safari puede mostrar valores autocompletados antes de sincronizarlos con
    // React. Leer el formulario al enviar garantiza que viajen esos valores.
    const form = event.currentTarget
    const submittedEmail = form.elements.email.value.trim()
    const submittedPassword = form.elements.password.value
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      const response = await fetchWithTimeout('/api/auth/login', { credentials: 'same-origin', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: submittedEmail, password: submittedPassword }) }, AUTH_LOGIN_TIMEOUT_MS)
      const data = await response.json().catch(() => ({ error: 'La base de datos todavía está iniciando. Esperá un momento e intentá nuevamente.' }))
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.')
      setPassword('')
      onLogin(data.user)
    } catch (loginError) { setError(loginError.message) }
    finally { setSubmitting(false) }
  }
  const requestPasswordReset = async () => {
    setError(''); setMessage('')
    if (!email.trim()) return setError('Ingresá tu correo electrónico para solicitar el cambio de contraseña.')
    setRequestingReset(true)
    try {
      const response = await fetchWithTimeout('/api/auth/password-reset-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const data = await response.json().catch(() => ({ error: 'No se pudo registrar la solicitud.' }))
      if (!response.ok) throw new Error(data.error || 'No se pudo registrar la solicitud.')
      setMessage(data.message || 'La solicitud fue enviada al Administrador.')
    } catch (requestError) { setError(requestError.message) }
    finally { setRequestingReset(false) }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}><img src="/logo-pignus.png" alt="Pignus" /><p className="eyebrow">ACCESO SEGURO</p><h1>Ingresá a Agenda técnica</h1><p>Usá el correo y la contraseña definidos en el módulo Empleados.</p><label htmlFor="login-email"><RequiredLabel>Correo electrónico</RequiredLabel><input id="login-email" name="email" required autoCapitalize="none" autoCorrect="off" autoComplete="username" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label htmlFor="login-password"><RequiredLabel>Contraseña</RequiredLabel></label><div className="password-field"><input id="login-password" name="password" aria-label="Contraseña" required autoComplete="current-password" minLength="8" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name="eye" size={17} /><span>{showPassword ? 'Ocultar' : 'Mostrar'}</span></button></div><button type="button" className="forgot-password" disabled={requestingReset || submitting} onClick={requestPasswordReset}>{requestingReset ? 'Enviando solicitud...' : 'Olvidé mi contraseña'}</button>{error && <p className="login-error" role="alert">{error}</p>}{message && <p className="login-success" role="status">{message}</p>}<button className="primary" disabled={submitting || requestingReset}>{submitting ? 'Verificando acceso...' : 'Iniciar sesión'}</button><small>El acceso se cierra automáticamente al finalizar la sesión.</small></form></main>
}

export default function App() {
  const [module, setModule] = useState('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLocalValue('pignus-sidebar-collapsed') === 'true')
  const [desktopSidebar, setDesktopSidebar] = useState(() => globalThis.matchMedia?.('(min-width: 641px)').matches ?? true)
  const [theme, setTheme] = useState(() => readLocalValue('pignus-theme', 'light'))
  const [roles, setRoles] = useState([])
  const [employees, setEmployees] = useState([])
  const [services, setServices] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [history, setHistory] = useState([])
  const [customers, setCustomers] = useState([])
  const [teams, setTeams] = useState(() => [{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }])
  const [date, setDate] = useState(currentLocalDate)
  const [weekly, setWeekly] = useState({})
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [databaseReady, setDatabaseReady] = useState(false)
  const [stateRevision, setStateRevision] = useState(null)
  const stateRevisionRef = useRef(null)
  const pendingStateSaves = useRef(0)
  const stateSaveQueue = useRef(Promise.resolve())
  const stateSaveTimerRef = useRef(null)
  const loggingOutRef = useRef(false)
  const hydratingStateRef = useRef(false)
  const hydrationTimerRef = useRef(null)
  const lastPersistedSnapshotRef = useRef(null)
  const currentSnapshotRef = useRef(null)
  const remoteConflictRevisionRef = useRef(null)
  const [authUser, setAuthUser] = useState(null)
  globalThis.__pignusCurrentUser = authUser
  globalThis.__pignusHistory = history
  globalThis.__pignusSetHistory = setHistory
  const [authLoading, setAuthLoading] = useState(true)
  const [databaseError, setDatabaseError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const stateSnapshot = { roles, employees, services, vehicles, history, customers, agenda: { date, teams, weekly }, preferences: { theme } }
  const serializedStateSnapshot = JSON.stringify(stateSnapshot)
  currentSnapshotRef.current = serializedStateSnapshot
  useEffect(() => writeLocalValue('pignus-theme', theme), [theme])
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => writeLocalValue('pignus-sidebar-collapsed', sidebarCollapsed), [sidebarCollapsed])
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
    const media = window.matchMedia('(min-width: 641px)')
    const syncSidebarMode = () => setDesktopSidebar(media.matches)
    syncSidebarMode()
    media.addEventListener('change', syncSidebarMode)
    return () => media.removeEventListener('change', syncSidebarMode)
  }, [])
  useEffect(clearOperationalStorage, [])
  useEffect(() => {
    if (!services.length) return
    const normalizeReference = item => {
      const matched = services.find(service => String(service.id) === String(item.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(item.service))
      return matched && (String(item.serviceId) !== String(matched.id) || item.service !== matched.name) ? { ...item, serviceId: matched.id, service: matched.name } : item
    }
    const normalizeTeams = value => (value || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeReference); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [services])
  useEffect(() => {
    if (!customers.length) return
    const normalizedCustomers = customers.map(customer => ({ ...customer, customerId: customer.customerId || createCustomerId(), kind: customerKind(customer), name: normalizeCustomerName(customer.name) }))
    if (normalizedCustomers.some((customer, index) => JSON.stringify(customer) !== JSON.stringify(customers[index]))) {
      setCustomers(normalizedCustomers)
      return
    }
    const byId = new Map(normalizedCustomers.map(customer => [String(customer.customerId), customer]))
    const byAccount = new Map(normalizedCustomers.map(customer => [normalizeAccountKey(customer.account), customer]))
    const normalizeReference = item => {
      const matched = byId.get(String(item.customerId || '')) || byAccount.get(normalizeAccountKey(item.clientAccount))
      return matched && (String(item.customerId) !== String(matched.customerId) || item.clientAccount !== matched.account)
        ? { ...item, customerId: matched.customerId, clientAccount: matched.account }
        : item
    }
    const normalizeTeams = value => (value || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeReference) }))
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeReference); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [customers])
  useEffect(() => {
    const completedRetirementCustomerIds = new Set(history
      .filter(record => record.status === 'Completado' && normalizeServiceName(record.service).includes('retiro de equipo'))
      .map(record => String(record.customerId || ''))
      .filter(Boolean))
    if (!completedRetirementCustomerIds.size) return
    setCustomers(previous => {
      let next = previous
      let changed = false
      previous.forEach(customer => {
        if (customerKind(customer) !== 'subscriber' || !completedRetirementCustomerIds.has(String(customer.customerId))) return
        const account = nextCustomerCode(next, 'client')
        next = next.map(item => item.customerId === customer.customerId ? { ...item, kind: 'client', account, type: 'Cliente de servicio', convertedFromAccount: item.account, subscriptionEndedAt: new Date().toISOString() } : item)
        changed = true
      })
      return changed ? next : previous
    })
  }, [history])
  useEffect(() => {
    if (!employees.length) return
    const byId = new Map(employees.map(employee => [String(employee.id), employee]))
    const byName = new Map(employees.map(employee => [normalizeServiceName(employee.name), employee]))
    const normalizeAssignments = item => {
      const assigned = [...new Map([...(item.memberIds || item.technicianIds || []).map(id => byId.get(String(id))), ...(item.members || item.technicians || []).map(name => byName.get(normalizeServiceName(name)))].filter(Boolean).map(employee => [String(employee.id), employee])).values()]
      if ('tasks' in item) return { ...item, teamId: item.teamId || createTeamId(), memberIds: assigned.map(employee => employee.id), members: assigned.map(employee => employee.name) }
      return { ...item, technicianIds: assigned.map(employee => employee.id), technicians: assigned.map(employee => employee.name) }
    }
    const normalizeTeams = teams => (teams || []).map(normalizeAssignments)
    setTeams(previous => { const next = normalizeTeams(previous); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setWeekly(previous => { const next = Object.fromEntries(Object.entries(previous || {}).map(([key, value]) => key === '_monthlyTeams' ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: normalizeTeams(config?.teams) }]))] : [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }])); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
    setHistory(previous => { const next = previous.map(normalizeAssignments); return JSON.stringify(next) === JSON.stringify(previous) ? previous : next })
  }, [employees])
  useEffect(() => {
    fetchAuthWithRetry('/api/auth/session', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => setAuthUser(data?.user || null)).catch(() => setAuthUser(null)).finally(() => setAuthLoading(false))
  }, [])
  useEffect(() => {
    const brand = document.querySelector('.brand')
    const goToDashboard = () => setModule('dashboard')
    brand?.addEventListener('click', goToDashboard)
    return () => brand?.removeEventListener('click', goToDashboard)
  }, [])
  useEffect(() => {
    // El menú compacto conserva los accesos por icono y libera espacio de trabajo.
    const shell = document.querySelector('.app-shell')
    const sidebar = shell?.querySelector('.sidebar')
    if (!shell || !sidebar) return undefined
    shell.classList.toggle('sidebar-collapsed', desktopSidebar && sidebarCollapsed)
    sidebar.classList.toggle('sidebar-compact', desktopSidebar && sidebarCollapsed)
    // En móvil el único control del menú es el botón hamburguesa.
    if (!desktopSidebar) return undefined
    const control = document.createElement('button')
    control.type = 'button'
    control.className = `sidebar-collapse-toggle ${sidebarCollapsed ? 'is-collapsed' : ''}`
    // Estilos críticos en línea: el control no depende del orden de las hojas de estilo.
    Object.assign(control.style, {
      position: 'absolute', top: '16px', left: '100%', transform: 'translateX(-50%)',
      zIndex: '20', placeItems: 'center', width: '34px', height: '34px',
      padding: '0', border: '1px solid #54705e', borderRadius: '50%', background: '#1b412d',
      color: '#fff', fontSize: '22px', lineHeight: '1', boxShadow: '0 3px 9px rgba(5, 26, 14, .25)'
    })
    control.setAttribute('aria-label', sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral')
    control.title = sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'
    control.textContent = sidebarCollapsed ? '›' : '‹'
    const toggle = event => { event.preventDefault(); event.stopPropagation(); setSidebarCollapsed(value => !value) }
    control.addEventListener('click', toggle)
    sidebar.querySelectorAll('nav button').forEach(button => { button.title = button.textContent.trim() })
    // Se ubica dentro de la barra: así se mantiene alineado con su borde al cambiar el ancho.
    sidebar.append(control)
    return () => { control.removeEventListener('click', toggle); control.remove() }
  }, [desktopSidebar, sidebarCollapsed])
  useEffect(() => {
    const goToHistory = () => setModule('history')
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
  }, [module, notice])
  useEffect(() => {
    // Mantiene sincronizada la agenda abierta cuando se corrige un servicio desde Historial.
    const syncAgendaService = event => {
      const { record, patch } = event.detail || {}
      if (!record || !patch) return
      const legacyTeamIndex = Number(String(record.team || '').match(/\d+/)?.[0]) - 1
      setTeams(previous => previous.map((team, index) => (record.teamId ? String(team.teamId) !== String(record.teamId) : index !== legacyTeamIndex) ? team : {
        ...team,
        memberIds: patch.technicianIds || team.memberIds,
        members: patch.technicians || team.members,
        tasks: team.tasks.map(task => {
          const sameTask = record.sourceTaskId ? String(task.taskId) === String(record.sourceTaskId) : task.historyId ? String(task.historyId) === String(record.id) : task.client === record.client && task.service === record.service
          return sameTask ? { ...task, customerId: patch.customerId ?? task.customerId, clientAccount: patch.clientAccount ?? task.clientAccount, client: patch.client ?? task.client, serviceId: patch.serviceId ?? task.serviceId, service: patch.service ?? task.service, address: patch.address ?? task.address, phone: patch.phone ?? task.phone, detail: patch.detail ?? task.detail } : task
        })
      }))
    }
    window.addEventListener('pignus:sync-agenda-service', syncAgendaService)
    return () => window.removeEventListener('pignus:sync-agenda-service', syncAgendaService)
  }, [])
  useEffect(() => {
    const moveWeeklyService = event => {
      const { record, nextDate, sourceDate } = event.detail || {}
      if (!record || !nextDate) return
      setWeekly(previous => moveRecordInWeeklyAgenda(previous, record, nextDate, sourceDate))
    }
    window.addEventListener('pignus:reschedule-service', moveWeeklyService)
    return () => window.removeEventListener('pignus:reschedule-service', moveWeeklyService)
  }, [])
  useEffect(() => {
    // Repara reprogramaciones anteriores que pudieron quedar copiadas en ambos
    // dias. La identidad del servicio (historyId/taskId) permite quitar solamente
    // el origen sin alterar los restantes equipos ni sus visitas.
    const rescheduled = history.filter(record => record.rescheduledFrom && record.date && record.rescheduledFrom !== record.date)
    if (!rescheduled.length) return
    setWeekly(previous => {
      const next = rescheduled.reduce(
        (current, record) => moveRecordInWeeklyAgenda(current, record, record.date, record.rescheduledFrom),
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
  }, [history, date])
  useEffect(() => {
    // Historial debe reflejar la dotacion real del equipo del dia destino, no la
    // dotacion que tenia el servicio antes de ser reprogramado.
    setHistory(previous => {
      let changed = false
      const next = previous.map(record => {
        const day = weekly?.[record.date]
        const assignedTeam = day?.teams?.find(team => (team.tasks || []).some(task =>
          String(task.historyId || '') === String(record.id) ||
          (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
        ))
        if (!assignedTeam) return record
        const technicianIds = assignedTeam.memberIds || []
        const technicians = assignedTeam.members || []
        const sameAssignment =
          String(record.teamId || '') === String(assignedTeam.teamId || '') &&
          record.team === assignedTeam.label &&
          JSON.stringify(record.technicianIds || []) === JSON.stringify(technicianIds) &&
          JSON.stringify(record.technicians || []) === JSON.stringify(technicians)
        if (sameAssignment) return record
        changed = true
        return { ...record, teamId: assignedTeam.teamId || '', team: assignedTeam.label || record.team, technicianIds, technicians }
      })
      return changed ? next : previous
    })
  }, [weekly])
  useEffect(() => {
    const removeWeeklyService = event => {
      const { day, taskId, historyId } = event.detail || {}
      if (!day || (!taskId && !historyId)) return
      const matches = task => (taskId && String(task.taskId || '') === String(taskId)) || (historyId && String(task.historyId || '') === String(historyId))
      if (day === date) setTeams(previous => previous.map(team => ({ ...team, tasks: (team.tasks || []).filter(task => !matches(task)) })))
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
          serviceId: draft.serviceId,
          service: draft.service,
          customerId: draft.customerId,
          client: draft.client,
          clientAccount: draft.clientAccount,
          clientNameAtService: draft.clientNameAtService,
          address: draft.address,
           phone: draft.phone,
           detail: draft.detail,
           paymentMethod: draft.paymentMethod || '',
           amount: draft.amount || '',
           monthlyFee: draft.monthlyFee || '',
           form: draft.form || '',
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
          team: teamSnapshot?.label || `Equipo ${teamIndex + 1}`,
          teamId: teamId || teamSnapshot?.teamId || '',
          technicianIds: teamSnapshot?.memberIds || [],
          technicians: teamSnapshot?.members || [],
          serviceId: draft.serviceId || '',
          service: draft.service || '',
          customerId: draft.customerId || '',
          client: draft.client || '',
          clientAccount: draft.clientAccount || '',
          clientNameAtService: draft.clientNameAtService || String(draft.client || '').replace(/^[^\s]+\s+/, ''),
          address: draft.address || '',
           phone: draft.phone || '',
           detail: draft.detail || '',
           paymentMethod: draft.paymentMethod || '',
           amount: draft.amount || '',
           monthlyFee: draft.monthlyFee || '',
           form: draft.form || '',
           installationZone: draft.installationZone || '',
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
  }, [weekly, date])
  const applyRemoteState = data => {
    hydratingStateRef.current = true
    remoteConflictRevisionRef.current = null
    stateRevisionRef.current = Number(data.revision || 0)
    setStateRevision(stateRevisionRef.current)
    const loadedRoles = Array.isArray(data.roles) ? data.roles.map(role => { const code = roleCode(role); return { ...role, code, permissions: { ...DEFAULT_MODULE_PERMISSIONS, dashboard: true, weekly: role.permissions?.weekly ?? ['administrator', 'user', 'coordinator'].includes(code), ...role.permissions, ...(code === 'administrator' ? Object.fromEntries(MODULE_PERMISSIONS.map(([key]) => [key, true])) : {}) } } }) : []
    setRoles(loadedRoles)
    setEmployees(Array.isArray(data.employees) ? data.employees.map(employee => { const assignedRole = loadedRoles.find(role => String(role.id) === String(employee.roleId)) || loadedRoles.find(role => normalizeRoleName(role.name) === normalizeRoleName(employee.role)); return assignedRole ? { ...employee, roleId: assignedRole.id, role: assignedRole.name } : employee }) : [])
    setServices(Array.isArray(data.services) ? data.services.map(service => ({ ...service, code: serviceCode(service), category: service.category || (normalizeServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service') })) : [])
    setVehicles(Array.isArray(data.vehicles) ? data.vehicles : [])
    setHistory(Array.isArray(data.history) ? data.history : [])
    setCustomers(Array.isArray(data.customers) ? data.customers.map(customer => ({ ...customer, customerId: customer.customerId || createCustomerId(), kind: customerKind(customer), name: normalizeCustomerName(customer.name) })) : [])
    setTeams(data.agenda?.teams?.length ? data.agenda.teams : [{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }])
    setDate(currentLocalDate())
    setWeekly(data.agenda?.weekly && typeof data.agenda.weekly === 'object' ? data.agenda.weekly : {})
    if (data.preferences?.theme) setTheme(data.preferences.theme)
    setDatabaseReady(true)
  }
  useEffect(() => {
    if (!authUser) return
    hydratingStateRef.current = true
    lastPersistedSnapshotRef.current = null
    remoteConflictRevisionRef.current = null
    setDatabaseReady(false)
    setDatabaseError('')
    stateRevisionRef.current = null
    setStateRevision(null)
    setRoles([]); setEmployees([]); setServices([]); setVehicles([]); setHistory([]); setCustomers([]); setWeekly({})
    setTeams([{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }])
    setDate(currentLocalDate())
    clearOperationalStorage()
    fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' }).then(async response => {
      if (response.ok) return response.json()
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'No se pudo cargar la información autorizada para esta sesión.')
    }).then(applyRemoteState).catch(error => {
      setDatabaseError(error.message || 'No se pudo conectar con la base de datos.')
    })
  }, [authUser])
  useEffect(() => {
    if (!databaseReady || !hydratingStateRef.current) return undefined
    window.clearTimeout(hydrationTimerRef.current)
    const timer = window.setTimeout(() => {
      lastPersistedSnapshotRef.current = currentSnapshotRef.current
      hydratingStateRef.current = false
      hydrationTimerRef.current = null
    }, 150)
    hydrationTimerRef.current = timer
    return () => window.clearTimeout(timer)
  }, [databaseReady, serializedStateSnapshot])
  useEffect(() => {
    if (loggingOutRef.current || hydratingStateRef.current || serializedStateSnapshot === lastPersistedSnapshotRef.current || !databaseReady || stateRevision === null || !authUser || authUser.roleCode === 'technician' || (!authUser.roleCode && normalizeRoleName(authUser.role) === 'tecnico')) return
    // Desde que existe un cambio local pendiente (incluido el debounce) se
    // bloquea la recarga periódica para que no restaure la versión anterior.
    pendingStateSaves.current += 1
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
        const response = await fetch('/api/state', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: stateRevisionRef.current, ...snapshot })
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload.error || 'No se pudieron guardar los últimos cambios.')
        }
        const payload = await response.json()
        stateRevisionRef.current = Number(payload.revision)
        lastPersistedSnapshotRef.current = serializedStateSnapshot
        remoteConflictRevisionRef.current = null
        setStateRevision(stateRevisionRef.current)
      }).catch(error => setNotice(error.message || 'No se pudieron guardar los últimos cambios.'))
        .finally(() => { pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1) })
    }, 750)
    stateSaveTimerRef.current = timer
    return () => {
      clearTimeout(timer)
      if (stateSaveTimerRef.current === timer) stateSaveTimerRef.current = null
      if (!saveStarted) pendingStateSaves.current = Math.max(0, pendingStateSaves.current - 1)
    }
  }, [databaseReady, authUser, serializedStateSnapshot])
  useEffect(() => {
    // Sincronización ligera del tablero semanal. Evita recargar la página y no pisa
    // un campo que el usuario está editando en ese momento.
    if (!databaseReady || !authUser) return undefined
    if (authUser.roleCode === 'technician' || (!authUser.roleCode && normalizeRoleName(authUser.role) === 'tecnico')) return undefined
    let refreshing = false
    let stopped = false
    const refreshWeekly = async () => {
      // Un PUT de esta misma pestaña aumenta la revisión del servidor antes de
      // que React alcance a actualizar stateRevision. No debe tratarse como un
      // cambio externo durante esa pequeña ventana.
      if (loggingOutRef.current || refreshing || pendingStateSaves.current > 0) return
      if (document.activeElement?.closest('.weekly-board input, .weekly-board select, .weekly-board textarea, .team-card input, .team-card select, .team-card textarea')) return
      refreshing = true
      try {
        const response = await fetch('/api/state/revision', { cache: 'no-store' })
        if (!response.ok) throw new Error('No se pudo consultar la revisión.')
        const data = await response.json()
        const remoteRevision = Number(data.revision)
        if (!stopped && remoteRevision !== Number(stateRevisionRef.current)) {
          const hasLocalChanges = pendingStateSaves.current > 0 || currentSnapshotRef.current !== lastPersistedSnapshotRef.current
          if (hasLocalChanges) {
            if (remoteConflictRevisionRef.current !== remoteRevision) setNotice('Hay cambios guardados desde otra sesión. Recargá la página para continuar sin sobrescribirlos.')
            remoteConflictRevisionRef.current = remoteRevision
          } else {
            const stateResponse = await fetch('/api/state', { cache: 'no-store' })
            if (!stateResponse.ok) throw new Error('No se pudo sincronizar el estado actualizado.')
            const remoteState = await stateResponse.json()
            if (!stopped) {
              applyRemoteState(remoteState)
              setNotice('La información se actualizó con los cambios de otra sesión.')
            }
          }
        } else if (remoteRevision === Number(stateRevisionRef.current)) remoteConflictRevisionRef.current = null
      } catch {
        if (!stopped) setNotice('No se pudo comprobar si existen cambios de otra sesión.')
      } finally {
        refreshing = false
      }
    }
    const timer = window.setInterval(refreshWeekly, 15000)
    window.addEventListener('focus', refreshWeekly)
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('focus', refreshWeekly) }
  }, [databaseReady, authUser, stateRevision])
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
        setTeams(previous => previous.map((currentTeam, teamIndex) => teamIndex === team
          ? { ...currentTeam, tasks: sortTasksByTime(currentTeam.tasks) }
          : currentTeam))
      }, { once: true })
    }
    setTeams(previous => previous.map((currentTeam, teamIndex) => {
      if (teamIndex !== team) return currentTeam
      const tasks = currentTeam.tasks.map((currentTask, taskIndex) => taskIndex !== task ? currentTask : stampServiceRecord({ ...currentTask, ...patch }, authUser))
      return { ...currentTeam, tasks: changesTime && !timeInput ? sortTasksByTime(tasks) : tasks }
    }))
  }
  const employeeRole = employee => roles.find(role => String(role.id) === String(employee.roleId)) || roles.find(role => normalizeRoleName(role.name) === normalizeRoleName(employee.role))
  // La capacidad técnica depende del código estable, no del nombre editable.
  const activeTechs = employees.filter(employee => employee.status === 'Activo' && roleCode(employeeRole(employee)) === 'technician')
  const isAdministrator = authUser?.roleCode === 'administrator' || (!authUser?.roleCode && normalizeRoleName(authUser?.role) === 'administrador')
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
  // Cada módulo tiene un ícono propio para facilitar el reconocimiento visual en la navegación.
  const nav = [['dashboard', 'dashboard', 'Menú principal'], ['weekly', 'calendar', 'Agenda semanal'], ['agenda', 'agenda', 'Agenda del día'], ['history', 'history', 'Historial'], ['accounts', 'accounts', 'Abonados y clientes'], ['employees', 'users', 'Empleados'], ['services', 'tools', 'Tipo de servicio'], ['vehicles', 'vehicle', 'Vehículos'], ['settings', 'settings', 'Configuración']]
  const activeRole = roles.find(role => String(role.id) === String(authUser?.roleId)) || roles.find(role => role.name === authUser?.role)
  const modulePermissions = { ...DEFAULT_MODULE_PERMISSIONS, dashboard: true, help: true, ...activeRole?.permissions }
  if (!isAdministrator) {
    for (let index = nav.length - 1; index >= 0; index -= 1) if (!modulePermissions[nav[index][0]]) nav.splice(index, 1)
  }
  useEffect(() => {
    if (!isAdministrator && !modulePermissions[module] && nav[0]) setModule(nav[0][0])
  }, [isAdministrator, module, activeRole?.id])
  const title = { dashboard: 'Menú principal', weekly: 'Agenda semanal', agenda: 'Agenda del día', history: 'Historial', accounts: 'Abonados y clientes', employees: 'Empleados', services: 'Tipo de servicio', vehicles: 'Vehículos', settings: 'Configuración', audit: 'Auditoría', help: 'Centro de ayuda' }[module]
  useEffect(() => {
    document.title = authUser ? `${title || 'Agenda técnica'} | PIGNUS` : 'Ingresar | PIGNUS'
  }, [title, authUser])
  if (isAdministrator) nav.push(['audit', 'audit', 'Auditoría'])
  nav.push(['help', 'help', 'Centro de ayuda'])
  const emptyAgenda = () => ({ date: new Date().toISOString().slice(0, 10), teams: [{ teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }] })
  // Una agenda se considera pendiente cuando tiene datos que todavía no quedaron registrados en Historial.
  const hasUnsavedAgenda = teams.some((team, teamIndex) => {
    const membersChanged = team.members.length > 0 && !history.some(record => record.date === date && record.team === `Equipo ${teamIndex + 1}` && JSON.stringify(record.technicians || []) === JSON.stringify(team.members))
    const hasPendingTask = team.tasks.some(task => Object.values(task).some(Boolean) && !history.some(record => record.date === date && record.team === `Equipo ${teamIndex + 1}` && record.time === task.time && record.service === task.service && record.client === task.client && record.address === task.address && record.phone === task.phone && record.detail === task.detail))
    return membersChanged || hasPendingTask
  })
  const logout = async () => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    setLoggingOut(true)
    if (stateSaveTimerRef.current) {
      clearTimeout(stateSaveTimerRef.current)
      stateSaveTimerRef.current = null
      pendingStateSaves.current = 0
    }
    await stateSaveQueue.current.catch(() => {})

    // La agenda temporal no debe permanecer disponible para la próxima sesión.
    if (authUser?.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() !== 'tecnico') {
      if (databaseReady) {
        try {
          const response = await fetch('/api/agenda/daily/clear', { method: 'POST' })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload.error || 'No se pudo limpiar la agenda del día.')
          stateRevisionRef.current = Number(payload.revision)
        } catch (error) {
          console.error('No se pudo limpiar la agenda antes de cerrar sesión.', error)
        }
      }
      const clean = emptyAgenda()
      setTeams(clean.teams); setDate(clean.date)
    }
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('No se pudo invalidar la sesión en el servidor.')
    } catch (error) {
      console.error('Error al cerrar la sesión en el servidor.', error)
    } finally {
      clearOperationalStorage()
      setRoles([]); setEmployees([]); setServices([]); setVehicles([]); setHistory([]); setCustomers([]); setWeekly({})
      setAuthUser(null); setDatabaseReady(false); setDatabaseError(''); setStateRevision(null); setModule('dashboard')
      loggingOutRef.current = false
      setLoggingOut(false)
    }
  }
  const requestLogout = () => setConfirmation(hasUnsavedAgenda
    ? { title: 'Agenda sin guardar', detail: 'Hay servicios cargados que aún no fueron guardados en el historial. Si cerrás sesión, la agenda se limpiará y esos datos se perderán.', action: logout, destructive: true, confirmLabel: 'Cerrar sesión y descartar agenda' }
    : { title: 'Cerrar sesión', detail: '¿Querés cerrar sesión? La agenda se limpiará para dejar el sistema listo para una nueva sesión.', action: logout, confirmLabel: 'Sí, cerrar sesión' })
  useEffect(() => {
    // Intercepta el botón común del encabezado para aplicar la verificación de agenda antes de salir.
    const button = document.querySelector('.topbar .logout-button')
    if (!button) return undefined
    const intercept = event => { event.preventDefault(); event.stopPropagation(); requestLogout() }
    button.addEventListener('click', intercept, true)
    return () => button.removeEventListener('click', intercept, true)
  })
  if (loggingOut) return <main className="login-page"><div className="login-loading">Cerrando sesión segura…</div></main>
  if (authLoading) return <main className="login-page"><div className="login-loading">Verificando sesión segura…</div></main>
  if (!authUser) return <Login onLogin={setAuthUser} />
  if (!databaseReady) return <main className="login-page"><div className="login-card"><img src="/logo-pignus.png" alt="Pignus" /><p className="eyebrow">DATOS PROTEGIDOS</p><h1>{databaseError ? 'No se pudo cargar la agenda' : 'Cargando información autorizada…'}</h1>{databaseError && <><p className="login-error" role="alert">{databaseError}</p><button className="primary" type="button" onClick={() => { setDatabaseError(''); setAuthUser(current => current ? { ...current } : current) }}>Reintentar</button><button className="secondary" type="button" onClick={logout}>Cerrar sesión</button></>}</div></main>
  if (authUser.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'tecnico') return <TechnicianPortal user={authUser} history={history} setHistory={setHistory} logout={logout} />
  if (module === 'help') return <HelpShell user={authUser} onNavigate={setModule} logout={logout} theme={theme} setTheme={setTheme} isAdministrator={isAdministrator} navigation={nav} />
  if (module === 'audit' && isAdministrator) return <AuditShell user={authUser} onNavigate={setModule} logout={logout} theme={theme} setTheme={setTheme} navigation={nav} />
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><div className="profile-menu"><button className="profile-trigger" onClick={() => setProfileOpen(open => !open)} aria-expanded={profileOpen}><span className="profile-avatar">{initials(authUser.name)}</span><span>{authUser.name}</span></button>{profileOpen && <div className="profile-popover"><b>{authUser.name}</b><span>{authUser.email}</span><small>{authUser.role}</small></div>}</div><button className="logout-button" onClick={() => setConfirmation({ title: 'Cerrar sesión', detail: '¿Querés cerrar sesión? Tendrás que volver a ingresar con tus credenciales para acceder al sistema.', action: logout, confirmLabel: 'Sí, cerrar sesión' })} title="Cerrar sesión"><Icon name="logout" size={17} /><span>Cerrar sesión</span></button></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'dashboard' && <Dashboard history={history} services={services} />}{module === 'weekly' && <WeeklyPlanner weekly={weekly} setWeekly={setWeekly} customers={customers} services={services} activeTechs={activeTechs} setNotice={setNotice} openDaily={(nextDate, nextTeams) => { setDate(nextDate); setTeams(nextTeams); setModule('agenda') }} />}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }} />}{module === 'history' && <History history={history} setHistory={setHistory} customers={customers} services={services} employees={employees} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask, history, teams, weekly }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask, history, teams, weekly }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask, history, teams, weekly }} />}{module === 'vehicles' && <Vehicles {...{ vehicles, setVehicles, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask, employees }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'dashboard' && <Dashboard history={history} services={services} />}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice }} />}{module === 'history' && <History history={history} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice }} />}{module === 'history' && <History history={history} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, services, updateTask, setNotice }} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'services' && <ServiceTypes {...{ services, setServices, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
  return <div className="app-shell" data-theme={theme}><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{nav.map(([id, icon, label]) => <button key={id} onClick={() => { setModule(id); setMenuOpen(false) }} className={module === id ? 'active' : ''}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i></i><b>{title}</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">LR</span><span>Leonardo Rodríguez</span></div></header><section className="content">{notice && <div className="notice"><span><Icon name="check" size={16} />{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{module === 'agenda' && <Agenda {...{ date, setDate, teams, setTeams, activeTechs, customers, updateTask, setNotice }} />}{module === 'accounts' && <Accounts {...{ customers, setCustomers, setNotice, ask }} />}{module === 'employees' && <Employees {...{ employees, setEmployees, roles, setNotice, ask }} />}{module === 'settings' && <Settings {...{ roles, setRoles, setNotice, ask }} />}</section></main>{confirmation && <Confirm {...confirmation} close={() => setConfirmation(null)} />}</div>
}

function Agenda({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady, authUser }) {
  const SERVICES = services.filter(service => service.status === 'Activo').map(service => service.name)
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
  return <AgendaLayout {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }} />
  return <>{techOpen !== null && <button className="picker-backdrop" aria-label="Cerrar selector de técnicos" onClick={() => setTechOpen(null)} />}<div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(agendaText); setNotice('La agenda fue copiada al portapapeles.') }}><Icon name="copy" />Copiar agenda</button></div></div>{!customers.length && <p className="helper">Todavía no hay clientes importados. Podés cargarlos desde <b>Administrador de cuentas</b>.</p>}<div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, ti) => <article className="team-card" key={ti}><div className="team-header"><div><span className="team-number">{ti + 1}</span><strong>Equipo {ti + 1}</strong></div><div className="technicians-picker"><span>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</span><button className="secondary small" onClick={() => { setTechOpen(techOpen === ti ? null : ti); setTechFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === ti && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={techFilter} onChange={e => setTechFilter(e.target.value)} /><div className="tech-list">{activeTechs.filter(t => t.name.toLowerCase().includes(techFilter.toLowerCase())).map(t => <label key={t.id}><input type="checkbox" checked={team.members.includes(t.name)} onChange={() => toggleTech(ti, t.name)} />{t.name}</label>)}{!activeTechs.length && <p>No hay técnicos activos.</p>}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, i) => <div className="task-row" key={i}><div className="task-title"><span>{i + 1}</span><b>Servicio</b></div><label>Hora<input type="time" value={task.time} onChange={e => updateTask(ti, i, { time: e.target.value })} /></label><label>Tipo de servicio<select value={task.service} onChange={e => updateTask(ti, i, { service: e.target.value })}><option value="">Seleccionar</option>{SERVICES.map(x => <option key={x}>{x}</option>)}</select></label>
<label>Cliente o cuenta<input list="customer-options" placeholder="Buscá por nombre o cuenta" value={task.client} onChange={e => chooseCustomer(ti, i, e.target.value)} /><datalist id="customer-options">{customers.map(c => <option key={c.account} value={`${c.name} · ${c.account}`} />)}</datalist></label>
<label>Dirección<input value={task.address} onChange={e => updateTask(ti, i, { address: e.target.value })} /></label><label>Contacto<input value={task.phone} onChange={e => updateTask(ti, i, { phone: e.target.value })} /></label><label className="observations">Observaciones<textarea value={task.detail} onChange={e => updateTask(ti, i, { detail: e.target.value })} /></label>{team.tasks.length > 1 && <button className="icon-btn delete" onClick={() => setTeams(prev => prev.map((t, x) => x !== ti ? t : { ...t, tasks: t.tasks.filter((_, y) => y !== i) }))}><Icon name="trash" size={16} /></button>}</div>)}</div><button className="link-button" onClick={() => addTask(ti)}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={agendaText} close={() => setPreview(false)} />}</>
}

function AgendaLayout({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }) {
  return <AgendaWorkspace {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }} />
  const [preview, setPreview] = useState(false)
  const [techOpen, setTechOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForTask = task => services.find(service => String(service.id) === String(task.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectTaskService = (teamIndex, taskIndex, selectedId) => { const selected = services.find(service => String(service.id) === String(selectedId)); updateTask(teamIndex, taskIndex, selected ? { serviceId: selected.id, service: selected.name, installationZone: serviceCode(selected) === 'alarm-installation' ? teams[teamIndex]?.tasks[taskIndex]?.installationZone : '' } : { serviceId: '', service: '', installationZone: '' }) }
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${teams.map((team, index) => `👥 *Equipo ${index + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.map(task => `🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${task.detail ? `\n📝 *Detalle:* ${task.detail}` : ''}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}`).join('\n\n')}`).join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  const chooseCustomer = (teamIndex, taskIndex, value) => { const customer = customers.find(item => item.account === value || item.name === value || `${item.name} · ${item.account}` === value); updateTask(teamIndex, taskIndex, customer ? { client: customer.name, address: customer.address, phone: customer.phone } : { client: value }) }
  const toggleTechnician = (teamIndex, name) => setTeams(previous => previous.map((team, index) => index !== teamIndex ? team : { ...team, members: team.members.includes(name) ? team.members.filter(member => member !== name) : [...team.members, name] }))
  const removeTeam = index => { if (window.confirm(`¿Querés eliminar el Equipo ${index + 1}?`)) setTeams(previous => previous.filter((_, itemIndex) => itemIndex !== index)) }
  return <>{techOpen !== null && <button className="picker-backdrop" aria-label="Cerrar selector de técnicos" onClick={() => setTechOpen(null)} />}<div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(message); setNotice('La agenda fue copiada al portapapeles.') }}><Icon name="copy" />Copiar agenda</button></div></div><div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, teamIndex) => <article className="team-card" key={teamIndex}><div className="team-header"><div><span className="team-number">{teamIndex + 1}</span><strong>Equipo {teamIndex + 1}</strong>{teams.length > 1 && <button className="team-delete" onClick={() => removeTeam(teamIndex)} title="Eliminar equipo"><Icon name="trash" size={16} />Eliminar equipo</button>}</div><div className="technicians-picker"><span>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</span><button className="secondary small" onClick={() => { setTechOpen(techOpen === teamIndex ? null : teamIndex); setFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === teamIndex && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={filter} onChange={event => setFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(filter.toLowerCase())).map(tech => <label key={tech.id}><input type="checkbox" checked={team.members.includes(tech.name)} onChange={() => toggleTechnician(teamIndex, tech.name)} />{tech.name}</label>)}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, taskIndex) => <div className="task-row" key={taskIndex}><div className="task-title"><span>{taskIndex + 1}</span><b>Servicio</b></div><label>Hora<input type="time" value={task.time} onChange={event => updateTask(teamIndex, taskIndex, { time: event.target.value })} /></label><label>Tipo de servicio<select value={task.service} onChange={event => updateTask(teamIndex, taskIndex, { service: event.target.value })}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id}>{service.name}</option>)}</select></label>
<label>Cliente o cuenta<input list="customer-options" value={task.client} placeholder="Buscá por nombre o cuenta" onChange={event => chooseCustomer(teamIndex, taskIndex, event.target.value)} /><datalist id="customer-options">{customers.map(customer => <option key={customer.account} value={`${customer.name} · ${customer.account}`} />)}</datalist></label>
<label>Dirección<input value={task.address} onChange={event => updateTask(teamIndex, taskIndex, { address: event.target.value })} /></label><label>Contacto<input value={task.phone} onChange={event => updateTask(teamIndex, taskIndex, { phone: event.target.value })} /></label><label className="observations">Observaciones<textarea value={task.detail} onChange={event => updateTask(teamIndex, taskIndex, { detail: event.target.value })} /></label>{team.tasks.length > 1 && <button className="icon-btn delete" onClick={() => setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, tasks: item.tasks.filter((_, index) => index !== taskIndex) }))}><Icon name="trash" size={16} /></button>}</div>)}</div><button className="link-button" onClick={() => setTeams(previous => previous.map((item, index) => index === teamIndex ? { ...item, tasks: [...item.tasks, blankTask()] } : item))}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={message} close={() => setPreview(false)} />}</>
}

function AgendaWorkspace({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }) {
  return <AgendaWorkspaceForm {...{ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }} />
  const [preview, setPreview] = useState(false)
  const [techOpen, setTechOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [customerProposal, setCustomerProposal] = useState(null)
  useEffect(() => {
    const group = document.querySelector('.module-intro .action-group')
    if (!group || group.querySelector('.save-agenda-button')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary save-agenda-button'
    button.textContent = '✓ Guardar agenda'
    button.onclick = saveAgenda
    group.insertBefore(button, group.lastElementChild)
  })
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForTask = task => services.find(service => String(service.id) === String(task.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectTaskService = (teamIndex, taskIndex, selectedId) => { const selected = services.find(service => String(service.id) === String(selectedId)); updateTask(teamIndex, taskIndex, selected ? { serviceId: selected.id, service: selected.name, installationZone: serviceCode(selected) === 'alarm-installation' ? teams[teamIndex]?.tasks[taskIndex]?.installationZone : '' } : { serviceId: '', service: '', installationZone: '' }) }
  const validateAgenda = () => {
    const missing = []
    // Cada equipo debe contar con al menos un técnico antes de registrar la agenda.
    teams.forEach((team, teamIndex) => {
      if (!team.members.length) missing.push(`Equipo ${teamIndex + 1}: técnicos asignados`)
    })
    teams.forEach((team, teamIndex) => team.tasks.forEach((task, taskIndex) => {
      const fields = []
      if (!task.time) fields.push('hora')
      if (!task.service) fields.push('tipo de servicio')
      if (!task.client) fields.push('abonado o cliente')
      if (!task.address) fields.push('dirección')
      if (serviceCode(serviceForTask(task)) === 'alarm-installation' && !task.installationZone) fields.push('ubicación de la instalación')
      if (fields.length) missing.push(`Equipo ${teamIndex + 1}, servicio ${taskIndex + 1}: ${fields.join(', ')}`)
    }))
    if (!missing.length) return true
    showAgendaValidationModal(missing)
    return false
  }
  const registerHistory = () => {
    if (!validateAgenda()) return false
    const records = teams.flatMap((team, teamIndex) => team.tasks.filter(task => task.service || task.client).map((task, taskIndex) => ({ id: `${date}-${teamIndex}-${taskIndex}-${task.time}-${task.client}-${task.service}`, date, team: `Equipo ${teamIndex + 1}`, technicians: team.members, service: task.service || 'Sin especificar', client: task.client || 'Sin especificar', detail: task.detail, address: task.address, phone: task.phone, status: 'Pendiente' })))
    setHistory(previous => [...records.filter(record => !previous.some(item => item.id === record.id)), ...previous])
    return true
  }
  const clearAgenda = () => { if (confirmation !== 'clear') { requestAgendaAction('copy'); return }; setTeams([{ members: [], tasks: [blankTask()] }]); setDate(new Date().toISOString().slice(0, 10)); setNotice('La agenda quedó limpia y lista para una nueva planificación.') }
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${teams.map((team, index) => `👥 *Equipo ${index + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.map(task => `🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${task.detail ? `\n📝 *Detalle:* ${task.detail}` : ''}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}`).join('\n\n')}`).join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  const saveAgenda = () => { if (registerHistory()) setNotice('La agenda fue guardada en el historial.') }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const actionGroup = document.querySelector('.module-intro .action-group')
      if (!actionGroup || actionGroup.querySelector('.save-agenda-button')) return
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'secondary save-agenda-button'; button.textContent = '✓ Guardar agenda'
      button.onclick = saveAgenda
      actionGroup.insertBefore(button, actionGroup.children[1] || null)
    }, 0)
    return () => window.clearTimeout(timer)
  })
  const toggleTech = (teamIndex, name) => setTeams(previous => previous.map((team, index) => index !== teamIndex ? team : { ...team, members: team.members.includes(name) ? team.members.filter(member => member !== name) : [...team.members, name] }))
  const customerChange = (teamIndex, taskIndex, value) => { const customer = customers.find(item => item.account === value || item.name === value || `${item.name} · ${item.account}` === value || `${item.account} ${item.name}` === value); updateTask(teamIndex, taskIndex, customer ? { client: `${customer.account} ${customer.name}`, address: customer.address, phone: customer.phone } : { client: value }) }
  return <><div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setConfirmation('clear')}><Icon name="trash" />Limpiar agenda</button><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(message); clearAgenda() }}><Icon name="copy" />Copiar agenda</button></div></div><div className="agenda-toolbar"><label>Fecha de trabajo<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, teamIndex) => <article className="team-card" key={teamIndex}><div className="team-header"><div><span className="team-number">{teamIndex + 1}</span><strong>Equipo {teamIndex + 1}</strong>{teams.length > 1 && <button className="team-delete" onClick={() => setConfirmation({ type: 'team', index: teamIndex })}><Icon name="trash" size={16} />Eliminar equipo</button>}</div><div className="technicians-picker"><span>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</span><button className="secondary small" onClick={() => { setTechOpen(techOpen === teamIndex ? null : teamIndex); setFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === teamIndex && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={filter} onChange={event => setFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(filter.toLowerCase())).map(tech => <label key={tech.id}><input type="checkbox" checked={team.members.includes(tech.name)} onChange={() => toggleTech(teamIndex, tech.name)} />{tech.name}</label>)}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, taskIndex) => <div className="task-row" key={taskIndex}><div className="task-title"><span>{taskIndex + 1}</span><b>Servicio</b></div><label>Hora<input type="time" value={task.time} onChange={event => updateTask(teamIndex, taskIndex, { time: event.target.value })} /></label><label>Tipo de servicio<select value={task.service} onChange={event => updateTask(teamIndex, taskIndex, { service: event.target.value })}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id}>{service.name}</option>)}</select></label>
<label>Cliente o cuenta<input list="customer-options" value={task.client} onChange={event => customerChange(teamIndex, taskIndex, event.target.value)} /><datalist id="customer-options">{customers.map(customer => <option key={customer.account} value={`${customer.name} · ${customer.account}`} />)}</datalist></label>
<label>Dirección<input value={task.address} onChange={event => updateTask(teamIndex, taskIndex, { address: event.target.value })} /></label><label>Contacto<input value={task.phone} onChange={event => updateTask(teamIndex, taskIndex, { phone: event.target.value })} /></label><label className="observations">Observaciones<textarea value={task.detail} onChange={event => updateTask(teamIndex, taskIndex, { detail: event.target.value })} /></label>{team.tasks.length > 1 && <button className="icon-btn delete" onClick={() => setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, tasks: item.tasks.filter((_, index) => index !== taskIndex) }))}><Icon name="trash" size={16} /></button>}</div>)}</div><button className="link-button" onClick={() => setTeams(previous => previous.map((item, index) => index === teamIndex ? { ...item, tasks: [...item.tasks, blankTask()] } : item))}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={message} close={() => setPreview(false)} />}{confirmation === 'clear' && <Confirm title="Limpiar agenda" detail="¿Querés borrar todos los equipos y servicios cargados?" destructive action={clearAgenda} close={() => setConfirmation(null)} />}{confirmation?.type === 'team' && <Confirm title="Eliminar equipo" detail={`¿Querés eliminar el Equipo ${confirmation.index + 1}? Esta acción no se puede deshacer.`} destructive action={() => { setTeams(previous => previous.filter((_, index) => index !== confirmation.index)); setNotice('El equipo fue eliminado.') }} close={() => setConfirmation(null)} />}</>
}

function DailyCustomerField({ task, customers, teamIndex, taskIndex, onTextCommit, onCustomerSelect }) {
  return <CustomerAutocomplete
    className="daily-field-customer"
    value={task.client}
    customerId={task.customerId}
    customers={customers}
    onTextCommit={value => onTextCommit(teamIndex, taskIndex, value)}
    onCustomerSelect={customer => onCustomerSelect(teamIndex, taskIndex, customer)}
  />
}

function BufferedTextarea({ value, onCommit, delay = 500, ...textareaProps }) {
  const normalizedValue = String(value || '')
  const [draft, setDraft] = useState(normalizedValue)
  const focused = useRef(false)
  const timer = useRef(null)
  const externalValue = useRef(normalizedValue)
  const commitHandler = useRef(onCommit)

  useEffect(() => { commitHandler.current = onCommit }, [onCommit])
  useEffect(() => {
    externalValue.current = normalizedValue
    if (!focused.current) setDraft(normalizedValue)
  }, [normalizedValue])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = nextValue => {
    window.clearTimeout(timer.current)
    timer.current = null
    if (nextValue === externalValue.current) return
    externalValue.current = nextValue
    commitHandler.current(nextValue)
  }

  return <textarea
    {...textareaProps}
    value={draft}
    onFocus={() => { focused.current = true }}
    onChange={event => {
      const nextValue = event.target.value
      setDraft(nextValue)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => commit(nextValue), delay)
    }}
    onBlur={() => {
      focused.current = false
      commit(draft)
    }}
  />
}

function ServiceExtraFields({ className, task, service, onChange, buffered = false }) {
  const available = serviceExtraAvailability(service, task?.installationZone)
  const fields = [
    ['paymentMethod', 'Forma de pago'],
    ['amount', 'Monto'],
    ['monthlyFee', 'Abono mensual'],
    ['form', 'Formulario']
  ]
  return <div className={className}>{fields.map(([key, label]) => {
    const enabled = key === 'amount' ? available.paymentMethod && Boolean(task?.paymentMethod) && task.paymentMethod !== 'No aplica' : available[key]
    if (key === 'amount' && !enabled) return null
    const props = {
      value: enabled ? task?.[key] || '' : '',
      disabled: !enabled,
      placeholder: enabled ? '' : 'No aplica',
      title: enabled ? '' : 'Este campo no aplica para el tipo de servicio o la ubicación seleccionados.'
    }
    if (key === 'form') {
      return <label key={key}>{label}<select value={enabled ? normalizeFormValue(task?.form) : ''} disabled={!enabled} title={props.title} onChange={event => onChange({ form: event.target.value })}><option value="">{enabled ? 'Seleccionar' : 'No aplica'}</option>{enabled && FORM_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
    }
    if (key === 'paymentMethod') {
      const paymentValue = enabled ? task?.paymentMethod || '' : ''
      const legacyValue = paymentValue && !PAYMENT_OPTIONS.includes(paymentValue) ? paymentValue : ''
      return <label key={key}>{label}<select value={paymentValue} disabled={!enabled} title={props.title} onChange={event => onChange({ paymentMethod: event.target.value, ...(!event.target.value || event.target.value === 'No aplica' ? { amount: '' } : {}) })}><option value="">{enabled ? 'Seleccionar' : 'No aplica'}</option>{legacyValue && <option value={legacyValue}>{legacyValue}</option>}{enabled && PAYMENT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
    }
    if (key === 'amount') {
      const required = task?.paymentMethod !== 'A confirmar'
      const amountProps = { ...props, inputMode: 'decimal', required, placeholder: required ? 'Ingresar monto' : 'Opcional' }
      return <label key={key}>{required ? <RequiredLabel>{label}</RequiredLabel> : label}<CurrencyInput {...amountProps} buffered={buffered} onCommit={value => onChange({ amount: value })} /></label>
    }
    return <label key={key}>{label}{buffered
      ? <BufferedInput {...props} onCommit={value => onChange({ [key]: value })} />
      : <input {...props} onChange={event => onChange({ [key]: event.target.value })} />}</label>
  })}</div>
}

function CurrencyInput({ value, onCommit, buffered = false, delay = 500, ...inputProps }) {
  const normalizedValue = normalizeCurrencyAmount(value)
  const [draft, setDraft] = useState(normalizedValue)
  const [focused, setFocused] = useState(false)
  const timer = useRef(null)
  const externalValue = useRef(normalizedValue)
  const commitHandler = useRef(onCommit)

  useEffect(() => { commitHandler.current = onCommit }, [onCommit])
  useEffect(() => {
    externalValue.current = normalizedValue
    if (!focused) setDraft(normalizedValue)
  }, [normalizedValue, focused])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = nextValue => {
    window.clearTimeout(timer.current)
    timer.current = null
    if (nextValue === externalValue.current) return
    externalValue.current = nextValue
    commitHandler.current(nextValue)
  }

  return <input
    {...inputProps}
    type="text"
    value={focused ? draft : formatCurrencyAmount(draft)}
    onFocus={event => {
      setFocused(true)
      window.requestAnimationFrame(() => event.target.select())
    }}
    onChange={event => {
      const nextValue = normalizeCurrencyAmount(event.target.value)
      setDraft(nextValue)
      if (!buffered) return commit(nextValue)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => commit(nextValue), delay)
    }}
    onBlur={() => {
      setFocused(false)
      commit(draft)
    }}
  />
}

function BufferedInput({ value, onCommit, delay = 500, ...inputProps }) {
  const normalizedValue = String(value || '')
  const [draft, setDraft] = useState(normalizedValue)
  const focused = useRef(false)
  const timer = useRef(null)
  const externalValue = useRef(normalizedValue)
  const commitHandler = useRef(onCommit)

  useEffect(() => { commitHandler.current = onCommit }, [onCommit])
  useEffect(() => {
    externalValue.current = normalizedValue
    if (!focused.current) setDraft(normalizedValue)
  }, [normalizedValue])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = nextValue => {
    window.clearTimeout(timer.current)
    timer.current = null
    if (nextValue === externalValue.current) return
    externalValue.current = nextValue
    commitHandler.current(nextValue)
  }

  return <input
    {...inputProps}
    value={draft}
    onFocus={() => { focused.current = true }}
    onChange={event => {
      const nextValue = event.target.value
      setDraft(nextValue)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => commit(nextValue), delay)
    }}
    onBlur={() => {
      focused.current = false
      commit(draft)
    }}
  />
}

function AgendaWorkspaceForm({ date, setDate, teams, setTeams, activeTechs, customers, services, history, setHistory, updateTask, setNotice, weekly, setWeekly, databaseReady }) {
  const authUser = globalThis.__pignusCurrentUser || null
  const holidayCalendar = useNationalHolidays([authUser ? String(date || '').slice(0, 4) : ''])
  const holiday = holidayForDate(holidayCalendar.records, date)
  const holidayDecision = holidayDecisionForDate(weekly, date)
  const advancedGuard = useMemo(() => advancedGuardForSaturdayDate(date, weekly, teams), [date, weekly, teams])
  const saveAgenda = () => requestAgendaAction('save')
  const [preview, setPreview] = useState(false)
  const [techOpen, setTechOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [customerProposal, setCustomerProposal] = useState(null)
  const [taskMove, setTaskMove] = useState(null)
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
    if (advancedGuard) return
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
  }, [date, teams, setWeekly, advancedGuard])
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
    const saved = history.filter(record => record.date === nextDate && ['Pendiente', 'Reprogramado', 'Requiere revisión'].includes(record.status || 'Pendiente'))
    setDate(nextDate)
    const weeklyDay = weekly?.[nextDate]
    if (!saved.length && !weeklyDay?.teams?.length) {
      const tasks = isSaturday(nextDate) ? defaultServiceTasksForDate(nextDate, weekly).slice(0, 1) : defaultServiceTasksForDate(nextDate, weekly)
      const emptyTeams = [{ teamId: createTeamId(), memberIds: [], members: [], tasks }]
      setTeams(isSaturday(nextDate) ? assignGuardToEmptySaturday(emptyTeams, nextDate, weekly, activeTechs) : emptyTeams)
      if (announce) setNotice('No hay una agenda guardada para la fecha seleccionada. Podés crear una nueva.')
      return
    }
    const byTeam = new Map()
    ;(weeklyDay?.teams || []).forEach((team, index) => {
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
    saved.forEach(record => {
      const number = Number(String(record.team || '').match(/\d+/)?.[0]) || 1
      const teamKey = record.teamId || `legacy-team-${number}`
      const current = byTeam.get(teamKey) || { position: number, teamId: record.teamId || createTeamId(), memberIds: record.technicianIds || [], members: record.technicians || [], tasks: [] }
      current.teamId ||= record.teamId || createTeamId()
      current.memberIds = record.technicianIds?.length ? record.technicianIds : current.memberIds
      current.members = record.technicians?.length ? record.technicians : current.members
      // Se aceptan los nombres anteriores del campo para recuperar también agendas ya existentes.
      const recoveredTask = { taskId: record.sourceTaskId || record.id || createTaskId(), historyId: record.id, time: record.time || record.scheduledTime || record.hora || record.Hora || '', serviceId: record.serviceId || '', service: record.service || '', customerId: record.customerId || '', client: record.client || '', clientAccount: record.clientAccount || record.account || '', clientNameAtService: record.clientNameAtService || '', address: record.address || '', phone: record.phone || '', detail: record.detail || '', paymentMethod: record.paymentMethod || '', amount: record.amount || '', monthlyFee: record.monthlyFee || '', form: record.form || '', installationZone: record.installationZone || '', ...serviceTrace(record) }
      const sameTask = task => (record.id && String(task.historyId || '') === String(record.id)) || (record.sourceTaskId && String(task.taskId || '') === String(record.sourceTaskId))
      if (current.tasks.some(sameTask)) current.tasks = current.tasks.map(task => sameTask(task) ? { ...task, ...recoveredTask } : task)
      else current.tasks.push(recoveredTask)
      byTeam.set(teamKey, current)
    })
    const recoveredTeams = [...byTeam.values()].sort((a, b) => a.position - b.position).map(({ position, ...team }) => ({ ...team, tasks: sortTasksByTime(team.tasks.length ? team.tasks : [blankTask()]) }))
    const targetTimes = defaultServiceTimesForDate(nextDate, weekly)
    setTeams(isSaturday(nextDate) ? assignGuardToEmptySaturday(normalizeSaturdayTeams(recoveredTeams, nextDate, weekly), nextDate, weekly, activeTechs) : alignDefaultServiceTimes(recoveredTeams, nextDate, targetTimes, fallbackDefaultServiceTimesForDate(nextDate)))
    const reprogrammedCount = saved.filter(record => record.rescheduledFrom).length
    if (announce) {
      setNotice(reprogrammedCount
        ? `Se cargó la agenda del ${prettyDate(nextDate)} con ${reprogrammedCount} servicio(s) reprogramado(s).`
        : `Se recuperó la agenda guardada del ${prettyDate(nextDate)}.`)
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
    const intercept = event => { event.preventDefault(); event.stopPropagation(); requestAgendaAction('copy') }
    copyButton.addEventListener('click', intercept, true)
    return () => copyButton.removeEventListener('click', intercept, true)
  }, [date, teams, history, activeTechs])
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForTask = task =>
    services.find(service => String(service.id) === String(task.serviceId)) ||
    services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectTaskService = (teamIndex, taskIndex, selectedId) => {
    const selected = services.find(service => String(service.id) === String(selectedId))
    const currentTask = teams[teamIndex]?.tasks[taskIndex]
    const nextTask = selected
      ? { ...currentTask, serviceId: selected.id, service: selected.name, installationZone: serviceCode(selected) === 'alarm-installation' ? currentTask?.installationZone || '' : '' }
      : { ...currentTask, serviceId: '', service: '', installationZone: '' }
    updateTask(teamIndex, taskIndex, { ...nextTask, ...applicableServiceExtras(nextTask, selected) })
  }
  const validateAgenda = (agendaTeams = teams) => {
    const missing = []
    agendaTeams.forEach((team, teamIndex) => team.tasks.forEach((task, taskIndex) => {
      const fields = []
      if (!task.time) fields.push('hora')
      if (!task.service) fields.push('tipo de servicio')
      if (!task.customerId) fields.push('abonado o cliente registrado')
      if (!task.address) fields.push('dirección')
      if (!task.phone) fields.push('contacto')
      if (serviceCode(serviceForTask(task)) === 'alarm-installation' && !task.installationZone) fields.push('ubicación de la instalación')
      if (requiresPaymentAmount(task, serviceForTask(task))) fields.push('monto')
      if (fields.length) missing.push(`Equipo ${teamIndex + 1}, servicio ${taskIndex + 1}: ${fields.join(', ')}`)
    }))
    if (!missing.length) return true
    showAgendaValidationModal(missing)
    return false
  }
  const clearAgenda = () => { if (confirmation !== 'clear') { if (!registerHistory()) return; setNotice('La agenda fue copiada al portapapeles y registrada en el historial.'); return }; const today = currentLocalDate(); setTeams([{ teamId: createTeamId(), memberIds: [], members: [], tasks: isSaturday(today) ? defaultServiceTasksForDate(today, weekly).slice(0, 1) : defaultServiceTasksForDate(today, weekly) }]); setDate(today); setNotice('La agenda quedó limpia y lista para una nueva planificación.') }
  const previewValue = value => String(value || '').trim() || 'Sin información'
  const previewDetails = task => {
    const service = serviceForTask(task)
    const available = serviceExtraAvailability(service, task.installationZone)
    const extras = applicableServiceExtras(task, service)
    const lines = [
      `Observación: ${previewValue(task.detail)}`,
      available.paymentMethod && `Forma de pago: ${previewValue(extras.paymentMethod)}`,
      available.paymentMethod && extras.paymentMethod && extras.paymentMethod !== 'No aplica' && `Monto: ${previewValue(formatCurrencyAmount(extras.amount))}`,
      available.monthlyFee && `Abono mensual: ${previewValue(extras.monthlyFee)}`,
      available.form && `Formulario: ${previewValue(extras.form)}`
    ].filter(Boolean)
    return `\n📝 *Detalle:*\n${lines.join('\n')}`
  }
  const taskMessage = task => `🕒 ${task.time || '--:--'} Hs\n🛠️ *${task.service || 'Servicio'}*\n👤 *${task.client || 'Cliente'}*${previewDetails(task)}${task.address ? `\n📍 *Dirección:* ${task.address}` : ''}${task.phone ? `\n📞 *Contacto:* ${task.phone}` : ''}`
  const teamMessage = (team, index) => `👥 *Equipo ${index + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${team.tasks.map(taskMessage).join('\n\n')}`
  const individualTaskMessage = (task, team, teamIndex) => `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n👥 *Equipo ${teamIndex + 1}:* ${team.members.join(' / ') || 'Sin asignar'}\n\n${taskMessage(task)}`
  const message = `📅 *Agenda de trabajo – ${prettyDate(date)}*\n\n${teams.map(teamMessage).join('\n\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n')}`
  const copySingleTask = async (task, team, teamIndex, taskIndex) => {
    const copied = await copyTextToClipboard(individualTaskMessage(task, team, teamIndex))
    setNotice(copied
      ? `El servicio ${taskIndex + 1} del Equipo ${teamIndex + 1} fue copiado al portapapeles.`
      : 'No se pudo acceder al portapapeles. Revisá los permisos del navegador e intentá nuevamente.')
  }
  const registerHistory = (agendaTeams = teams) => {
    if (!validateAgenda(agendaTeams)) return false
    setHistory(previous => {
      const records = agendaTeams.flatMap((team, teamIndex) => team.tasks.map((task, taskIndex) => ({
        // historyId se conserva al recuperar o editar una agenda ya registrada.
        // Para un servicio nuevo se usa el taskId, que permanece aunque cambien sus datos.
        id: task.historyId || `work-${task.taskId || `${date}-${teamIndex}-${taskIndex}`}`,
        sourceTaskId: task.taskId,
        date, time: task.time, scheduledTime: task.time, team: `Equipo ${teamIndex + 1}`,
        // El historial conserva el titular original aunque la cuenta se reasigne después.
        teamId: team.teamId, technicianIds: team.memberIds || [], technicians: team.members, serviceId: serviceForTask(task)?.id || task.serviceId, service: serviceForTask(task)?.name || task.service, client: task.client,
        customerId: task.customerId || '',
        clientAccount: task.clientAccount || '',
        clientNameAtService: task.clientNameAtService || task.client.replace(/^[^\s]+\s+/, ''), detail: task.detail,
        ...applicableServiceExtras(task, serviceForTask(task)),
        address: task.address, phone: task.phone, installationZone: task.installationZone || '', ...serviceTrace(task)
      })))
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
      return [...replacements, ...previous.filter(record => !replacedIds.has(record.id))]
    })
    return true
  }
  const finishAgendaAction = (action, agendaTeams = teams) => {
    if (!registerHistory(agendaTeams)) return
    if (action === 'copy') navigator.clipboard?.writeText(message)
    setNotice(action === 'copy' ? 'La agenda fue copiada al portapapeles y registrada en el historial.' : 'La agenda fue guardada en el historial.')
  }
  const requestAgendaAction = (action, allowWithoutTechnicians = false, agendaTeams = teams, skipCustomerProposal = false) => {
    if (advancedGuard) {
      setNotice(advancedSaturdayGuardMessage(advancedGuard))
      return
    }
    if (holidayIsBlocked(holiday, holidayDecision)) {
      setNotice(holidayDecision?.status === 'closed' ? 'La fecha fue definida como día no operativo.' : 'Primero definí si el feriado será laboral o no operativo.')
      return
    }
    const meaningful = value => String(value || '').trim() && String(value || '').trim() !== '-'
    const existingUpdates = new Map()
    const newClients = new Map()
    agendaTeams.forEach(team => team.tasks.forEach(task => {
      const account = normalizeAccountKey(task.clientAccount || String(task.client || '').trim().split(/\s+/)[0])
      const customer = customers.find(item => String(item.customerId || '') === String(task.customerId || '')) || customers.find(item => normalizeAccountKey(item.account) === account)
      if (customer) {
        const address = !meaningful(customer.address) && meaningful(task.address) ? task.address.trim() : customer.address
        const phone = !meaningful(customer.phone) && meaningful(task.phone) ? task.phone.trim() : customer.phone
        if (address !== customer.address || phone !== customer.phone) existingUpdates.set(String(customer.customerId), { ...customer, address, street: customer.street || address, phone })
      } else if (String(task.client || '').trim()) {
        const key = normalizeSearchText(task.client)
        if (!newClients.has(key)) newClients.set(key, { name: String(task.client).trim(), address: meaningful(task.address) ? task.address.trim() : '', phone: meaningful(task.phone) ? task.phone.trim() : '' })
      }
    }))
    if (!skipCustomerProposal && (existingUpdates.size || newClients.size)) {
      setCustomerProposal({ action, allowWithoutTechnicians, existingUpdates: [...existingUpdates.values()], newClients: [...newClients.values()] })
      return
    }
    if (!validateAgenda(agendaTeams)) return
    const missingTeams = agendaTeams.map((team, index) => !team.members.length ? `Equipo ${index + 1}` : '').filter(Boolean)
    if (missingTeams.length && !allowWithoutTechnicians) { showMissingTechniciansModal(missingTeams, () => requestAgendaAction(action, true, agendaTeams, true)); return }
    const conflicts = technicianTimeConflicts(agendaTeams, activeTechs)
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
      if (task.customerId) return task
      const customer = created.get(normalizeSearchText(task.client))
      return customer ? { ...task, customerId: customer.customerId, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name, address: task.address || customer.address, phone: task.phone || customer.phone } : task
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
  const toggleTech = (teamIndex, technician) => setTeams(previous => {
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
    customerId: '',
    client: value,
    clientAccount: '',
    clientNameAtService: '',
    address: '',
    phone: ''
  })
  const selectCustomerResult = (teamIndex, taskIndex, customer) => updateTask(teamIndex, taskIndex, {
    customerId: customer.customerId,
    client: `${customer.account} ${customer.name}`,
    clientAccount: customer.account,
    clientNameAtService: customer.name,
    address: customer.address,
    phone: customer.phone
  })
  const openTaskMove = (teamIndex, taskIndex) => {
    const sourceTeam = teams[teamIndex]
    const task = sourceTeam?.tasks?.[taskIndex]
    const destinationIndex = teams.findIndex((_, index) => index !== teamIndex)
    if (!task || destinationIndex < 0) {
      setNotice('Creá otro equipo antes de reasignar el servicio.')
      return
    }
    setTaskMove({
      sourceTeamId: sourceTeam.teamId,
      sourceTeamIndex: teamIndex,
      taskId: task.taskId,
      taskIndex,
      destinationTeamId: teams[destinationIndex].teamId,
      destinationTeamIndex: destinationIndex
    })
  }
  const confirmTaskMove = () => {
    if (!taskMove) return
    const sourceIndex = teams.findIndex((team, index) => taskMove.sourceTeamId ? String(team.teamId || '') === String(taskMove.sourceTeamId) : index === taskMove.sourceTeamIndex)
    const destinationIndex = teams.findIndex((team, index) => taskMove.destinationTeamId ? String(team.teamId || '') === String(taskMove.destinationTeamId) : index === taskMove.destinationTeamIndex)
    const sourceTeam = teams[sourceIndex]
    const destinationTeam = teams[destinationIndex]
    const taskIndex = sourceTeam?.tasks?.findIndex((task, index) => taskMove.taskId ? String(task.taskId || '') === String(taskMove.taskId) : index === taskMove.taskIndex) ?? -1
    const movedTask = stampServiceRecord(sourceTeam?.tasks?.[taskIndex], authUser)
    if (!movedTask || !destinationTeam || sourceIndex === destinationIndex) {
      setTaskMove(null)
      setNotice('No se pudo reasignar el servicio. Revisá los equipos e intentá nuevamente.')
      return
    }
    setTeams(previous => previous.map((team, index) => {
      if (index === sourceIndex) return { ...team, tasks: (team.tasks || []).filter(task => String(task.taskId || '') !== String(movedTask.taskId || '')) }
      if (index === destinationIndex) return { ...team, tasks: sortTasksByTime([...(team.tasks || []), movedTask]) }
      return team
    }))
    const historyId = movedTask.historyId || `work-${movedTask.taskId}`
    setHistory(previous => previous.map(record => {
      const sameRecord = String(record.id || '') === String(historyId) || (movedTask.taskId && String(record.sourceTaskId || '') === String(movedTask.taskId))
      return !sameRecord ? record : {
        ...record,
        team: `Equipo ${destinationIndex + 1}`,
        teamId: destinationTeam.teamId,
        technicianIds: destinationTeam.memberIds || [],
        technicians: destinationTeam.members || []
      }
    }))
    setTaskMove(null)
    setNotice(`El servicio fue reasignado al Equipo ${destinationIndex + 1} y conserva todos sus datos.`)
  }
  useEffect(() => {
    if (!taskMove) return undefined
    const sourceIndex = teams.findIndex((team, index) => taskMove.sourceTeamId ? String(team.teamId || '') === String(taskMove.sourceTeamId) : index === taskMove.sourceTeamIndex)
    const layer = document.createElement('div')
    layer.className = 'modal-layer task-move-layer'
    const modal = document.createElement('div')
    modal.className = 'modal task-move-modal'
    const sourceTask = teams[sourceIndex]?.tasks?.find(task => String(task.taskId || '') === String(taskMove.taskId || '')) || teams[sourceIndex]?.tasks?.[taskMove.taskIndex]
    const title = document.createElement('h2')
    title.textContent = 'Reasignar servicio'
    const detail = document.createElement('p')
    detail.textContent = `${sourceTask?.client || 'Servicio'} conservará el horario y todos los datos cargados.`
    const label = document.createElement('label')
    label.textContent = 'Equipo de destino'
    const select = document.createElement('select')
    teams.forEach((team, index) => {
      if (index === sourceIndex) return
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = `Equipo ${index + 1}${team.members?.length ? ` · ${team.members.join(' / ')}` : ' · Sin técnicos'}`
      option.selected = index === taskMove.destinationTeamIndex
      select.append(option)
    })
    select.onchange = event => {
      const destinationTeamIndex = Number(event.target.value)
      setTaskMove(previous => ({ ...previous, destinationTeamIndex, destinationTeamId: teams[destinationTeamIndex]?.teamId }))
    }
    label.append(select)
    const actions = document.createElement('div')
    actions.className = 'confirm-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'secondary'
    cancel.textContent = 'Cancelar'
    cancel.onclick = () => setTaskMove(null)
    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.className = 'primary'
    confirm.textContent = 'Reasignar servicio'
    confirm.onclick = confirmTaskMove
    actions.append(cancel, confirm)
    modal.append(title, detail, label, actions)
    layer.append(modal)
    document.body.append(layer)
    return () => layer.remove()
  }, [taskMove, teams])
  const dailyCustomerField = (task, teamIndex, taskIndex) => <DailyCustomerField task={task} customers={customers} teamIndex={teamIndex} taskIndex={taskIndex} onTextCommit={commitCustomerText} onCustomerSelect={selectCustomerResult} />
  if (holidayCalendar.loading || holidayCalendar.error || holidayIsBlocked(holiday, holidayDecision)) {
    return <><div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>La disponibilidad se habilita después de verificar el calendario laboral.</p></div></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{holidayCalendar.loading ? <div className="holiday-calendar-state"><span className="loading-spinner" />Verificando feriados nacionales…</div> : holidayCalendar.error ? <div className="holiday-calendar-state error"><Icon name="alert" /><div><b>No se pudo verificar el calendario nacional</b><p>{holidayCalendar.error}</p></div><button className="secondary" onClick={() => window.location.reload()}>Reintentar</button></div> : <HolidayDecisionPanel holiday={holiday} decision={holidayDecision} canDecide={authUser?.roleCode === 'administrator'} onDecision={status => recordHolidayDecision(setWeekly, setNotice, date, holiday, status)} />}</>
  }
  if (advancedGuard) {
    return <><div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Agenda del sábado bloqueada</h1><p>La guardia de fin de semana ya fue cubierta el viernes y no admite nuevos equipos, técnicos ni servicios.</p></div></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div><p className={`weekly-guard-advanced ${advancedGuard.hasSaturdayConflict ? 'has-conflict' : ''}`}><Icon name={advancedGuard.hasSaturdayConflict ? 'alert' : 'check'} size={16} /><span>{advancedSaturdayGuardMessage(advancedGuard)}</span></p></>
  }
  return <><div className="module-intro"><div><p className="eyebrow">PLANIFICACIÓN DIARIA</p><h1>Organizá los trabajos del día</h1><p>Asigná técnicos y servicios para armar la agenda de cada equipo.</p></div><div className="action-group"><button className="secondary" onClick={() => setConfirmation('clear')}><Icon name="trash" />Limpiar agenda</button><button className="secondary" onClick={() => setPreview(true)}><Icon name="eye" />Vista previa</button><button type="button" className="secondary save-agenda-button" onClick={saveAgenda}><Icon name="check" />Guardar agenda</button><button className="primary" onClick={() => { navigator.clipboard?.writeText(message); clearAgenda() }}><Icon name="copy" />Copiar agenda</button></div></div><div className="agenda-toolbar"><label><RequiredLabel>Fecha de trabajo</RequiredLabel><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{prettyDate(date)}</span></div>{teams.map((team, teamIndex) => <article className="team-card" key={team.teamId || teamIndex}><div className="team-header"><div className="daily-team-heading"><span className="team-number">{teamIndex + 1}</span><div className="daily-team-identity"><strong>Equipo {teamIndex + 1}</strong><span className="daily-team-member-names" title={team.members.join(' · ') || 'Sin técnicos'}>{team.members.length ? team.members.map(name => String(name).trim().split(/\s+/)[0]).join(' · ') : 'Sin técnicos'}</span></div>{teams.length > 1 && <button className="team-delete" onClick={() => setConfirmation({ type: 'team', index: teamIndex })}><Icon name="trash" size={16} />Eliminar equipo</button>}</div><div className="technicians-picker"><span className="technician-assignment-label"><RequiredLabel>{team.members.length ? `${team.members.length} técnico(s) asignado(s)` : 'Sin técnicos asignados'}</RequiredLabel></span><button className="secondary small" onClick={() => { setTechOpen(techOpen === teamIndex ? null : teamIndex); setFilter('') }}><Icon name="users" size={16} />Agregar técnicos</button>{techOpen === teamIndex && <div className="tech-popover"><input autoFocus placeholder="Buscar técnico..." value={filter} onChange={event => setFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(filter.toLowerCase())).map(tech => <label key={tech.id}><input type="checkbox" checked={(team.memberIds || []).some(id => String(id) === String(tech.id))} onChange={() => toggleTech(teamIndex, tech)} />{tech.name}</label>)}</div></div>}</div></div><div className="tasks">{team.tasks.map((task, taskIndex) => <div className="task-row" key={task.taskId || task.historyId || `${team.teamId || teamIndex}-${taskIndex}`}><div className="task-title"><span>{taskIndex + 1}</span><b>Servicio</b></div><label className="daily-field-time"><RequiredLabel>Hora</RequiredLabel><input aria-required="true" type="time" value={task.time} onChange={event => updateTask(teamIndex, taskIndex, { time: event.target.value })} /></label><label className="daily-field-service"><RequiredLabel>Tipo de servicio</RequiredLabel><select aria-required="true" value={serviceForTask(task)?.id || ''} onChange={event => selectTaskService(teamIndex, taskIndex, event.target.value)}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
<TaskStatusBadge task={task} date={date} history={history} />
{dailyCustomerField(task, teamIndex, taskIndex)}
<label className="daily-field-address"><RequiredLabel>Dirección</RequiredLabel><input aria-required="true" value={task.address} onChange={event => updateTask(teamIndex, taskIndex, { address: event.target.value })} /></label><label className="daily-field-contact"><RequiredLabel>Contacto</RequiredLabel><input aria-required="true" value={task.phone} onChange={event => updateTask(teamIndex, taskIndex, { phone: event.target.value })} /></label><label className="observations daily-field-observations">Observaciones<BufferedTextarea value={task.detail} onCommit={value => updateTask(teamIndex, taskIndex, { detail: value })} /></label>{serviceCode(serviceForTask(task)) === 'alarm-installation' && <fieldset className="installation-zone"><legend><RequiredLabel>Ubicación de la instalación</RequiredLabel></legend>{[['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residencial']].map(([value, label]) => <label key={value}><input type="radio" aria-required="true" name={`zone-${teamIndex}-${taskIndex}`} checked={task.installationZone === value} onChange={() => { const nextTask = { ...task, installationZone: value }; updateTask(teamIndex, taskIndex, { installationZone: value, ...applicableServiceExtras(nextTask, serviceForTask(task)) }) }} />{label}</label>)}</fieldset>}<ServiceExtraFields className="daily-extra-fields" task={task} service={serviceForTask(task)} buffered onChange={patch => updateTask(teamIndex, taskIndex, patch)} /><div className="daily-task-actions"><button type="button" className="icon-btn daily-copy-button" title="Copiar este servicio" aria-label={`Copiar servicio ${taskIndex + 1} del Equipo ${teamIndex + 1}`} onClick={() => copySingleTask(task, team, teamIndex, taskIndex)}><Icon name="copy" size={16} /><span>Copiar</span></button>{teams.length > 1 && <button type="button" className="icon-btn move daily-move-button" title="Reasignar a otro equipo" aria-label={`Reasignar servicio ${taskIndex + 1} a otro equipo`} onClick={() => openTaskMove(teamIndex, taskIndex)}><span aria-hidden="true">⇄</span><span>Reasignar</span></button>}{taskHasContent(task) && <button type="button" className="icon-btn delete daily-delete-button" title="Eliminar servicio" aria-label={`Eliminar servicio ${taskIndex + 1} del Equipo ${teamIndex + 1}`} onClick={() => setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, tasks: item.tasks.length > 1 ? item.tasks.filter((_, index) => index !== taskIndex) : [blankTask()] }))}><Icon name="trash" size={16} /><span>Eliminar</span></button>}</div></div>)}</div><button className="link-button" onClick={() => setTeams(previous => previous.map((item, index) => index === teamIndex ? { ...item, tasks: [...item.tasks, blankTask()] } : item))}><Icon name="plus" size={16} />Agregar servicio</button></article>)}<button className="add-team" onClick={() => setTeams([...teams, { teamId: createTeamId(), memberIds: [], members: [], tasks: [blankTask()] }])}><Icon name="plus" />Agregar otro equipo</button>{preview && <Preview title="Vista previa de la agenda" text={message} close={() => setPreview(false)} />}{confirmation === 'clear' && <Confirm title="Limpiar agenda" detail="¿Querés borrar todos los equipos y servicios cargados?" destructive action={clearAgenda} close={() => setConfirmation(null)} />}{confirmation?.type === 'team' && <Confirm title="Eliminar equipo" detail={`¿Querés eliminar el Equipo ${confirmation.index + 1}? Esta acción no se puede deshacer.`} destructive action={() => { setTeams(previous => previous.filter((_, index) => index !== confirmation.index)); setNotice('El equipo fue eliminado.') }} close={() => setConfirmation(null)} />}</>
}

/**
 * Planificador semanal: es el espacio de preparación previa. Sus tarjetas no
 * impactan en el Historial hasta que el operador abre y guarda la agenda diaria.
 */
function WeeklyPlanner({ weekly, setWeekly, customers, services, activeTechs, history, setHistory, setNotice, openDaily, authUser }) {
  authUser = authUser || globalThis.__pignusCurrentUser || null
  const isAdministrator = authUser?.roleCode === 'administrator'
  const operationalHistory = history || globalThis.__pignusHistory || []
  const localToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [today, setToday] = useState(localToday)
  const [anchor, setAnchor] = useState(today)
  const [monthlySetup, setMonthlySetup] = useState(null)
  const [monthlyTimesSetup, setMonthlyTimesSetup] = useState(null)
  const [annualGuardSetup, setAnnualGuardSetup] = useState(null)
  const [techPicker, setTechPicker] = useState(null)
  const [techFilter, setTechFilter] = useState('')
  const [taskEditor, setTaskEditor] = useState(null)
  const [taskMove, setTaskMove] = useState(null)
  const [taskRemoval, setTaskRemoval] = useState(null)
  const [teamRemoval, setTeamRemoval] = useState(null)
  const weeklyBoardRef = useRef(null)
  const weeklyTopScrollRef = useRef(null)
  const [weeklyScrollWidth, setWeeklyScrollWidth] = useState(0)
  const syncWeeklyScroll = (source, target) => {
    if (!source || !target) return
    const sourceRange = Math.max(0, source.scrollWidth - source.clientWidth)
    const targetRange = Math.max(0, target.scrollWidth - target.clientWidth)
    const nextPosition = sourceRange ? (source.scrollLeft / sourceRange) * targetRange : 0
    if (Math.abs(target.scrollLeft - nextPosition) > 0.5) target.scrollLeft = nextPosition
  }
  const activeServices = services.filter(service => service.status === 'Activo')
  const serviceForWeeklyTask = task => services.find(service => String(service.id) === String(task.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(task.service))
  const selectWeeklyService = (day, teamIndex, taskIndex, selectedId) => {
    const selected = services.find(service => String(service.id) === String(selectedId))
    const currentTask = dayPlan(day).teams[teamIndex]?.tasks[taskIndex]
    const nextTask = selected
      ? { ...currentTask, serviceId: selected.id, service: selected.name, installationZone: serviceCode(selected) === 'alarm-installation' ? currentTask?.installationZone || '' : '' }
      : { ...currentTask, serviceId: '', service: '', installationZone: '' }
    updateTask(day, teamIndex, taskIndex, { ...nextTask, ...applicableServiceExtras(nextTask, selected) })
  }
  const weeklyTechnicianName = fullName => activeTechs.find(tech => tech.name === fullName)?.firstName || String(fullName || '').split(' ')[0]
  const monthKey = anchor.slice(0, 7)
  const anchorYear = anchor.slice(0, 4)
  const monthlyTeams = weekly._monthlyTeams || {}
  const suggestedAnnualGuardRotation = (year, source = weekly) => {
    const configured = source?._annualGuards?.[year]?.rotation
    if (configured?.length) return configured.map(item => ({ ...item }))
    if (String(year) === '2026') {
      const preset = default2026GuardRotationFor(activeTechs)
      if (preset.length) return preset
    }
    const previous = source?._annualGuards?.[String(Number(year) - 1)]?.rotation
    return previous?.length ? previous.map(item => ({ ...item })) : []
  }
  const previousMonthKey = (() => { const value = new Date(`${monthKey}-01T12:00:00`); value.setMonth(value.getMonth() - 1); return value.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7) })()
  const baseTeams = monthlyTeams[monthKey]?.teams
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
  const monday = useMemo(() => {
    const value = new Date(`${anchor}T12:00:00`)
    value.setDate(value.getDate() - ((value.getDay() + 6) % 7))
    return value
  }, [anchor])
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const value = new Date(monday)
    value.setDate(monday.getDate() + index)
    return value.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  }), [monday])
  const holidayCalendar = useNationalHolidays(days.map(day => day.slice(0, 4)))
  const holidayStateForDay = day => {
    const holiday = holidayForDate(holidayCalendar.records, day)
    const decision = holidayDecisionForDate(weekly, day)
    return { holiday, decision, blocked: holidayIsBlocked(holiday, decision) }
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const records = days.flatMap(day => dayPlan(day).teams.flatMap(team => (team.tasks || []).map(task => ({ day, task }))))
      document.querySelectorAll('.week-task-summary').forEach((node, index) => {
        appendTraceElement(node, records[index]?.task)
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
    // Mantiene la ventana semanal vigente aunque la pantalla permanezca abierta a medianoche.
    const refreshDay = () => setToday(localToday())
    const now = new Date()
    const nextMidnight = new Date(now)
    nextMidnight.setHours(24, 0, 1, 0)
    const timeout = window.setTimeout(refreshDay, nextMidnight.getTime() - now.getTime())
    return () => window.clearTimeout(timeout)
  }, [today])
  useEffect(() => {
    const board = weeklyBoardRef.current
    if (!board) return
    const currentDay = board.querySelector(`[data-day="${today}"]`)
    if (!currentDay) {
      board.scrollLeft = 0
      return
    }
    const boardRect = board.getBoundingClientRect()
    const dayRect = currentDay.getBoundingClientRect()
    board.scrollLeft += dayRect.left - boardRect.left
    syncWeeklyScroll(board, weeklyTopScrollRef.current)
  }, [days, today])
  useEffect(() => {
    const board = weeklyBoardRef.current
    if (!board) return
    const updateWidth = () => {
      const topScroll = weeklyTopScrollRef.current
      const boardRange = Math.max(0, board.scrollWidth - board.clientWidth)
      setWeeklyScrollWidth(boardRange + (topScroll?.clientWidth || board.clientWidth))
      window.requestAnimationFrame(() => syncWeeklyScroll(board, topScroll))
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(board)
    if (weeklyTopScrollRef.current) observer.observe(weeklyTopScrollRef.current)
    Array.from(board.children).forEach(column => observer.observe(column))
    return () => observer.disconnect()
  }, [days, weekly])
  const dayPlan = day => {
    const defaults = createDay(day)
    const stored = weekly[day]
    const targetTimes = defaultServiceTimesForDate(day, weekly)
    const storedTeams = alignDefaultServiceTimes(stored?.teams || [], day, targetTimes, fallbackDefaultServiceTimesForDate(day))
    const plan = stored
      ? { ...stored, teams: mergeStoredTeamsWithDefaults(defaults.teams, storedTeams) }
      : defaults
    const visiblePlan = { ...plan, teams: applyRemovedWeeklySlots(plan.teams, plan.removedSlots || []) }
    const normalized = isSaturday(day) ? { ...visiblePlan, teams: assignGuardToEmptySaturday(normalizeSaturdayTeams(visiblePlan.teams, day, weekly), day, weekly, activeTechs) } : visiblePlan
    return sortPlanTasksByTime(normalized)
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
    const visibleStored = { ...stored, teams: applyRemovedWeeklySlots(stored.teams, stored.removedSlots || []) }
    const base = isSaturday(day) ? { ...visibleStored, teams: assignGuardToEmptySaturday(normalizeSaturdayTeams(visibleStored.teams, day, previous), day, previous, activeTechs) } : visibleStored
    const next = mutate(base)
    const normalized = isSaturday(day) ? { ...next, teams: assignGuardToEmptySaturday(normalizeSaturdayTeams(next.teams, day, previous), day, previous, activeTechs) } : next
    return { ...previous, [day]: sortPlanTasksByTime(normalized) }
  })
  const openTaskEditor = (day, teamIndex, taskIndex) => {
    const teamSnapshot = dayPlan(day).teams[teamIndex]
    const task = teamSnapshot?.tasks[taskIndex]
    if (task) setTaskEditor({ day, teamIndex, taskIndex, teamId: teamSnapshot.teamId, teamSnapshot: { ...teamSnapshot, tasks: [...(teamSnapshot.tasks || [])] }, taskId: task.taskId, draft: { ...task } })
  }
  const updateTaskDraft = patch => setTaskEditor(previous => previous ? { ...previous, draft: { ...previous.draft, ...patch } } : previous)
  const selectDraftService = selectedId => {
    const selected = services.find(service => String(service.id) === String(selectedId))
    const currentTask = taskEditor?.draft || blankTask()
    const nextTask = selected
      ? { ...currentTask, serviceId: selected.id, service: selected.name, installationZone: serviceCode(selected) === 'alarm-installation' ? currentTask.installationZone || '' : '' }
      : { ...currentTask, serviceId: '', service: '', installationZone: '' }
    updateTaskDraft({ ...nextTask, ...applicableServiceExtras(nextTask, selected) })
  }
  const commitDraftCustomerText = value => updateTaskDraft({ customerId: '', client: value, clientAccount: '', clientNameAtService: '', address: '', phone: '' })
  const selectDraftCustomer = customer => updateTaskDraft({ customerId: customer.customerId, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name, address: customer.address, phone: customer.phone })
  const saveTaskEditor = () => {
    if (!taskEditor) return
    const { day, teamIndex, taskIndex, teamId, teamSnapshot, taskId, draft } = taskEditor
    const advance = advancedGuardForDay(day)
    if (advance) {
      setTaskEditor(null)
      setNotice(advancedSaturdayGuardMessage(advance))
      return
    }
    const missing = []
    if (!draft.time) missing.push('hora')
    if (!draft.serviceId || !draft.service) missing.push('tipo de servicio')
    if (!draft.customerId) missing.push('cliente o cuenta')
    if (!String(draft.address || '').trim()) missing.push('dirección')
    if (!String(draft.detail || '').trim()) missing.push('detalle')
    if (serviceCode(serviceForWeeklyTask(draft)) === 'alarm-installation' && !draft.installationZone) missing.push('ubicación de la instalación')
    if (requiresPaymentAmount(draft, serviceForWeeklyTask(draft))) missing.push('monto')
    if (missing.length) {
      setNotice(`Completá ${missing.join(', ')} antes de guardar el servicio.`)
      return
    }
    const tracedDraft = stampServiceRecord({ ...draft, ...applicableServiceExtras(draft, serviceForWeeklyTask(draft)) }, authUser)
    updateDay(day, plan => {
      const nextTeams = [...plan.teams]
      let destinationIndex = nextTeams.findIndex(team => teamId && String(team.teamId || '') === String(teamId))
      // Los días aún no persistidos se construyen visualmente con IDs
      // temporales. La posición capturada por el modal es la referencia segura
      // si esos IDs cambiaron antes de presionar Guardar.
      if (destinationIndex < 0 && nextTeams[teamIndex]) destinationIndex = teamIndex
      if (destinationIndex < 0) {
        const restoredTasks = (teamSnapshot?.tasks || []).map(task => String(task.taskId || '') === String(taskId || '') ? { ...task, ...tracedDraft } : task)
        if (!restoredTasks.some(task => String(task.taskId || '') === String(taskId || ''))) restoredTasks.push(tracedDraft)
        nextTeams.push({ ...teamSnapshot, teamId: teamId || teamSnapshot?.teamId || createTeamId(), label: teamSnapshot?.label || `Equipo ${teamIndex + 1}`, tasks: sortTasksByTime(restoredTasks) })
      } else {
        const destination = nextTeams[destinationIndex]
        const existingTaskIndex = (destination.tasks || []).findIndex((task, index) => (taskId && String(task.taskId || '') === String(taskId)) || (!taskId && index === taskIndex))
        const tasks = existingTaskIndex >= 0
          ? destination.tasks.map((task, index) => index === existingTaskIndex ? { ...task, ...tracedDraft } : task)
          : [...(destination.tasks || []), tracedDraft]
        nextTeams[destinationIndex] = { ...destination, tasks: sortTasksByTime(tasks) }
      }
      return { ...plan, teams: nextTeams }
    })
    window.dispatchEvent(new CustomEvent('pignus:sync-weekly-task', { detail: { day, teamId, teamIndex, taskIndex, taskId, draft: tracedDraft, teamSnapshot } }))
    setTaskEditor(null)
    setNotice('Servicio actualizado y ordenado por horario.')
  }
  const openWeeklyTaskMove = (event, day, teamIndex, taskIndex) => {
    event.stopPropagation()
    const plan = dayPlan(day)
    const sourceTeam = plan.teams[teamIndex]
    const task = sourceTeam?.tasks?.[taskIndex]
    if (!task || plan.teams.length < 2) return
    const firstDestination = plan.teams.findIndex((_, index) => index !== teamIndex)
    setTaskMove({
      day,
      sourceTeamIndex: teamIndex,
      sourceTeamId: sourceTeam.teamId,
      taskIndex,
      taskId: task.taskId,
      historyId: task.historyId,
      destinationTeamIndex: firstDestination
    })
  }
  const confirmWeeklyTaskMove = () => {
    if (!taskMove) return
    const { day, sourceTeamIndex, sourceTeamId, taskIndex, taskId, historyId, destinationTeamIndex } = taskMove
    const plan = dayPlan(day)
    let resolvedSourceIndex = plan.teams.findIndex(team => sourceTeamId && String(team.teamId || '') === String(sourceTeamId))
    if (resolvedSourceIndex < 0) resolvedSourceIndex = sourceTeamIndex
    const sourceTeam = plan.teams[resolvedSourceIndex]
    const movedTask = stampServiceRecord((sourceTeam?.tasks || []).find(task => taskId && String(task.taskId || '') === String(taskId)) || sourceTeam?.tasks?.[taskIndex], authUser)
    const destinationTeam = plan.teams[destinationTeamIndex]
    if (!movedTask || !destinationTeam || destinationTeamIndex === resolvedSourceIndex) {
      setTaskMove(null)
      return
    }
    const matchesTask = task => (taskId && String(task.taskId || '') === String(taskId)) || (historyId && String(task.historyId || '') === String(historyId))
    const nextTeams = plan.teams.map((team, index) => {
      let tasks = (team.tasks || []).filter(task => !matchesTask(task))
      if (index === destinationTeamIndex) {
        tasks = tasks.filter(task => !(
          task.time === movedTask.time &&
          !String(task.client || '').trim() &&
          !String(task.service || '').trim()
        ))
        tasks = sortTasksByTime([...tasks, movedTask])
      }
      return { ...team, tasks }
    })
    const nextDestination = nextTeams[destinationTeamIndex]
    setWeekly(previous => ({ ...previous, [day]: { ...plan, teams: nextTeams } }))
    window.dispatchEvent(new CustomEvent('pignus:move-weekly-task', {
      detail: {
        day,
        taskId: movedTask.taskId || taskId,
        historyId: movedTask.historyId || historyId,
        destinationTeamId: nextDestination.teamId,
        destinationTeamIndex,
        destinationTeam: {
          teamId: nextDestination.teamId,
          label: nextDestination.label || `Equipo ${destinationTeamIndex + 1}`,
          memberIds: nextDestination.memberIds || [],
          members: nextDestination.members || []
        }
      }
    }))
    setTaskMove(null)
    setNotice(`El servicio fue reasignado a ${nextDestination.label || `Equipo ${destinationTeamIndex + 1}`} y se conservó toda su información.`)
  }
  const updateTeam = (day, teamIndex, patch) => updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index === teamIndex ? { ...team, ...patch } : team) }))
  const toggleWeeklyTech = (day, teamIndex, technician) => {
    const advance = advancedGuardForDay(day)
    if (advance) {
      setTechPicker(null)
      setNotice(advancedSaturdayGuardMessage(advance))
      return
    }
    technician = typeof technician === 'string' ? activeTechs.find(item => item.name === technician) : technician
    if (!technician) return
    updateDay(day, plan => {
      const actualIndex = isSaturday(day) ? 0 : teamIndex
      const target = plan.teams[actualIndex] || {}
      const selected = (target.memberIds || []).some(id => String(id) === String(technician.id))
      const teams = plan.teams.map((team, index) => {
        if (index !== actualIndex) return team
        if (isSaturday(day)) {
          // Un sábado admite una sola persona: elegir otro nombre crea una
          // excepción puntual sin modificar la rotación anual.
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
      return { ...plan, teams }
    })
  }
  const updateTask = (day, teamIndex, taskIndex, patch) => updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index !== teamIndex ? team : { ...team, tasks: team.tasks.map((task, index) => index === taskIndex ? stampServiceRecord({ ...task, ...patch }, authUser) : task) }) }))
  const addTeam = day => {
    if (isSaturday(day)) { setNotice('Los sábados trabaja un solo técnico, por lo que la agenda admite únicamente un equipo.'); return }
    updateDay(day, plan => ({ ...plan, teams: [...plan.teams, createTeam(plan.teams.length, null, day)] }))
  }
  const removeWeeklyTeam = (day, teamIndex) => {
    updateDay(day, plan => ({
      ...plan,
      teams: plan.teams.filter((_, index) => index !== teamIndex).map((team, index) => ({
        ...team,
        label: /^Equipo \d+$/.test(team.label || '') ? `Equipo ${index + 1}` : team.label
      }))
    }))
    setTechPicker(null)
    setNotice('El equipo fue eliminado.')
  }
  const hoursForDay = day => {
    const weekDay = new Date(`${day}T12:00:00`).getDay()
    if (weekDay === 0) return null
    return { min: '08:00', max: weekDay === 5 ? '20:00' : weekDay === 6 ? '12:00' : '17:00', label: weekDay === 5 ? '08:00 a 20:00' : weekDay === 6 ? '08:00 a 12:00' : '08:00 a 17:00' }
  }
  const conflictsForDay = day => {
    return technicianTimeConflicts(dayPlan(day).teams, activeTechs)
  }
  const commitWeeklyCustomerText = (day, teamIndex, taskIndex, value) => updateTask(day, teamIndex, taskIndex, { customerId: '', client: value, clientAccount: '', clientNameAtService: '', address: '', phone: '' })
  const selectWeeklyCustomerResult = (day, teamIndex, taskIndex, customer) => updateTask(day, teamIndex, taskIndex, { customerId: customer.customerId, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name, address: customer.address, phone: customer.phone })
  const addTask = (day, teamIndex) => {
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
    updateDay(day, plan => ({ ...plan, teams: plan.teams.map((team, index) => index === teamIndex ? { ...team, tasks: [...team.tasks, { ...blankTask(), time: '', manualSlot: true }] } : team) }))
  }
  const removeWeeklyTask = ({ day, teamId, teamIndex, taskId, historyId, taskIndex, time, wasPlaceholder }) => {
    updateDay(day, plan => {
      let removedSlots = plan.removedSlots || []
      const teams = plan.teams.map((team, index) => {
        const sameTeam = (teamId && String(team.teamId || '') === String(teamId)) || index === teamIndex
        if (!sameTeam) return team
        if (wasPlaceholder) removedSlots = appendRemovedWeeklySlot(removedSlots, team, index, time)
        let removed = false
        return {
          ...team,
          tasks: (team.tasks || []).filter((task, index) => {
            if (removed) return true
            const taskTime = String(task.time || task.scheduledTime || '').trim()
            const sameId = taskId && String(task.taskId || '') === String(taskId)
            const sameHistory = historyId && String(task.historyId || '') === String(historyId)
            const samePlaceholder = wasPlaceholder && !taskHasContent(task) && taskTime === String(time || '').trim()
            const sameIndex = index === taskIndex && (!time || taskTime === String(time).trim())
            if (sameId || sameHistory || samePlaceholder || sameIndex) {
              removed = true
              return false
            }
            return true
          })
        }
      })
      return { ...plan, removedSlots, teams }
    })
    window.dispatchEvent(new CustomEvent('pignus:remove-weekly-task', { detail: { day, taskId, historyId } }))
    setTaskRemoval(null)
    setNotice('El servicio fue eliminado de la planificación semanal.')
  }
  const suggestedMonthlyTeams = () => {
    const rotation = monthlyTeamRotation(activeTechs, monthKey)
    if (rotation.length === 3) return rotation.map((members, index) => ({ teamId: createTeamId(), label: `Equipo ${index + 1}`, memberIds: members.map(tech => tech.id), members: members.map(tech => tech.name) }))
    return (monthlyTeams[previousMonthKey]?.teams || [null, null, null]).map((team, index) => ({ teamId: team?.teamId || createTeamId(), label: team?.label || `Equipo ${index + 1}`, memberIds: team?.memberIds || [], members: team?.members || [] }))
  }
  const suggestedMonthlyTimes = () => {
    const current = monthlyTeams[monthKey]?.defaultTimes
    if (validDefaultServiceTimes(current)) return current
    const previous = monthlyTeams[previousMonthKey]?.defaultTimes
    return validDefaultServiceTimes(previous) ? previous : fallbackDefaultServiceTimesForDate(`${monthKey}-01`)
  }
  const openMonthlySetup = () => {
    if (!isAdministrator) { setNotice('Solo un administrador puede definir los equipos mensuales.'); return }
    setMonthlySetup({ month: monthKey, teams: baseTeams ? baseTeams.map(team => ({ teamId: team.teamId || createTeamId(), label: team.label, memberIds: team.memberIds || [], members: team.members || [] })) : suggestedMonthlyTeams() })
  }
  const openMonthlyTimesSetup = () => {
    if (!isAdministrator) { setNotice('Solo un administrador puede definir los horarios mensuales.'); return }
    setMonthlyTimesSetup({ month: monthKey, times: [...suggestedMonthlyTimes()] })
  }
  const updateMonthlyTeam = (index, memberIds) => { const selected = activeTechs.filter(tech => memberIds.some(id => String(id) === String(tech.id))); setMonthlySetup(previous => ({ ...previous, teams: previous.teams.map((team, teamIndex) => teamIndex === index ? { ...team, memberIds: selected.map(tech => tech.id), members: selected.map(tech => tech.name) } : team) })) }
  const addMonthlyTeam = () => setMonthlySetup(previous => ({ ...previous, teams: [...previous.teams, { teamId: createTeamId(), label: `Equipo ${previous.teams.length + 1}`, memberIds: [], members: [] }] }))
  const saveMonthlySetup = () => {
    setWeekly(previous => ({ ...previous, _monthlyTeams: { ...(previous._monthlyTeams || {}), [monthlySetup.month]: { ...(previous._monthlyTeams?.[monthlySetup.month] || {}), teams: monthlySetup.teams } } }))
    setMonthlySetup(null)
    setNotice(`Los equipos predeterminados de ${new Date(`${monthKey}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })} fueron guardados.`)
  }
  const saveMonthlyTimesSetup = () => {
    if (!validDefaultServiceTimes(monthlyTimesSetup?.times)) return
    setWeekly(previous => {
      const currentConfig = previous._monthlyTeams?.[monthlyTimesSetup.month] || {}
      const sourceTimes = validDefaultServiceTimes(currentConfig.defaultTimes)
        ? currentConfig.defaultTimes
        : fallbackDefaultServiceTimesForDate(`${monthlyTimesSetup.month}-01`)
      const migrated = applyMonthlyDefaultTimes(previous, monthlyTimesSetup.month, sourceTimes, monthlyTimesSetup.times)
      return {
        ...migrated,
        _monthlyTeams: {
          ...(migrated._monthlyTeams || {}),
          [monthlyTimesSetup.month]: { ...currentConfig, defaultTimes: monthlyTimesSetup.times }
        }
      }
    })
    setMonthlyTimesSetup(null)
    setNotice(`Los horarios predeterminados de ${new Date(`${monthKey}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })} fueron guardados.`)
  }
  const annualGuardDraft = year => ({ year: String(year), rotation: /^\d{4}$/.test(String(year)) ? suggestedAnnualGuardRotation(String(year)) : [] })
  const openAnnualGuardSetup = () => {
    if (!isAdministrator) { setNotice('Solo un administrador puede definir las guardias anuales.'); return }
    setAnnualGuardSetup(annualGuardDraft(anchorYear))
  }
  const changeAnnualGuardYear = year => setAnnualGuardSetup(annualGuardDraft(year))
  const updateAnnualGuardTechnician = (index, technicianId) => {
    const technician = activeTechs.find(item => String(item.id) === String(technicianId))
    if (!technician) return
    setAnnualGuardSetup(previous => ({ ...previous, rotation: previous.rotation.map((item, itemIndex) => itemIndex === index ? { technicianId: technician.id, name: technician.name } : item) }))
  }
  const addAnnualGuardTechnician = () => {
    const available = activeTechs.find(tech => !annualGuardSetup.rotation.some(item => String(item.technicianId) === String(tech.id))) || activeTechs[0]
    if (!available) return
    setAnnualGuardSetup(previous => ({ ...previous, rotation: [...previous.rotation, { technicianId: available.id, name: available.name }] }))
  }
  const moveAnnualGuardTechnician = (index, direction) => setAnnualGuardSetup(previous => {
    const destination = index + direction
    if (destination < 0 || destination >= previous.rotation.length) return previous
    const rotation = [...previous.rotation]
    ;[rotation[index], rotation[destination]] = [rotation[destination], rotation[index]]
    return { ...previous, rotation }
  })
  const removeAnnualGuardTechnician = index => setAnnualGuardSetup(previous => ({ ...previous, rotation: previous.rotation.filter((_, itemIndex) => itemIndex !== index) }))
  const saveAnnualGuardSetup = () => {
    const rotation = annualGuardSetup?.rotation || []
    const duplicated = new Set(rotation.map(item => String(item.technicianId || item.name))).size !== rotation.length
    if (!/^\d{4}$/.test(annualGuardSetup?.year || '') || !rotation.length || duplicated) return
    const year = annualGuardSetup.year
    setWeekly(previous => ({
      ...previous,
      _annualGuards: {
        ...(previous._annualGuards || {}),
        [year]: { startDate: firstSaturdayOfYear(year), rotation }
      }
    }))
    setAnnualGuardSetup(null)
    setNotice(`El cronograma de guardias de ${year} fue guardado y se repetirá automáticamente cada sábado.`)
  }
  useEffect(() => {
    // Al comenzar un mes el administrador confirma primero los equipos y luego
    // los dos turnos que se usarán como horarios predeterminados.
    if (!isAdministrator) return
    const config = monthlyTeams[monthKey]
    if (!config?.teams?.length && monthlySetup?.month !== monthKey) {
      setMonthlyTimesSetup(null)
      setMonthlySetup({ month: monthKey, teams: suggestedMonthlyTeams() })
      return
    }
    if (config?.teams?.length && !validDefaultServiceTimes(config.defaultTimes) && !monthlySetup && monthlyTimesSetup?.month !== monthKey) {
      setMonthlyTimesSetup({ month: monthKey, times: [...suggestedMonthlyTimes()] })
    }
  }, [isAdministrator, monthKey, monthlyTeams[monthKey], monthlySetup, monthlyTimesSetup])
  const openDay = day => {
    const hours = hoursForDay(day)
    if (!hours) { setNotice('Los domingos no están habilitados para programar servicios.'); return }
    const holidayState = holidayStateForDay(day)
    if (holidayState.blocked) { setNotice(holidayState.decision?.status === 'closed' ? 'La fecha fue definida como día no operativo.' : 'Primero definí si el feriado será laboral o no operativo.'); return }
    const advance = advancedGuardForDay(day)
    if (advance) { setNotice(advancedSaturdayGuardMessage(advance)); return }
    const invalidTime = dayPlan(day).teams.flatMap(team => team.tasks).find(task => task.time && (task.time < hours.min || task.time > hours.max))
    if (invalidTime) { setNotice(`Hay horarios fuera del rango permitido para este día (${hours.label}).`); return }
    const scheduledTasks = dayPlan(day).teams.flatMap((team, teamIndex) => team.tasks.map((task, taskIndex) => ({ task, teamIndex, taskIndex }))).filter(({ task }) => [task.service, task.client, task.address, task.detail, task.phone, task.paymentMethod, task.amount, task.monthlyFee, task.form].some(value => String(value || '').trim()))
    const incompleteTask = scheduledTasks.find(({ task }) => !task.time || !task.service || !task.customerId || !task.address || !task.phone || !task.detail || (serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && !task.installationZone) || requiresPaymentAmount(task, serviceForWeeklyTask(task)))
    if (incompleteTask) {
      const { task, teamIndex, taskIndex } = incompleteTask
      const missing = [['hora', task.time], ['tipo de servicio', task.service], ['cliente', task.client], ['dirección', task.address], ['contacto', task.phone], ['detalle', task.detail]].filter(([, value]) => !String(value || '').trim()).map(([label]) => label)
      if (serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && !task.installationZone) missing.push('ubicación de la instalación')
      if (requiresPaymentAmount(task, serviceForWeeklyTask(task))) missing.push('monto')
      setNotice(`Completá los campos obligatorios de Equipo ${teamIndex + 1}, tarjeta ${taskIndex + 1}: ${missing.join(', ')}.`)
      return
    }
    const conflicts = conflictsForDay(day)
    if (conflicts.length) { setNotice(`Conflicto de asignación: ${conflicts.map(item => `${item.name} a las ${item.time} (equipos ${item.teams.join(' y ')})`).join('; ')}.`); return }
    const teams = dayPlan(day).teams.map(({ teamId, memberIds, members, tasks }) => ({ teamId, memberIds, members, tasks }))
    openDaily(day, teams)
    setNotice(`Se cargó la planificación semanal del ${prettyDate(day)} en la agenda técnica.`)
  }
  const weeklyHistoryRecord = (day, team, teamIndex, task, taskIndex) => ({
    id: task.historyId || `work-${task.taskId || `${day}-${teamIndex}-${taskIndex}`}`,
    sourceTaskId: task.taskId,
    date: day,
    time: task.time,
    scheduledTime: task.time,
    team: team.label || `Equipo ${teamIndex + 1}`,
    teamId: team.teamId,
    technicianIds: team.memberIds || [],
    technicians: team.members || [],
    serviceId: serviceForWeeklyTask(task)?.id || task.serviceId,
    service: serviceForWeeklyTask(task)?.name || task.service,
    client: task.client,
    customerId: task.customerId || '',
    clientAccount: task.clientAccount || '',
    clientNameAtService: task.clientNameAtService || String(task.client || '').replace(/^[^\s]+\s+/, ''),
    detail: task.detail,
    ...applicableServiceExtras(task, serviceForWeeklyTask(task)),
    address: task.address,
    phone: task.phone,
    installationZone: task.installationZone || '',
    ...serviceTrace(task)
  })
  const recordMatchesWeeklyTask = (record, expected) => {
    if (!record) return false
    const comparable = value => String(value || '').trim()
    const sameList = (left, right) => JSON.stringify((left || []).map(String)) === JSON.stringify((right || []).map(String))
    return ['date', 'time', 'teamId', 'serviceId', 'service', 'customerId', 'clientAccount', 'client', 'detail', 'address', 'phone', 'installationZone', 'paymentMethod', 'amount', 'monthlyFee', 'form'].every(key => comparable(record[key]) === comparable(expected[key])) &&
      sameList(record.technicianIds, expected.technicianIds) && sameList(record.technicians, expected.technicians)
  }
  const dayNeedsSave = day => dayPlan(day).teams.some((team, teamIndex) => (team.tasks || []).some((task, taskIndex) => {
    if (!weeklyTaskReadyToSave(task, team, serviceForWeeklyTask(task))) return false
    return !recordMatchesWeeklyTask(historyRecordForTask(task, day, operationalHistory), weeklyHistoryRecord(day, team, teamIndex, task, taskIndex))
  }))
  const saveWeeklyDay = day => {
    const hours = hoursForDay(day)
    if (!hours) { setNotice('Los domingos no están habilitados para programar servicios.'); return }
    const holidayState = holidayStateForDay(day)
    if (holidayState.blocked) { setNotice(holidayState.decision?.status === 'closed' ? 'La fecha fue definida como día no operativo.' : 'Primero definí si el feriado será laboral o no operativo.'); return }
    const advance = advancedGuardForDay(day)
    if (advance) { setNotice(advancedSaturdayGuardMessage(advance)); return }
    const plan = dayPlan(day)
    const scheduledTasks = plan.teams.flatMap((team, teamIndex) => team.tasks.map((task, taskIndex) => ({ task, team, teamIndex, taskIndex }))).filter(({ task }) => taskHasContent(task))
    if (!scheduledTasks.length) { setNotice('No hay servicios cargados para guardar en este día.'); return }
    const readyTasks = scheduledTasks.filter(({ task, team }) => weeklyTaskReadyToSave(task, team, serviceForWeeklyTask(task)))
    if (!readyTasks.length) {
      const incompleteTask = scheduledTasks[0]
      const { task, teamIndex, taskIndex } = incompleteTask
      const missing = weeklyTaskMissingFields(task, serviceForWeeklyTask(task))
      if (!(incompleteTask.team.members || []).length) missing.push('técnicos asignados')
      setNotice(`Completá los campos obligatorios de Equipo ${teamIndex + 1}, tarjeta ${taskIndex + 1}: ${missing.join(', ')}.`)
      return
    }
    const invalidTime = readyTasks.find(({ task }) => task.time < hours.min || task.time > hours.max)
    if (invalidTime) { setNotice(`Hay horarios fuera del rango permitido para este día (${hours.label}).`); return }
    const readyTaskSet = new Set(readyTasks.map(({ task }) => task))
    const conflicts = technicianTimeConflicts(plan.teams.map(team => ({ ...team, tasks: (team.tasks || []).filter(task => readyTaskSet.has(task)) })), activeTechs)
    if (conflicts.length) { setNotice(`Conflicto de asignación: ${conflicts.map(item => `${item.name} a las ${item.time} (equipos ${item.teams.join(' y ')})`).join('; ')}.`); return }
    const records = readyTasks.map(({ task, team, teamIndex, taskIndex }) => weeklyHistoryRecord(day, team, teamIndex, task, taskIndex))
    const setOperationalHistory = setHistory || globalThis.__pignusSetHistory
    if (typeof setOperationalHistory !== 'function') { setNotice('No se pudo acceder al Historial. Recargá la página e intentá nuevamente.'); return }
    setOperationalHistory(previous => {
      const replacements = records.map(record => {
        const existing = previous.find(item => item.id === record.id || (record.sourceTaskId && String(item.sourceTaskId || '') === String(record.sourceTaskId)))
        return existing ? { ...existing, ...record, id: existing.id } : { ...record, status: 'Pendiente' }
      })
      const replacedIds = new Set(replacements.map(record => record.id))
      return [...replacements, ...previous.filter(record => !replacedIds.has(record.id))]
    })
    const historyIds = new Map(records.map(record => [String(record.sourceTaskId || record.id), record.id]))
    updateDay(day, current => ({ ...current, teams: current.teams.map(team => ({ ...team, tasks: team.tasks.map(task => ({ ...task, historyId: historyIds.get(String(task.taskId || task.historyId)) || task.historyId })) })) }))
    const skipped = scheduledTasks.length - readyTasks.length
    setNotice(skipped
      ? `Se guardaron ${records.length} servicio(s) del ${prettyDate(day)}. ${skipped} servicio(s) incompleto(s) quedaron sin guardar.`
      : `La agenda del ${prettyDate(day)} fue guardada y sus servicios quedaron pendientes en el Historial.`)
  }
  const displayDate = day => new Date(`${day}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')
  return <>
    {techPicker && <button className="picker-backdrop" aria-label="Cerrar selector de técnicos" onClick={() => setTechPicker(null)} />}
    {teamRemoval && <Confirm title="Quitar equipo" detail={`¿Querés quitar ${teamRemoval.label} de la planificación del ${prettyDate(teamRemoval.day)}? Se eliminarán también sus servicios.`} destructive action={() => removeWeeklyTeam(teamRemoval.day, teamRemoval.teamIndex)} close={() => setTeamRemoval(null)} />}
    {taskRemoval && <Confirm title="Eliminar servicio" detail={`¿Querés eliminar el Servicio ${taskRemoval.taskIndex + 1} de ${taskRemoval.label} para el ${prettyDate(taskRemoval.day)}?${taskRemoval.historyId ? ' También se quitará el registro pendiente vinculado.' : ''}`} destructive action={() => removeWeeklyTask(taskRemoval)} close={() => setTaskRemoval(null)} />}
    {taskMove && (() => {
      const plan = dayPlan(taskMove.day)
      const sourceTeam = plan.teams[taskMove.sourceTeamIndex]
      return <div className="modal-backdrop weekly-editor-backdrop" onMouseDown={() => setTaskMove(null)}><section className="modal task-move-modal weekly-move-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-move-title" onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => setTaskMove(null)}><Icon name="close" /></button><p className="eyebrow">REASIGNAR SERVICIO</p><h2 id="weekly-move-title">Mover a otro equipo</h2><p>El servicio conservará horario, cliente, tipo de servicio y observaciones. También se actualizarán Agenda del día e Historial si ya fueron registrados.</p><label>Equipo actual<input value={sourceTeam?.label || `Equipo ${taskMove.sourceTeamIndex + 1}`} readOnly /></label><label>Nuevo equipo<select value={taskMove.destinationTeamIndex} onChange={event => setTaskMove(previous => ({ ...previous, destinationTeamIndex: Number(event.target.value) }))}>{plan.teams.map((team, index) => index !== taskMove.sourceTeamIndex && <option key={team.teamId || index} value={index}>{team.label || `Equipo ${index + 1}`} · {team.members?.join(' / ') || 'Sin técnicos'}</option>)}</select></label><div className="modal-actions"><button className="secondary" onClick={() => setTaskMove(null)}>Cancelar</button><button className="primary" onClick={confirmWeeklyTaskMove}><span aria-hidden="true">⇄</span>Reasignar servicio</button></div></section></div>
    })()}
    {monthlySetup && <div className="modal-backdrop monthly-backdrop"><section className="modal monthly-teams-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setMonthlySetup(null)}><Icon name="close" /></button><p className="eyebrow">CONFIGURACIÓN MENSUAL</p><h2>Equipos de {new Date(`${monthlySetup.month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</h2><p>Con cinco técnicos activos, el sistema propone dos duplas y una salida individual, rotando mensualmente todas las combinaciones. Podés modificar la sugerencia antes de guardarla. Las agendas ya cargadas no se alteran.</p><div className="monthly-team-list">{monthlySetup.teams.map((team, index) => <label key={team.teamId || index}><b>{team.label || `Equipo ${index + 1}`}</b><select multiple value={team.memberIds || []} onChange={event => updateMonthlyTeam(index, [...event.target.selectedOptions].map(option => option.value))}>{activeTechs.map(tech => <option key={tech.id} value={tech.id}>{tech.firstName || tech.name.split(' ')[0]}</option>)}</select><small>Mantené presionada la tecla Ctrl para seleccionar más de un técnico.</small></label>)}</div><button className="secondary monthly-add-team" onClick={addMonthlyTeam}><Icon name="plus" size={15} />Agregar equipo</button><div className="modal-actions"><button className="secondary" onClick={() => setMonthlySetup(null)}>Cancelar</button><button className="primary" onClick={saveMonthlySetup}>Guardar equipos del mes</button></div></section></div>}
    {monthlyTimesSetup && <div className="modal-backdrop monthly-backdrop"><section className="modal monthly-times-modal" role="dialog" aria-modal="true" aria-labelledby="monthly-times-title"><button className="modal-close" onClick={() => setMonthlyTimesSetup(null)}><Icon name="close" /></button><p className="eyebrow">CONFIGURACIÓN MENSUAL</p><h2 id="monthly-times-title">Horarios de {new Date(`${monthlyTimesSetup.month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</h2><p>Definí los dos horarios que se aplicarán por defecto a los servicios nuevos del mes. Los servicios ya cargados conservarán su hora.</p><div className="monthly-time-grid">{monthlyTimesSetup.times.map((time, index) => <label key={index}><b>Turno {index + 1}</b><input type="time" required value={time} onChange={event => setMonthlyTimesSetup(previous => ({ ...previous, times: previous.times.map((item, timeIndex) => timeIndex === index ? event.target.value : item) }))} /></label>)}</div>{monthlyTimesSetup.times[0] === monthlyTimesSetup.times[1] && <p className="field-error">Los dos horarios deben ser diferentes.</p>}<div className="modal-actions"><button className="secondary" onClick={() => setMonthlyTimesSetup(null)}>Cancelar</button><button className="primary" disabled={!validDefaultServiceTimes(monthlyTimesSetup.times)} onClick={saveMonthlyTimesSetup}>Guardar horarios del mes</button></div></section></div>}
    {annualGuardSetup && (() => {
      const duplicated = new Set(annualGuardSetup.rotation.map(item => String(item.technicianId || item.name))).size !== annualGuardSetup.rotation.length
      const validYear = /^\d{4}$/.test(annualGuardSetup.year)
      return <div className="modal-backdrop monthly-backdrop"><section className="modal annual-guards-modal" role="dialog" aria-modal="true" aria-labelledby="annual-guards-title"><button className="modal-close" onClick={() => setAnnualGuardSetup(null)}><Icon name="close" /></button><p className="eyebrow">CONFIGURACIÓN ANUAL</p><h2 id="annual-guards-title">Guardias de fin de semana</h2><p>Definí el orden de rotación. El primer técnico cubrirá el primer sábado del año y luego el ciclo se repetirá durante todos los sábados.</p><label className="annual-guard-year">Año<input type="number" min="2026" max="2100" value={annualGuardSetup.year} onChange={event => changeAnnualGuardYear(event.target.value)} /></label><div className="annual-guard-list">{annualGuardSetup.rotation.map((guard, index) => {
        const legacyGuard = guard.name && !activeTechs.some(tech => String(tech.id) === String(guard.technicianId))
        return <div className="annual-guard-row" key={`${guard.technicianId || guard.name}-${index}`}><span>{index + 1}</span><select aria-label={`Técnico ${index + 1} de la rotación`} value={guard.technicianId || ''} onChange={event => updateAnnualGuardTechnician(index, event.target.value)}>{legacyGuard && <option value={guard.technicianId || ''}>{guard.name} (no activo)</option>}{activeTechs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select><button type="button" className="secondary" title="Subir" aria-label={`Subir a ${guard.name}`} disabled={index === 0} onClick={() => moveAnnualGuardTechnician(index, -1)}>↑</button><button type="button" className="secondary" title="Bajar" aria-label={`Bajar a ${guard.name}`} disabled={index === annualGuardSetup.rotation.length - 1} onClick={() => moveAnnualGuardTechnician(index, 1)}>↓</button><button type="button" className="icon-btn delete" title="Quitar de la rotación" aria-label={`Quitar a ${guard.name}`} onClick={() => removeAnnualGuardTechnician(index)}><Icon name="trash" size={15} /></button></div>
      })}</div><button type="button" className="secondary annual-guard-add" disabled={!activeTechs.length || !validYear} onClick={addAnnualGuardTechnician}><Icon name="plus" size={15} />Agregar técnico</button>{!validYear && <p className="field-error">Ingresá un año válido.</p>}{duplicated && <p className="field-error">Cada técnico puede aparecer una sola vez en la rotación.</p>}{validYear && !annualGuardSetup.rotation.length && <p className="field-error">Agregá al menos un técnico para generar el cronograma.</p>}<p className="annual-guard-help">Los cambios manuales realizados en un sábado específico se conservan como excepción.</p><div className="modal-actions"><button className="secondary" onClick={() => setAnnualGuardSetup(null)}>Cancelar</button><button className="primary" disabled={!validYear || !annualGuardSetup.rotation.length || duplicated} onClick={saveAnnualGuardSetup}>Guardar guardias del año</button></div></section></div>
    })()}
    <div className="module-intro weekly-intro"><div><p className="eyebrow">PLANIFICACIÓN SEMANAL</p><h1>Agenda semanal</h1><p>Prepará las visitas de cada equipo y luego abrí el día para terminar de validar y guardar la agenda del día.</p></div><div className="weekly-actions"><button className="secondary" onClick={openMonthlySetup}><Icon name="users" size={16} />Equipos del mes</button><button className="secondary" onClick={openMonthlyTimesSetup}><Icon name="calendar" size={16} />Horarios del mes</button><button className="secondary" onClick={openAnnualGuardSetup}><Icon name="users" size={16} />Guardias del año</button><label className="week-selector">Semana de trabajo<input type="date" value={anchor} onChange={event => setAnchor(event.target.value)} /></label></div></div>
    {taskEditor && (() => {
      const { day, teamIndex, taskIndex } = taskEditor
      const task = taskEditor.draft
      const hours = hoursForDay(day)
      if (!task || !hours) return null
      return <div className="modal-backdrop weekly-editor-backdrop" onMouseDown={() => setTaskEditor(null)}><section className="modal weekly-task-modal" role="dialog" aria-modal="true" aria-label={`Servicio ${taskIndex + 1}`} onMouseDown={event => event.stopPropagation()}><button type="button" className="modal-close" aria-label="Cerrar edición del servicio" title="Cerrar" onClick={() => setTaskEditor(null)}><Icon name="close" size={18} /></button><p className="eyebrow">AGENDA SEMANAL · {prettyDate(day)}</p><h2>Servicio {taskIndex + 1}</h2><p className="weekly-modal-team">{taskEditor.teamSnapshot?.label || `Equipo ${teamIndex + 1}`} · {taskEditor.teamSnapshot?.members?.join(' / ') || 'Sin técnicos asignados'}</p><div className="weekly-task-form"><div className="week-task-top"><label><RequiredLabel>Hora</RequiredLabel><input aria-required="true" type="time" min={hours.min} max={hours.max} value={task.time} onChange={event => updateTaskDraft({ time: event.target.value })} /></label><label><RequiredLabel>Tipo de servicio</RequiredLabel><select aria-required="true" value={serviceForWeeklyTask(task)?.id || ''} onChange={event => selectDraftService(event.target.value)}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label></div>{serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && <fieldset className="installation-zone weekly-installation-zone"><legend><RequiredLabel>Ubicación de la instalación</RequiredLabel></legend>{INSTALLATION_ZONES.map(([value, label]) => <label key={value}><input aria-required="true" type="radio" name={`weekly-zone-${day}-${teamIndex}-${taskIndex}`} checked={task.installationZone === value} onChange={() => { const nextTask = { ...task, installationZone: value }; updateTaskDraft({ installationZone: value, ...applicableServiceExtras(nextTask, serviceForWeeklyTask(task)) }) }} />{label}</label>)}</fieldset>}
<CustomerAutocomplete className="weekly-customer-search" value={task.client} customerId={task.customerId} customers={customers} onTextCommit={commitDraftCustomerText} onCustomerSelect={selectDraftCustomer} />
<label><RequiredLabel>Dirección</RequiredLabel><input aria-required="true" readOnly title="Este dato se modifica desde Abonados y clientes" value={task.address} /></label><label><RequiredLabel>Contacto</RequiredLabel><input aria-required="true" readOnly title="Este dato se modifica desde Abonados y clientes" value={task.phone} /></label><p className="weekly-customer-data-note">Dirección y contacto se administran desde el módulo Abonados y clientes.</p><label><RequiredLabel>Detalle</RequiredLabel><textarea aria-required="true" value={task.detail} onChange={event => updateTaskDraft({ detail: event.target.value })} /></label><ServiceExtraFields className="weekly-extra-fields" task={task} service={serviceForWeeklyTask(task)} onChange={updateTaskDraft} /></div><div className="modal-actions"><button className="secondary" onClick={() => setTaskEditor(null)}>Cancelar</button><button className="primary" onClick={saveTaskEditor}><Icon name="check" size={16} />Guardar servicio</button></div></section></div>
    })()}
    <div className="weekly-scroll-top" ref={weeklyTopScrollRef} tabIndex={0} aria-label="Desplazamiento horizontal superior" onScroll={event => syncWeeklyScroll(event.currentTarget, weeklyBoardRef.current)}><div style={{ width: `${weeklyScrollWidth}px` }} /></div>
    <div className="weekly-board" ref={weeklyBoardRef} onScroll={event => syncWeeklyScroll(event.currentTarget, weeklyTopScrollRef.current)}>
      {days.map(day => {
        const storedPlan = dayPlan(day)
        const advancedGuard = advancedGuardForDay(day)
        const holidayState = holidayStateForDay(day)
        const calendarUnavailable = holidayCalendar.loading || Boolean(holidayCalendar.error)
        const plan = calendarUnavailable || holidayState.blocked ? { ...storedPlan, teams: [] } : suppressAdvancedSaturdayAvailability(storedPlan, advancedGuard)
        const hours = hoursForDay(day)
        const conflicts = conflictsForDay(day)
        return <section className={`week-day ${!hours || holidayState.decision?.status === 'closed' ? 'closed-day' : ''}`} data-day={day} key={day}>
          <header><div><b>{displayDate(day)}</b><small>{!hours ? 'No operativo' : holidayState.holiday ? holidayDecisionLabel(holidayState.decision) : day === today ? 'Hoy' : prettyDate(day)}</small></div><div className="weekly-day-actions">{hours && !advancedGuard && !calendarUnavailable && !holidayState.blocked && dayNeedsSave(day) && <button className="primary small weekly-save-day" title="Guardado pendiente: guardar agenda" onClick={() => saveWeeklyDay(day)}><Icon name="check" size={15} />Guardar</button>}<button className="secondary small" disabled={!hours || Boolean(advancedGuard) || calendarUnavailable || holidayState.blocked} title={advancedGuard ? advancedSaturdayGuardMessage(advancedGuard) : holidayState.holiday ? holidayDecisionLabel(holidayState.decision) : ''} onClick={() => openDay(day)}>Abrir día</button></div></header>
          {!hours ? <p className="closed-day-note">Domingo · sin programación</p> : <>
            <small className="weekly-hours">Horario habilitado: {hours.label}</small>
            {calendarUnavailable ? <div className={`weekly-calendar-state ${holidayCalendar.error ? 'error' : ''}`}>{holidayCalendar.error ? 'No se pudo verificar el calendario de feriados.' : 'Verificando feriados nacionales…'}</div> : holidayState.holiday && <HolidayDecisionPanel compact holiday={holidayState.holiday} decision={holidayState.decision} canDecide={authUser?.roleCode === 'administrator'} onDecision={status => recordHolidayDecision(setWeekly, setNotice, day, holidayState.holiday, status)} />}
            {!holidayState.blocked && advancedGuard && <p className={`weekly-guard-advanced ${advancedGuard.hasSaturdayConflict ? 'has-conflict' : ''}`}><Icon name={advancedGuard.hasSaturdayConflict ? 'alert' : 'check'} size={16} /><span>{advancedSaturdayGuardMessage(advancedGuard)}</span></p>}
            {conflicts.length > 0 && <p className="weekly-conflict">Conflicto: {conflicts.map(item => `${item.name} ${item.time}`).join(', ')}</p>}
            <div className="week-teams">{plan.teams.map((team, teamIndex) => {
              const pickerKey = `${day}-${teamIndex}`
              return <article className="week-team" key={team.teamId || teamIndex}>
                <div className="week-team-header"><div className="week-team-identity"><strong>{team.label || `Equipo ${teamIndex + 1}`}</strong><span title={team.members?.join(' · ') || 'Sin técnicos'}>{team.members?.length ? team.members.map(weeklyTechnicianName).join(' · ') : 'Sin técnicos'}</span></div><div className="weekly-team-actions">{plan.teams.length > 1 && <button className="weekly-remove-team" title="Quitar equipo" aria-label={`Quitar ${team.label || `Equipo ${teamIndex + 1}`}`} onClick={() => setTeamRemoval({ day, teamIndex, label: team.label || `Equipo ${teamIndex + 1}` })}><Icon name="trash" size={15} /></button>}<div className="weekly-technicians-picker"><button className="secondary small weekly-add-tech-button" title="Agregar técnicos" aria-label="Agregar técnicos" onClick={() => { setTechPicker(techPicker === pickerKey ? null : pickerKey); setTechFilter('') }}><Icon name="users" size={16} /><span aria-hidden="true">+</span></button>{techPicker === pickerKey && <div className="tech-popover weekly-tech-popover"><div className="weekly-tech-popover-title"><div><strong>Asignar técnicos</strong><small>{team.label || `Equipo ${teamIndex + 1}`}</small></div><span>{team.members?.length || 0} seleccionados</span></div><input autoFocus placeholder="Buscar técnico..." value={techFilter} onChange={event => setTechFilter(event.target.value)} /><div className="tech-list">{activeTechs.filter(tech => tech.name.toLowerCase().includes(techFilter.toLowerCase())).map(tech => <label key={tech.id} title={tech.name}><input type="checkbox" checked={(team.members || []).includes(tech.name)} onChange={() => toggleWeeklyTech(day, teamIndex, tech.name)} />{tech.firstName || tech.name.split(' ')[0]}</label>)}{!activeTechs.length && <p>No hay técnicos activos.</p>}</div></div>}</div></div></div>
                {team.tasks.map((task, taskIndex) => <div className={`week-task week-task-summary ${!task.client ? 'available-slot' : ''}`} key={task.taskId || taskIndex} role="button" tabIndex={0} onClick={() => openTaskEditor(day, teamIndex, taskIndex)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTaskEditor(day, teamIndex, taskIndex) } }}>
                  <div className="week-task-title"><span>Servicio {taskIndex + 1}</span><div className="week-task-title-actions"><small>{task.time || '--:--'} Hs</small>{plan.teams.length > 1 && (task.customerId || task.client || task.service) && <button type="button" className="weekly-task-move" title="Reasignar a otro equipo" aria-label={`Reasignar Servicio ${taskIndex + 1} a otro equipo`} onClick={event => openWeeklyTaskMove(event, day, teamIndex, taskIndex)}><span aria-hidden="true">⇄</span></button>}<button type="button" className="weekly-task-delete" title="Eliminar servicio" aria-label={`Eliminar Servicio ${taskIndex + 1}`} onClick={event => { event.stopPropagation(); setTaskRemoval({ day, teamId: team.teamId, teamIndex, taskIndex, taskId: task.taskId, historyId: task.historyId, time: task.time || task.scheduledTime || '', wasPlaceholder: !taskHasContent(task), label: team.label || `Equipo ${teamIndex + 1}` }) }}><Icon name="trash" size={14} /></button></div></div><strong className="week-task-client">{task.client || 'Disponible'}</strong>
                  <TaskStatusBadge task={task} date={day} history={operationalHistory} weekly />
                  <div className="week-task-top"><label><RequiredLabel>Hora</RequiredLabel><input aria-required="true" type="time" min={hours.min} max={hours.max} value={task.time} onChange={event => updateTask(day, teamIndex, taskIndex, { time: event.target.value })} /></label><label><RequiredLabel>Tipo de servicio</RequiredLabel><select aria-required="true" value={serviceForWeeklyTask(task)?.id || ''} onChange={event => selectWeeklyService(day, teamIndex, taskIndex, event.target.value)}><option value="">Seleccionar</option>{activeServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label></div>
                  <CustomerAutocomplete value={task.client} customerId={task.customerId} customers={customers} onTextCommit={value => commitWeeklyCustomerText(day, teamIndex, taskIndex, value)} onCustomerSelect={customer => selectWeeklyCustomerResult(day, teamIndex, taskIndex, customer)} />
                  <label><RequiredLabel>Dirección</RequiredLabel><input aria-required="true" value={task.address} onChange={event => updateTask(day, teamIndex, taskIndex, { address: event.target.value })} /></label>
                  <label><RequiredLabel>Contacto</RequiredLabel><input aria-required="true" value={task.phone} onChange={event => updateTask(day, teamIndex, taskIndex, { phone: event.target.value })} /></label>
                  {serviceCode(serviceForWeeklyTask(task)) === 'alarm-installation' && <fieldset className="installation-zone weekly-installation-zone"><legend><RequiredLabel>Ubicación de la instalación</RequiredLabel></legend>{INSTALLATION_ZONES.map(([value, label]) => <label key={value}><input aria-required="true" type="radio" name={`weekly-card-zone-${day}-${teamIndex}-${taskIndex}`} checked={task.installationZone === value} onChange={() => { const nextTask = { ...task, installationZone: value }; updateTask(day, teamIndex, taskIndex, { installationZone: value, ...applicableServiceExtras(nextTask, serviceForWeeklyTask(task)) }) }} />{label}</label>)}</fieldset>}
                  <label><RequiredLabel>Detalle</RequiredLabel><textarea aria-required="true" value={task.detail} onChange={event => updateTask(day, teamIndex, taskIndex, { detail: event.target.value })} /></label>
                  <ServiceExtraFields className="weekly-extra-fields" task={task} service={serviceForWeeklyTask(task)} buffered onChange={patch => updateTask(day, teamIndex, taskIndex, patch)} />
                </div>)}
                {!advancedGuard && <button className="weekly-add-task" onClick={() => addTask(day, teamIndex)}><Icon name="plus" size={15} />Agregar servicio</button>}
              </article>
            })}</div>
            {!isSaturday(day) && <button className="weekly-add-team" onClick={() => addTeam(day)}><Icon name="plus" size={16} />Agregar otro equipo</button>}
          </>}
        </section>
      })}
    </div>
  </>
}

function PasswordResetReminder() {
  const [requests, setRequests] = useState([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout('/api/auth/password-reset-requests')
      const data = await response.json().catch(() => ({}))
      if (response.status === 403) { setRequests([]); setError(''); return }
      if (!response.ok) throw new Error(data.error || 'No se pudieron consultar las solicitudes.')
      setRequests(data.requests || []); setError('')
    } catch (loadError) { setError(loadError.message) }
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    const refresh = () => load()
    globalThis.addEventListener?.('focus', refresh)
    return () => { clearInterval(timer); globalThis.removeEventListener?.('focus', refresh) }
  }, [load])
  const resolve = async id => {
    const response = await fetchWithTimeout('/api/auth/password-reset-requests', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return setError(data.error || 'No se pudo cerrar la solicitud.')
    setRequests(current => current.filter(item => item.id !== id)); setError('')
  }
  if (!requests.length && !error) return null
  return <section className="password-reset-reminders" aria-label="Solicitudes de cambio de contraseña">{error && <p className="login-error" role="alert">{error}</p>}{requests.map(request => <article className="password-reset-reminder" key={request.id}><Icon name="settings" /><div><b>Solicitud de cambio de contraseña</b><span><strong>{request.email}</strong> solicita actualizar su contraseña.</span><small>{new Date(request.requestedAt).toLocaleString('es-AR')}</small></div><div className="password-reset-actions"><button className="secondary" type="button" onClick={() => window.dispatchEvent(new Event('pignus:open-employees'))}>Gestionar en Empleados</button><button className="primary" type="button" onClick={() => resolve(request.id)}>Marcar resuelta</button></div></article>)}</section>
}

function Dashboard({ history, services }) {
  return <DashboardView history={history} services={services} />
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const records = history.filter(record => record.date?.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date))
  const installations = records.filter(record => record.service?.toLowerCase().includes('instalación'))
  const alarms = installations.filter(record => record.service?.toLowerCase().includes('alarma'))
  const byZone = category => alarms.filter(record => { const address = `${record.address || ''} ${record.client || ''}`.toLowerCase(); return category === 'docta' ? address.includes('docta') : category === 'nobu' ? address.includes('nobu') : !address.includes('docta') && !address.includes('nobu') })
  const zones = [['docta', 'Docta Urbanización'], ['nobu', 'Nobu'], ['otros', 'Otros barrios']]
  const download = category => window.location.assign(`/api/history/export?month=${encodeURIComponent(month)}&category=${category}`)
  return <><div className="module-intro"><div><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Seguimiento mensual de instalaciones y exportación de reportes de alarmas.</p></div><label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div><div className="stats-grid"><article><span>Instalaciones del mes</span><b>{installations.length}</b><small>Todos los tipos de instalación</small></article><article><span>Instalaciones de alarma</span><b>{alarms.length}</b><small>Servicios registrados en el período</small></article><article><span>Trabajos totales</span><b>{records.length}</b><small>Instalaciones y servicios técnicos</small></article></div><div className="module-intro dashboard-subtitle"><div><p className="eyebrow">INSTALACIONES DE ALARMA</p><h2>Detalle por ubicación</h2></div></div><div className="zone-grid">{zones.map(([key, label]) => <article className="data-card" key={key}><p>{label}</p><b>{byZone(key).length}</b><span>instalaciones de alarma</span><button className="secondary" onClick={() => download(key)}><Icon name="upload" size={16} />Descargar Excel</button></article>)}</div><div className="data-card dashboard-list"><div className="table-head"><span>Últimos trabajos del período</span><span>Cliente</span><span>Servicio</span><span>Técnicos</span></div>{records.slice(0, 8).map(record => <div className="dashboard-row" key={record.id}><span>{prettyDate(record.date)}</span><b>{record.client}</b><span>{record.service}</span><span>{record.technicians?.join(' / ') || 'Sin asignar'}</span></div>)}{!records.length && <div className="empty-state">No hay trabajos registrados para el mes seleccionado.</div>}</div></>
}

function DashboardView({ history, services }) {
  return <><PasswordResetReminder /><DashboardStatusView history={history} services={services} /></>
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const year = month.slice(0, 4)
  const records = history.filter(record => record.date?.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date))
  const installations = records.filter(record => record.service?.toLowerCase().includes('instalación'))
  const alarms = installations.filter(record => record.service?.toLowerCase().includes('alarma'))
  const zoneOf = record => record.installationZone || (`${record.address || ''} ${record.client || ''}`.toLowerCase().includes('docta') ? 'docta' : `${record.address || ''} ${record.client || ''}`.toLowerCase().includes('nobu') ? 'nobu-town' : 'residencial')
  const zones = [['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residenciales']]
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((label, index) => ({ label, value: history.filter(record => record.date?.startsWith(`${year}-${String(index + 1).padStart(2, '0')}`) && record.service?.toLowerCase().includes('instalación de alarma')).length }))
  const max = Math.max(1, ...months.map(item => item.value))
  const download = category => window.location.assign(`/api/history/export?month=${encodeURIComponent(month)}&category=${category}`)
  return <><div className="module-intro"><div><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Seguimiento mensual de instalaciones y reportes de alarmas.</p></div><label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div><div className="stats-grid"><article><span>Instalaciones del mes</span><b>{installations.length}</b><small>Todos los tipos de instalación</small></article><article><span>Instalaciones de alarma</span><b>{alarms.length}</b><small>Servicios registrados en el período</small></article><article><span>Trabajos totales</span><b>{records.length}</b><small>Instalaciones y servicios técnicos</small></article></div><div className="dashboard-analytics"><article className="data-card annual-chart"><div><p className="eyebrow">EVOLUCIÓN ANUAL</p><h2>Instalaciones de alarma · {year}</h2></div><div className="bar-chart">{months.map(item => <div className="bar-item" key={item.label}><span>{item.value}</span><i style={{ height: `${Math.max(4, item.value / max * 100)}%` }}></i><small>{item.label}</small></div>)}</div></article><article className="data-card zone-summary"><p className="eyebrow">INSTALACIONES DE ALARMA</p><h2>Detalle por ubicación</h2>{zones.map(([key, label]) => <div key={key}><span>{label}</span><b>{alarms.filter(record => zoneOf(record) === key).length}</b><button className="secondary" onClick={() => download(key)}><Icon name="upload" size={15} />Excel</button></div>)}</article></div><div className="data-card dashboard-list"><div className="table-head"><span>Últimos trabajos del período</span><span>Cliente</span><span>Servicio</span><span>Técnicos</span></div>{records.slice(0, 8).map(record => <div className="dashboard-row" key={record.id}><span>{prettyDate(record.date)}</span><b>{record.client}</b><span>{record.service}</span><span>{record.technicians?.join(' / ') || 'Sin asignar'}</span></div>)}{!records.length && <div className="empty-state">No hay trabajos registrados para el mes seleccionado.</div>}</div></>
}

/** Vista restringida: un técnico sólo informa el resultado de sus servicios asignados. */
/** Registro de trazabilidad exclusivo para las acciones revisadas por Administración. */
function AuditShell({ user, onNavigate, logout, theme, setTheme, navigation }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  return <div className="app-shell" data-theme={theme}>
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark">◇</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div>
      <p className="nav-label">MÓDULOS</p>
      <nav>{navigation.map(([id, icon, label]) => <button key={id} className={id === 'audit' ? 'active' : ''} onClick={() => { onNavigate(id); setMenuOpen(false) }}><Icon name={icon} />{label}</button>)}</nav>
      <div className="sidebar-bottom">v1.1 · Agenda técnica</div>
    </aside>
    {menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
    <main>
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        <div className="page-heading"><span>PIGNUS</span><i></i><b>Auditoría</b></div>
        <div className="profile">
          <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button>
          <div className="profile-menu"><button className="profile-trigger" onClick={() => setProfileOpen(open => !open)} aria-expanded={profileOpen}><span className="profile-avatar">{initials(user.name)}</span><span>{user.name}</span></button>{profileOpen && <div className="profile-popover"><b>{user.name}</b><span>{user.email}</span><small>{user.role}</small></div>}</div>
          <button className="logout-button" onClick={() => setConfirmLogout(true)} title="Cerrar sesión"><Icon name="logout" size={17} /><span>Cerrar sesión</span></button>
        </div>
      </header>
      <section className="content"><AuditPage user={user} onBack={() => onNavigate('dashboard')} onOpenMenu={() => setMenuOpen(true)} logout={logout} /></section>
    </main>
    {confirmLogout && <Confirm title="Cerrar sesión" detail="¿Querés cerrar sesión? Tendrás que volver a ingresar con tus credenciales para acceder al sistema." action={logout} confirmLabel="Sí, cerrar sesión" close={() => setConfirmLogout(false)} />}
  </div>
}

function LegacyAuditShell({ user, onNavigate, logout }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigation = [['dashboard', 'dashboard', 'Menú principal'], ['agenda', 'agenda', 'Agenda técnica'], ['history', 'history', 'Historial'], ['accounts', 'accounts', 'Abonados y clientes'], ['employees', 'users', 'Empleados'], ['services', 'tools', 'Tipo de servicio'], ['settings', 'settings', 'Configuración'], ['audit', 'audit', 'Auditoría'], ['help', 'help', 'Centro de ayuda']]
  return <div className="audit-shell"><aside className={`sidebar audit-sidebar ${menuOpen ? 'open' : ''}`}><button className="audit-sidebar-brand" onClick={() => onNavigate('dashboard')} title="Ir al menú principal"><img src="/logo-pignus.png" alt="Pignus" /></button><p className="nav-label">MÓDULOS</p><nav>{navigation.map(([id, icon, label]) => <button key={id} className={id === 'audit' ? 'active' : ''} onClick={() => { onNavigate(id); setMenuOpen(false) }}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}<AuditPage user={user} onBack={() => onNavigate('dashboard')} onOpenMenu={() => setMenuOpen(true)} logout={logout} /></div>
}

function AuditPage({ user, onBack, onOpenMenu, logout }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [selected, setSelected] = useState(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const loadAudit = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/audit?limit=100', { cache: 'no-store', credentials: 'same-origin' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar el registro de auditoría.')
      setRecords(Array.isArray(data.records) ? data.records : [])
      setError('')
    } catch (loadError) {
      setRecords([])
      setError(loadError?.message || 'No se pudo cargar el registro de auditoría.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void loadAudit() }, [])
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const escapeAuditHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Resalta las propiedades cuyo valor no coincide entre la versión anterior y la nueva.
  const auditJsonMarkup = (value, comparison, tone) => {
    if (!value) return 'No aplica.'
    const changedKeys = value && comparison && typeof value === 'object' && typeof comparison === 'object'
      ? new Set([...Object.keys(value), ...Object.keys(comparison)].filter(key => JSON.stringify(value[key]) !== JSON.stringify(comparison[key])))
      : new Set()
    return JSON.stringify(value, null, 2).split('\n').map(line => {
      const match = line.match(/^\s*"([^\"]+)":/)
      const changed = match && changedKeys.has(match[1])
      return changed ? `<span class="audit-change audit-change-${tone}">${escapeAuditHtml(line)}</span>` : escapeAuditHtml(line)
    }).join('\n')
  }
  useEffect(() => {
    if (!selected) return undefined
    const panes = document.querySelectorAll('.audit-diff pre')
    if (panes.length !== 2) return undefined
    panes[0].innerHTML = auditJsonMarkup(selected.before, selected.after, 'before')
    panes[1].innerHTML = auditJsonMarkup(selected.after, selected.before, 'after')
    return undefined
  }, [selected])
  const openDetail = async record => {
    try {
      const response = await fetch(`/api/audit/${encodeURIComponent(record.id)}`, { cache: 'no-store', credentials: 'same-origin' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.record) throw new Error(data.error || 'No se pudo cargar el detalle de auditoría.')
      setSelected(data.record)
      setError('')
    } catch (detailError) {
      setError(detailError?.message || 'No se pudo cargar el detalle de auditoría.')
    }
  }
  const visible = useMemo(() => records.filter(record => (!action || record.action === action) && normalized([record.user?.name, record.user?.email, record.entity, record.entityId, record.action].join(' ')).includes(normalized(query))), [records, action, query])
  const actionClass = value => normalized(value).includes('elimino') ? 'audit-delete' : normalized(value).includes('creo') ? 'audit-create' : normalized(value).includes('modifico') ? 'audit-edit' : 'audit-status'
  return <main className="audit-page"><header className="audit-topbar"><button className="mobile-menu audit-mobile-menu" onClick={onOpenMenu}><Icon name="menu" /></button><button className="audit-brand" onClick={onBack} title="Volver al menú principal"><img src="/logo-pignus.png" alt="Pignus" /></button><div><b>Auditoría</b><span>Registro de actividad del sistema</span></div><div className="audit-user"><span>{user.name}</span><small>{user.email}</small></div><button className="secondary small" onClick={onBack}>Volver al menú</button><button className="logout-button" onClick={() => setConfirmLogout(true)}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="audit-content"><div className="module-intro"><div><p className="eyebrow">CONTROL Y TRAZABILIDAD</p><h1>Auditoría del sistema</h1><p>Consultá quién creó, modificó, eliminó o informó cambios, con fecha y detalle de cada acción.</p></div><button className="secondary" onClick={loadAudit}><Icon name="history" />Actualizar</button></div><div className="audit-filters"><label>Acción<select value={action} onChange={event => setAction(event.target.value)}><option value="">Todas las acciones</option>{[...new Set(records.map(record => record.action))].map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="audit-search">Buscar usuario, entidad o registro<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Ej.: Leonardo, cliente o PIG-6375" /></label><span><b>{visible.length}</b> acciones registradas</span></div>{error && <div className="notice audit-error">{error}</div>}<div className="audit-table"><div className="audit-table-head"><span>Fecha y hora</span><span>Usuario</span><span>Acción</span><span>Información afectada</span><span>Detalle</span></div>{loading ? <div className="empty-state">Cargando registro de auditoría…</div> : visible.map(record => <div className="audit-row" key={record.id}><span>{prettyReportDateTime(record.at)}</span><span><b>{record.user?.name || 'Usuario desconocido'}</b><small>{record.user?.email}</small></span><span><i className={actionClass(record.action)}>{record.action}</i></span><span><b>{record.entity}</b><small>{record.entityId}</small></span><button className="secondary small" onClick={() => openDetail(record)}><Icon name="eye" size={16} />Ver detalle</button></div>)}{!loading && !visible.length && <div className="empty-state">No hay acciones que coincidan con los filtros seleccionados.</div>}</div></section>{selected && <div className="modal-layer"><div className="modal audit-modal"><button className="modal-close" onClick={() => setSelected(null)}><Icon name="close" /></button><p className="eyebrow">DETALLE DE AUDITORÍA</p><h2>{selected.action} · {selected.entity}</h2><div className="audit-detail-meta"><span><b>Usuario</b>{selected.user?.name} · {selected.user?.email}</span><span><b>Fecha y hora</b>{prettyReportDateTime(selected.at)}</span><span><b>Registro</b>{selected.entityId}</span></div><div className="audit-diff"><section><h3>Antes</h3><pre>{selected.before ? JSON.stringify(selected.before, null, 2) : 'No aplica: es un registro nuevo.'}</pre></section><section><h3>Después</h3><pre>{selected.after ? JSON.stringify(selected.after, null, 2) : 'No aplica: el registro fue eliminado.'}</pre></section></div></div></div>}{confirmLogout && <Confirm title="Cerrar sesión" detail="¿Querés cerrar sesión? Tendrás que volver a ingresar con tus credenciales para acceder al sistema." action={logout} confirmLabel="Sí, cerrar sesión" close={() => setConfirmLogout(false)} />}</main>
}

function TechnicianPortal({ user, history, setHistory, logout }) {
  const [draft, setDraft] = useState(null)
  const [observation, setObservation] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [view, setView] = useState('agenda')
  const [menuOpen, setMenuOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [customerHistoryRecord, setCustomerHistoryRecord] = useState(null)
  const today = new Date().toISOString().slice(0, 10)
  const resolved = record => Boolean(record.technicalStatus || record.status === 'Completado' || record.status === 'Cancelado' || record.status === 'Reprogramado')
  const assignedServices = history.filter(record => record.technicianIds?.some(id => String(id) === String(user.id))).sort((a, b) => `${a.date}-${a.time || ''}`.localeCompare(`${b.date}-${b.time || ''}`))
  const completedServices = assignedServices.filter(resolved).reverse()
  const services = view === 'agenda'
    ? assignedServices.filter(record => record.date >= today && !resolved(record))
    : filterTechnicianHistory(completedServices, historySearch)
  useEffect(() => {
    // Todos los integrantes de un equipo consultan el mismo registro compartido.
    // Así, al informar un estado un compañero, se retira o actualiza para los demás.
    let refreshing = false
    let stopped = false
    const refreshSharedAgenda = async () => {
      if (stopped || refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try {
        const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' })
        const data = response.ok ? await response.json() : null
        if (!stopped && Array.isArray(data?.history)) setHistory(data.history)
      } catch {
        // La agenda visible no se descarta ante un fallo temporal de conectividad.
      } finally {
        refreshing = false
      }
    }
    const interval = window.setInterval(refreshSharedAgenda, 30000)
    window.addEventListener('focus', refreshSharedAgenda)
    return () => { stopped = true; window.clearInterval(interval); window.removeEventListener('focus', refreshSharedAgenda) }
  }, [setHistory])
  useEffect(() => {
    const header = document.querySelector('.technician-header')
    if (!header) return undefined
    const desktopNavigation = document.createElement('aside')
    desktopNavigation.className = `sidebar technician-sidebar ${menuOpen ? 'open' : ''}`
    desktopNavigation.innerHTML = '<div class="brand" aria-label="Pignus"></div><p class="nav-label">MÓDULOS</p><nav aria-label="Módulos técnicos"><button data-view="agenda">▣ <span>Agenda técnica</span></button><button data-view="history">◷ <span>Historial</span></button></nav><div class="sidebar-bottom">v1.1 · Agenda técnica</div>'
    desktopNavigation.querySelectorAll('button').forEach(button => {
      button.classList.toggle('active', button.dataset.view === view)
      button.onclick = () => { setView(button.dataset.view); setMenuOpen(false) }
    })
    const mobileToggle = document.createElement('button')
    mobileToggle.type = 'button'; mobileToggle.className = 'mobile-menu technician-mobile-menu'; mobileToggle.setAttribute('aria-label', 'Abrir menú'); mobileToggle.textContent = '☰'; mobileToggle.onclick = () => setMenuOpen(true)
    header.prepend(mobileToggle)
    document.body.append(desktopNavigation)
    const backdrop = menuOpen ? document.createElement('button') : null
    if (backdrop) { backdrop.type = 'button'; backdrop.className = 'backdrop technician-menu-backdrop'; backdrop.setAttribute('aria-label', 'Cerrar menú'); backdrop.onclick = () => setMenuOpen(false); document.body.append(backdrop) }
    return () => { mobileToggle.remove(); desktopNavigation.remove(); backdrop?.remove() }
  }, [view, menuOpen])
  useEffect(() => {
    const title = document.querySelector('.technician-content h1')
    const help = document.querySelector('.technician-help')
    if (title) title.textContent = view === 'agenda' ? 'Servicios pendientes' : 'Historial de servicios'
    if (help) help.textContent = view === 'agenda' ? 'Completá cada servicio en el orden indicado. La dirección y el contacto del siguiente se habilitan al informar el estado del actual.' : 'Consultá los servicios que ya informaste y el estado registrado en cada uno.'
  }, [view])
  useEffect(() => {
    const cards = document.querySelectorAll('.technician-service')
    cards.forEach((card, index) => {
      const badge = card.querySelector('.work-status')
      if (!badge) return
      badge.classList.remove('tech-status-completado', 'tech-status-cancelado', 'tech-status-reprogramacion')
      const label = badge.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      if (label.includes('cancel')) badge.classList.add('tech-status-cancelado')
      else if (label.includes('reprogram')) badge.classList.add('tech-status-reprogramacion')
      else if (label.includes('complet')) badge.classList.add('tech-status-completado')
      card.querySelector(':scope > .technician-team')?.remove()
      if (view === 'history') {
        const team = document.createElement('p')
        team.className = 'technician-team'
        const title = document.createElement('b'); title.textContent = 'Equipo de trabajo: '
        team.append(title, document.createTextNode(technicianTeamLabel(services[index])))
        card.querySelector(':scope > .tech-client')?.after(team)
      }
    })
    return () => cards.forEach(card => card.querySelector(':scope > .technician-team')?.remove())
  }, [services, view])
  const saveStatus = async () => {
    const { record, type } = confirm
    const updated = await submitTechnicianStatus({ recordId: record.id, type, observation })
    setHistory(previous => previous.map(item => item.id === record.id ? updated : item))
    setDraft(null); setObservation('')
  }
  const requestStatus = (record, type) => {
    if ((type === 'Cancelado' || type === 'Reprogramación solicitada') && !observation.trim()) return
    setConfirm({ record, type })
  }
  return <main className="technician-page"><header className="technician-header"><img src="/logo-pignus.png" alt="Pignus" /><div><b>{user.name}</b><span>{user.email}</span></div><button className="logout-button" onClick={() => setConfirm({ logout: true })}><Icon name="logout" size={17} />Cerrar sesión</button></header><section className="technician-content"><p className="eyebrow">MI AGENDA</p><h1>Servicios asignados</h1><p className="technician-help">Completá cada servicio en el orden indicado. La dirección y el contacto del siguiente se habilitan al informar el estado del actual.</p>{view === 'history' && <div className="technician-history-search"><label htmlFor="technician-history-query">Buscar en mi historial</label><div><Icon name="search" size={18} /><input id="technician-history-query" type="search" value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder="Cliente, código, servicio, fecha o detalle..." autoComplete="off" /></div><small>{services.length} de {completedServices.length} servicio(s)</small></div>}{services.length ? services.map((record, index) => { const unlocked = view === 'history' || index === 0 || resolved(services[index - 1]); const done = resolved(record); return <article className={`technician-service ${unlocked ? '' : 'locked'}`} key={record.id}><div className="technician-service-head"><span>{index + 1}</span><div><b>{record.time ? `${record.time} Hs` : 'Horario a confirmar'}</b><small>{prettyDate(record.date)}</small></div><em className={`work-status ${done ? 'completado' : 'pendiente'}`}>{record.technicalStatus || record.status || 'Pendiente'}</em></div><h2>{record.service}</h2><p className="tech-client">{record.client}</p><p><b>Detalle:</b> {record.detail || 'Sin observaciones'}</p>{unlocked ? <><p><b>Dirección:</b> {record.address || 'Sin dirección'}</p><p><b>Contacto:</b> {record.phone || 'Sin contacto'}</p><button className="secondary technician-customer-history" onClick={() => setCustomerHistoryRecord(record)}><Icon name="history" size={17} />Ver historial del cliente</button></> : <p className="locked-info">La dirección y el contacto se habilitarán al informar el estado del servicio anterior.</p>}{unlocked && !done && <div className="technician-actions"><button className="primary" onClick={() => { setDraft({ record, type: 'Completado' }); setObservation('') }}><Icon name="check" />Marcar completado</button><button className="secondary" onClick={() => { setDraft({ record, type: 'Reprogramación solicitada' }); setObservation('') }}>Solicitar reprogramación</button><button className="secondary" onClick={() => { setDraft({ record, type: 'Cancelado' }); setObservation('') }}>Informar cancelación</button></div>}{done && record.technicalReportedAt && <small className="reported-at">Informado: {prettyReportDateTime(record.technicalReportedAt)}</small>}</article> }) : <div className="empty-state">{view === 'history' && historySearch.trim() ? 'No hay servicios que coincidan con la búsqueda.' : view === 'history' ? 'Todavía no informaste servicios.' : 'No tenés servicios asignados pendientes para hoy o fechas futuras.'}</div>}</section>{draft && <div className="modal-layer"><div className="modal technician-status-modal"><button className="close-modal" onClick={() => setDraft(null)}><Icon name="close" /></button><p className="eyebrow">ACTUALIZAR SERVICIO</p><h2>{draft.type}</h2><p>{draft.record.client} · {draft.record.service}</p><label><RequiredLabel>Observación</RequiredLabel><textarea required value={observation} onChange={event => setObservation(event.target.value)} placeholder="Detallá el trabajo realizado, el resultado y cualquier recomendación para futuras visitas." /></label><div className="modal-actions"><button className="secondary" onClick={() => setDraft(null)}>Cancelar</button><button className="primary" disabled={!observation.trim()} onClick={() => setConfirm({ record: draft.record, type: draft.type })}>Continuar</button></div></div></div>}{customerHistoryRecord && <CustomerServiceHistory customer={customerHistoryRecord} history={history} close={() => setCustomerHistoryRecord(null)} technicianView />}{confirm?.record && <Confirm title="Confirmar estado" detail={`¿Confirmás que querés informar “${confirm.type}”? Luego quedará registrado y cualquier cambio deberá ser revisado por Administración.`} action={saveStatus} confirmLabel="Sí, confirmar estado" close={() => setConfirm(null)} />}{confirm?.logout && <Confirm title="Cerrar sesión" detail="¿Querés cerrar sesión?" action={logout} confirmLabel="Sí, cerrar sesión" close={() => setConfirm(null)} />}</main>
}

function DashboardStatusView({ history, services }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [alarmModalOpen, setAlarmModalOpen] = useState(false)
  const [retirementModalOpen, setRetirementModalOpen] = useState(false)
  const [projectionModalOpen, setProjectionModalOpen] = useState(false)
  const [workModalOpen, setWorkModalOpen] = useState(false)
  const year = month.slice(0, 4)
  const isComplete = record => record.status === 'Completado'
  const records = history.filter(record => record.date?.startsWith(month) && isComplete(record)).sort((a, b) => b.date.localeCompare(a.date))
  const pending = history.filter(record => !record.status || record.status === 'Pendiente' || record.status === 'Reprogramado' || record.status === 'Requiere revisión')
  const openPending = () => window.dispatchEvent(new Event('pignus:open-history'))
  const serviceForRecord = record => services.find(service => String(service.id) === String(record.serviceId)) || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(record.service))
  const isAlarmRecord = record => {
    const configuredService = serviceForRecord(record)
    if (configuredService) return serviceCode(configuredService) === 'alarm-installation'
    const legacyName = normalizeServiceName(record.service)
    return legacyName.includes('instalacion') && legacyName.includes('alarma')
  }
  const installations = records.filter(record => serviceForRecord(record)?.category === 'installation' || (!record.serviceId && normalizeServiceName(record.service).includes('instalacion')))
  const alarms = installations.filter(isAlarmRecord)
  const isRetirementRecord = record => normalizeServiceName(serviceForRecord(record)?.name || record.service).includes('retiro')
  const retirements = records.filter(isRetirementRecord)
  const netGrowth = alarms.length - retirements.length
  const zoneOf = record => record.installationZone || (`${record.address || ''} ${record.client || ''}`.toLowerCase().includes('docta') ? 'docta' : `${record.address || ''} ${record.client || ''}`.toLowerCase().includes('nobu') ? 'nobu-town' : 'residencial')
  const zones = [['docta', 'Docta Urbanización'], ['nobu-town', 'Nobu Town'], ['residencial', 'Residenciales']]
  const todayKey = currentLocalDate()
  const currentYear = todayKey.slice(0, 4)
  const annualLocationTotals = Object.fromEntries(zones.map(([key]) => [key, countYearToDateAlarmInstallations(history, { throughDate: todayKey, zone: key, isAlarmRecord, zoneOf })]))
  const annualRetirements = countYearToDateCompletedRecords(history, { throughDate: todayKey, matches: isRetirementRecord })
  const months = visibleAnnualMonthLabels(year).map((label, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`
    const monthlyAlarms = history.filter(record => record.date?.startsWith(monthKey) && isComplete(record) && isAlarmRecord(record))
    return {
      label,
      value: monthlyAlarms.length,
      locations: Object.fromEntries(zones.map(([key]) => [key, monthlyAlarms.filter(record => zoneOf(record) === key).length])),
      retirements: history.filter(record => record.date?.startsWith(monthKey) && isComplete(record) && isRetirementRecord(record)).length
    }
  })
  const max = Math.max(1, ...months.flatMap(item => [item.value, item.retirements]))
  const chartHeightPercent = value => value ? Math.max(4, value / max * 78) : 0
  useEffect(() => {
    const chart = document.querySelector('.annual-chart .bar-chart')
    if (!chart) return undefined
    chart.parentElement.querySelector('.chart-legend')?.remove()
    const legend = document.createElement('div')
    legend.className = 'chart-legend'
    legend.innerHTML = '<span><i class="legend-docta"></i>Docta</span><span><i class="legend-nobu"></i>Nobu Town</span><span><i class="legend-residential"></i>Residenciales</span><span><i class="legend-lows"></i>Bajas</span>'
    chart.before(legend)
    chart.querySelectorAll('.bar-item').forEach((item, index) => {
      item.querySelector('.bar-retirements')?.remove()
      item.querySelector('.retirement-value')?.remove()
      item.querySelector('.bar-installation-stack')?.remove()
      item.querySelector(':scope > i')?.classList.add('bar-installations')
      const monthData = months[index]
      const stack = document.createElement('div')
      stack.className = 'bar-installation-stack'
      stack.style.height = `${chartHeightPercent(monthData?.value)}%`
      ;[
        ['docta', 'Docta Urbanización'],
        ['nobu-town', 'Nobu Town'],
        ['residencial', 'Residenciales']
      ].forEach(([key, label]) => {
        const count = monthData?.locations?.[key] || 0
        if (!count || !monthData.value) return
        const segment = document.createElement('i')
        segment.className = `bar-zone-segment bar-zone-${key}`
        segment.style.height = `${count / monthData.value * 100}%`
        segment.title = `${label}: ${count}`
        segment.setAttribute('aria-label', `${label}: ${count}`)
        stack.append(segment)
      })
      item.insertBefore(stack, item.querySelector('small'))
      const retirements = months[index]?.retirements || 0
      if (!retirements) return
      const bar = document.createElement('i')
      bar.className = 'bar-retirements'
      bar.style.height = `${chartHeightPercent(retirements)}%`
      bar.title = `${retirements} baja${retirements === 1 ? '' : 's'}`
      item.append(bar)
      const value = document.createElement('span')
      value.className = 'retirement-value'
      value.textContent = retirements
      value.style.bottom = `calc(${chartHeightPercent(retirements)}% + 22px)`
      item.append(value)
    })
    return () => { legend.remove(); chart.querySelectorAll('.bar-retirements, .retirement-value, .bar-installation-stack').forEach(element => element.remove()) }
  }, [months.map(item => `${item.value}:${item.retirements}:${item.locations.docta}:${item.locations['nobu-town']}:${item.locations.residencial}`).join('|'), max])
  const download = (category, format = 'excel') => {
    const href = `/api/history/export?month=${encodeURIComponent(month)}&category=${encodeURIComponent(category)}&format=${encodeURIComponent(format)}`
    triggerBrowserDownload(href, reportDownloadName(month, category, format))
  }
  const serviceBreakdown = Object.entries(records.reduce((summary, record) => { const name = record.service?.trim() || 'Sin especificar'; summary[name] = (summary[name] || 0) + 1; return summary }, {})).sort(([, left], [, right]) => right - left)
  const [selectedYear, selectedMonth] = month.split('-').map(Number)
  const today = new Date()
  const isCurrentPeriod = today.getFullYear() === selectedYear && today.getMonth() + 1 === selectedMonth
  const businessDaysInPeriod = countBusinessDays(selectedYear, selectedMonth)
  const elapsedBusinessDays = isCurrentPeriod ? countBusinessDays(selectedYear, selectedMonth, today.getDate()) : businessDaysInPeriod
  const projectedInstallations = elapsedBusinessDays ? Math.round(netGrowth / elapsedBusinessDays * businessDaysInPeriod) : 0
  const previousDate = new Date(selectedYear, selectedMonth - 2, 1)
  const previousMonthKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`
  const previousInstallations = history.filter(record => record.date?.startsWith(previousMonthKey) && isComplete(record) && isAlarmRecord(record)).length
  const previousRetirements = history.filter(record => record.date?.startsWith(previousMonthKey) && isComplete(record) && isRetirementRecord(record)).length
  const previousNetGrowth = previousInstallations - previousRetirements
  const comparisonValue = isCurrentPeriod ? projectedInstallations : netGrowth
  const variation = previousNetGrowth ? Math.round((comparisonValue - previousNetGrowth) / Math.abs(previousNetGrowth) * 100) : null
  const previousMonthLabel = previousDate.toLocaleDateString('es-AR', { month: 'long' })
  const yearToDateInstallations = history.filter(record => record.date?.startsWith(`${selectedYear}-`) && Number(record.date.slice(5, 7)) <= selectedMonth && isComplete(record) && isAlarmRecord(record)).length
  const yearToDateRetirements = history.filter(record => record.date?.startsWith(`${selectedYear}-`) && Number(record.date.slice(5, 7)) <= selectedMonth && isComplete(record) && isRetirementRecord(record)).length
  const averageInstallations = (yearToDateInstallations - yearToDateRetirements) / selectedMonth
  const averageValue = Math.round(averageInstallations)
  const averageVariation = averageInstallations ? Math.round((comparisonValue - averageInstallations) / averageInstallations * 100) : null
  useEffect(() => {
    const stats = document.querySelector('.stats-grid')
    if (!stats) return
    const cards = [...stats.querySelectorAll(':scope > article')]
    const projectionCard = cards.find(card => {
      const title = card.querySelector('span')?.textContent || ''
      return title.includes('Instalaciones') || title.includes('Proyección') || title.includes('Crecimiento neto')
    })
    const alarmsCard = cards.find(card => card.querySelector('span')?.textContent.includes('Altas'))
    if (!projectionCard || !alarmsCard) return
    stats.prepend(alarmsCard)
    projectionCard.querySelector('span').textContent = isCurrentPeriod ? 'Crecimiento neto del mes' : 'Crecimiento neto del período'
    projectionCard.querySelector('b').textContent = `${netGrowth > 0 ? '+' : ''}${netGrowth}`
    const comparison = variation === null ? `Sin crecimiento neto comparable en ${previousMonthLabel}` : `<strong class="projection-variation ${variation >= 0 ? 'positive' : 'negative'}">${variation > 0 ? '+' : ''}${variation}%</strong> vs. ${previousMonthLabel}`
    const averageComparison = averageVariation === null ? 'Sin promedio neto anual disponible' : `<strong class="projection-variation ${averageVariation >= 0 ? 'positive' : 'negative'}">${averageVariation > 0 ? '+' : ''}${averageVariation}%</strong> vs. promedio neto mensual ${selectedYear} (${averageValue})`
    projectionCard.querySelector('small').innerHTML = isCurrentPeriod
      ? `<span>${variation === null ? `Sin comparación disponible vs. ${previousMonthLabel}` : `<strong class="projection-variation ${variation >= 0 ? 'positive' : 'negative'}">${variation > 0 ? '+' : ''}${variation}%</strong> vs. ${previousMonthLabel}`}</span><br><span>${averageVariation === null ? 'Sin promedio anual disponible' : `<strong class="projection-variation ${averageVariation >= 0 ? 'positive' : 'negative'}">${averageVariation > 0 ? '+' : ''}${averageVariation}%</strong> vs. promedio neto mensual ${selectedYear} (${averageValue})`}</span>`
      : 'Resultado final del período'
  }, [month, netGrowth, isCurrentPeriod, variation, averageVariation, previousMonthLabel, selectedYear, averageValue])
  useEffect(() => {
    // Las tarjetas se vuelven accesibles por mouse y teclado una vez ordenadas por el resumen.
    const stats = document.querySelector('.stats-grid')
    if (!stats) return undefined
    const cards = [...stats.querySelectorAll(':scope > article')]
    const projectionCard = cards.find(card => {
      const title = card.querySelector('span')?.textContent || ''
      return title.includes('Proyección') || title.includes('Crecimiento neto')
    })
    const workCard = cards.find(card => card.querySelector('span')?.textContent.includes('Trabajos'))
    const bind = (card, open, label) => {
      if (!card) return () => {}
      card.classList.add('clickable-stat')
      card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', label)
      const keyboard = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }
      card.addEventListener('click', open); card.addEventListener('keydown', keyboard)
      return () => { card.removeEventListener('click', open); card.removeEventListener('keydown', keyboard) }
    }
    const unbindProjection = bind(projectionCard, () => setProjectionModalOpen(true), 'Ver detalle de proyección de alarmas')
    const unbindWorks = bind(workCard, () => setWorkModalOpen(true), 'Ver composición de trabajos completados')
    return () => { unbindProjection(); unbindWorks() }
  }, [month, projectedInstallations, records.length])
  useEffect(() => {
    if (!projectionModalOpen) return undefined
    const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const dailyAverage = elapsedBusinessDays ? (netGrowth / elapsedBusinessDays).toFixed(1).replace('.', ',') : '0'
    const progress = projectedInstallations > 0 ? Math.min(100, Math.round(Math.max(0, netGrowth) / projectedInstallations * 100)) : 0
    const layer = document.createElement('div'); layer.className = 'modal-layer dashboard-insight-layer'
    const modal = document.createElement('div'); modal.className = 'modal dashboard-insight-modal projection-insight-modal'
    modal.innerHTML = `<button class="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">PROYECCIÓN NETA DE ABONADOS</p><h2>${isCurrentPeriod ? 'Crecimiento estimado al cierre' : 'Resultado neto del período'}</h2><p class="insight-period">${monthName}</p><div class="projection-highlight"><b>${projectedInstallations}</b><span>${isCurrentPeriod ? 'crecimiento neto proyectado' : 'crecimiento neto confirmado'}</span></div><div class="projection-progress"><span style="width:${progress}%"></span></div><p class="projection-progress-label">Crecimiento actual: ${alarms.length} altas menos ${retirements.length} bajas = ${netGrowth}<br><small>Proyección calculada sobre ${elapsedBusinessDays} de ${businessDaysInPeriod} días hábiles (lunes a viernes).</small></p><div class="insight-metrics"><article><b>${alarms.length}</b><span>Nuevas alarmas</span></article><article><b>${retirements.length}</b><span>Bajas de servicio</span></article><article><b>${dailyAverage}</b><span>Promedio neto por día hábil</span></article><article><b class="${variation === null || variation >= 0 ? 'positive' : 'negative'}">${variation === null ? '—' : `${variation > 0 ? '+' : ''}${variation}%`}</b><span>Vs. crecimiento neto de ${previousMonthLabel}</span></article></div><div class="modal-actions"><button class="primary">Cerrar</button></div>`
    const close = () => setProjectionModalOpen(false)
    modal.querySelectorAll('button').forEach(button => { button.onclick = close })
    layer.onclick = event => { if (event.target === layer) close() }
    layer.append(modal); document.body.append(layer)
    return () => layer.remove()
  }, [projectionModalOpen, month, alarms.length, retirements.length, netGrowth, projectedInstallations, elapsedBusinessDays, businessDaysInPeriod, variation, previousMonthLabel, isCurrentPeriod])
  useEffect(() => {
    if (!workModalOpen) return undefined
    const palette = ['#2f69ad', '#218857', '#c4870a', '#8a57b6', '#c4534b', '#257c82', '#a76424', '#68786d']
    const total = Math.max(1, records.length)
    let offset = 0
    const slices = serviceBreakdown.map(([name, count], index) => {
      const start = offset; offset += count / total * 100
      return `${palette[index % palette.length]} ${start}% ${offset}%`
    }).join(', ')
    const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const layer = document.createElement('div'); layer.className = 'modal-layer dashboard-insight-layer'
    const modal = document.createElement('div'); modal.className = 'modal dashboard-insight-modal work-insight-modal'
    modal.innerHTML = `<button class="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">TRABAJOS COMPLETADOS</p><h2>Composición del período</h2><p class="insight-period">${records.length} trabajo(s) completado(s) en ${monthName}</p><div class="work-composition"><div class="donut-chart"><span>${records.length}<small>total</small></span></div><div class="donut-legend"></div></div><div class="modal-actions"><button class="primary">Cerrar</button></div>`
    modal.querySelector('.donut-chart').style.background = `conic-gradient(${slices || '#dfe7df 0 100%'})`
    const legend = modal.querySelector('.donut-legend')
    serviceBreakdown.forEach(([name, count], index) => {
      const row = document.createElement('div')
      const marker = document.createElement('i'); marker.style.background = palette[index % palette.length]
      const label = document.createElement('span'); label.textContent = name
      const value = document.createElement('b'); value.textContent = `${count} `
      const percentLabel = document.createElement('small'); percentLabel.textContent = `${Math.round(count / total * 100)}%`
      value.append(percentLabel); row.append(marker, label, value); legend.append(row)
    })
    if (!serviceBreakdown.length) legend.textContent = 'No hay trabajos completados para este período.'
    const close = () => setWorkModalOpen(false)
    modal.querySelectorAll('button').forEach(button => { button.onclick = close })
    layer.onclick = event => { if (event.target === layer) close() }
    layer.append(modal); document.body.append(layer)
    return () => layer.remove()
  }, [workModalOpen, month, records.length, serviceBreakdown])
  return <><div className="module-intro"><div><p className="eyebrow">RESUMEN GERENCIAL</p><h1>Indicadores operativos</h1><p>Las métricas contabilizan únicamente servicios completados.</p></div><label className="month-filter">Mes de análisis<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div>{pending.length > 0 && <button className="pending-reminder" type="button" onClick={openPending}><Icon name="calendar" /><div><b>{pending.length} servicio(s) pendiente(s) de definición</b><span>Revisalos en Historial para completarlos, cancelarlos o reprogramarlos.</span></div></button>}<div className="stats-grid dashboard-stats-four"><article className="clickable-stat" role="button" tabIndex={0} onClick={() => setAlarmModalOpen(true)} onKeyDown={event => event.key === 'Enter' && setAlarmModalOpen(true)}><span>Altas de servicio</span><b>{alarms.length}</b><small>Instalaciones de alarmas completadas</small></article><article className="clickable-stat retirement-stat" role="button" tabIndex={0} onClick={() => setRetirementModalOpen(true)} onKeyDown={event => event.key === 'Enter' && setRetirementModalOpen(true)}><span>Bajas de servicio</span><b>{retirements.length}</b><small>Retiros de alarmas completados</small></article><article><span>Proyección neta de abonados</span><b>{projectedInstallations}</b><small>{isCurrentPeriod ? 'Estimación al cierre' : 'Resultado final'} · altas ({alarms.length}) menos bajas ({retirements.length})</small></article><article><span>Trabajos completados</span><b>{records.length}</b><small>Instalaciones y servicios técnicos</small></article></div><section className="annual-kpi-section" aria-labelledby="annual-kpi-title"><div className="annual-kpi-heading"><p className="eyebrow">ACUMULADO ANUAL</p><h2 id="annual-kpi-title">Desde el 1 de enero hasta hoy · {currentYear}</h2></div><div className="stats-grid annual-stats-grid"><article className="docta-ytd-stat"><span>Instalaciones en Docta</span><b>{annualLocationTotals.docta}</b><small>Alarmas completadas</small></article><article className="nobu-ytd-stat"><span>Instalaciones en Nobu Town</span><b>{annualLocationTotals['nobu-town']}</b><small>Alarmas completadas</small></article><article className="residential-ytd-stat"><span>Instalaciones residenciales</span><b>{annualLocationTotals.residencial}</b><small>Alarmas completadas fuera de Docta y Nobu</small></article><article className="retirements-ytd-stat"><span>Bajas de servicio</span><b>{annualRetirements}</b><small>Retiros de alarma completados</small></article></div></section><div className="dashboard-analytics"><article className="data-card annual-chart"><div><p className="eyebrow">EVOLUCIÓN ANUAL</p><h2>Instalaciones de alarma · {year}</h2></div><div className="bar-chart">{months.map(item => <div className="bar-item" key={item.label}><span>{item.value}</span><i style={{ height: `${Math.max(4, item.value / max * 100)}%` }}></i><small>{item.label}</small></div>)}</div></article><div className="dashboard-summary-column"><article className="data-card zone-summary"><p className="eyebrow">ALTAS DE SERVICIO</p><h2>Detalle por ubicación</h2><div><span>Todas las instalaciones</span><b>{alarms.length}</b><button className="secondary all-alarms-export" onClick={() => download('all')}><Icon name="upload" size={15} />Excel</button><button className="secondary" onClick={() => download('all', 'pdf')}><Icon name="upload" size={15} />PDF</button></div>{zones.map(([key, label]) => <div key={key}><span>{label}</span><b>{alarms.filter(record => zoneOf(record) === key).length}</b><button className="secondary" onClick={() => download(key)}><Icon name="upload" size={15} />Excel</button><button className="secondary" onClick={() => download(key, 'pdf')}><Icon name="upload" size={15} />PDF</button></div>)}</article><article className="data-card zone-summary retirement-summary"><p className="eyebrow">BAJAS DE SERVICIO</p><h2>Retiros de alarma</h2><div><span>Todos los retiros</span><b>{retirements.length}</b><button className="secondary" onClick={() => download('retirements')}><Icon name="upload" size={15} />Excel</button><button className="secondary" onClick={() => download('retirements', 'pdf')}><Icon name="upload" size={15} />PDF</button></div></article></div></div>{alarmModalOpen && <AlarmDetailsModal records={alarms} month={month} close={() => setAlarmModalOpen(false)} download={download} />}{retirementModalOpen && <RetirementDetailsModal records={retirements} month={month} close={() => setRetirementModalOpen(false)} download={download} />}</>
}

/** Detalle consultable de las instalaciones de alarma antes de exportar el reporte mensual. */
function AlarmDetailsModal({ records, month, close, download }) {
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalle de altas de servicio"><div className="modal alarm-details-modal"><button className="close-modal" onClick={close} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">ALTAS DE SERVICIO</p><h2>{records.length} instalación{records.length === 1 ? '' : 'es'} de alarma en {monthName}</h2><p>Revisá la información del período o descargá el listado completo.</p><div className="alarm-details-list">{records.length ? records.map(record => <article key={record.id}><div><b>{record.client || 'Cliente sin especificar'}</b><small>{prettyDate(record.date)}{record.time ? ` · ${record.time} Hs` : ''}</small></div><div className="alarm-detail-data"><span><b>Ubicación:</b> {record.address || 'Sin dirección'}</span><span><b>Contacto:</b> {record.phone || 'Sin contacto'}</span><span><b>Técnicos:</b> {record.technicians?.join(' / ') || 'Sin asignar'}</span>{record.detail && <span><b>Detalle:</b> {record.detail}</span>}</div></article>) : <div className="empty-state">No hay instalaciones de alarma completadas para este período.</div>}</div><div className="modal-actions"><button className="secondary" onClick={() => download('all')}><Icon name="upload" size={16} />Descargar Excel completo</button><button className="secondary" onClick={() => download('all', 'pdf')}><Icon name="upload" size={16} />Descargar PDF completo</button><button className="primary" onClick={close}>Cerrar</button></div></div></div>
}

/** Detalle de retiros que representan bajas y reducen el crecimiento neto. */
function RetirementDetailsModal({ records, month, close, download }) {
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalle de bajas de servicio"><div className="modal alarm-details-modal retirement-details-modal"><button className="close-modal" onClick={close} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">BAJAS DE SERVICIO</p><h2>{records.length} retiro{records.length === 1 ? '' : 's'} de alarma en {monthName}</h2><p>Estos registros se descuentan de las nuevas instalaciones para calcular el crecimiento neto real.</p><div className="alarm-details-list">{records.length ? records.map(record => <article key={record.id}><div><b>{record.client || 'Cliente sin especificar'}</b><small>{prettyDate(record.date)}{record.time ? ` · ${record.time} Hs` : ''}</small></div><div className="alarm-detail-data"><span><b>Servicio:</b> {record.service}</span><span><b>Dirección:</b> {record.address || 'Sin dirección'}</span><span><b>Técnicos:</b> {record.technicians?.join(' / ') || 'Sin asignar'}</span>{record.detail && <span><b>Detalle:</b> {record.detail}</span>}</div></article>) : <div className="empty-state">No hay bajas de servicio completadas para este período.</div>}</div><div className="modal-actions"><button className="secondary" onClick={() => download('retirements')}><Icon name="upload" size={16} />Descargar Excel completo</button><button className="secondary" onClick={() => download('retirements', 'pdf')}><Icon name="upload" size={16} />Descargar PDF completo</button><button className="primary" onClick={close}>Cerrar</button></div></div></div>
}

function History({ history, setHistory, customers, services, employees, authUser }) {
  return <HistoryView {...{ history, setHistory, customers, services, employees, authUser }} />
  const [search, setSearch] = useState('')
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizeSearchText(search))).sort(sortHistoryByDateAndTime)
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Consultá los servicios registrados para cada cliente y el equipo asignado.</p></div></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Técnicos asignados</span><span>Detalle</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><b>{prettyDate(record.date)}</b><div><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div>{record.technicians?.length ? record.technicians.join(' / ') : 'Sin técnicos asignados'}</div><div>{record.detail || 'Sin observaciones'}</div></div>) : <div className="empty-state">Todavía no hay trabajos registrados. Al copiar una agenda, sus servicios se guardarán aquí.</div>}</div></>
}

function HistoryView({ history, setHistory, customers, services, employees, authUser }) {
  return <HistoryManagement {...{ history, setHistory, customers, services, employees, authUser }} />
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizeSearchText(search))).sort(sortHistoryByDateAndTime)
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Consultá los servicios registrados para cada cliente y el equipo asignado.</p></div></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Técnicos asignados</span><span>Detalle</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><b>{prettyDate(record.date)}</b><div className="history-client"><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div>{record.technicians?.length ? record.technicians.join(' / ') : 'Sin técnicos asignados'}</div><div><button className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Ver detalle</button></div></div>) : <div className="empty-state">No hay trabajos para mostrar.</div>}</div>{detail && <HistoryDetail record={detail} close={() => setDetail(null)} />}</>
}

function HistoryBulkView({ history, setHistory, customers, services, employees, authUser }) {
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [selected, setSelected] = useState([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkStatus, setBulkStatus] = useState('Completado')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const minimumRescheduleDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const normalizedSearch = normalizeSearchText(search)
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizedSearch) && (!fromDate || record.date >= fromDate) && (!toDate || record.date <= toDate) && (statusFilter === 'all' || (record.status || 'Pendiente') === statusFilter)).sort(sortOperationalHistory)
  const technicianNames = record => record.technicians?.map(name => String(name).trim().split(/\s+/)[0]).filter(Boolean).join(' / ') || 'Sin asignar'
  const status = record => record.status || 'Pendiente'
  const toggle = id => setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  const toggleAll = () => setSelected(selected.length === records.length ? [] : records.map(record => record.id))
  const applyBulk = () => {
    if (!selected.length || (bulkStatus === 'Reprogramado' && (!rescheduleDate || rescheduleDate < minimumRescheduleDate))) return
    if (bulkStatus === 'Reprogramado') history.filter(record => selected.includes(record.id)).forEach(record => {
      window.dispatchEvent(new CustomEvent('pignus:reschedule-service', { detail: { record, nextDate: rescheduleDate, sourceDate: record.date } }))
    })
    setHistory(previous => previous.map(record => {
      if (!selected.includes(record.id)) return record
      // Una reprogramación mueve la visita al nuevo día para que Agenda técnica la recupere.
      if (bulkStatus === 'Reprogramado') return stampServiceRecord({ ...record, date: rescheduleDate, status: 'Pendiente', scheduledDate: '', rescheduledFrom: record.date, reprogrammedAt: new Date().toISOString() }, authUser)
      return stampServiceRecord({ ...record, status: bulkStatus, scheduledDate: '' }, authUser)
    }))
    setSelected([]); setBulkOpen(false); setRescheduleDate('')
  }
  // Eliminar en lote requiere una confirmación independiente para evitar borrados accidentales.
  const deleteSelected = () => {
    setHistory(previous => previous.filter(record => !selected.includes(record.id)))
    setSelected([])
    setBulkOpen(false)
    setBulkDeleteConfirm(false)
  }
  useEffect(() => {
    if (!bulkOpen || !selected.length) return undefined
    const actions = document.querySelector('.bulk-modal .modal-actions')
    if (!actions || actions.querySelector('.bulk-delete-button')) return undefined
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'danger-button bulk-delete-button'
    button.textContent = `Eliminar ${selected.length} registro(s)`
    button.onclick = () => setBulkDeleteConfirm(true)
    actions.prepend(button)
    return () => button.remove()
  }, [bulkOpen, selected.length])
  useEffect(() => {
    if (!bulkDeleteConfirm) return undefined
    const layer = document.createElement('div')
    layer.className = 'modal-layer bulk-delete-confirmation'
    layer.innerHTML = `<div class="modal confirm-modal"><span class="confirm-icon danger">🗑</span><h2>Eliminar registros</h2><p>¿Querés eliminar ${selected.length} servicio(s) seleccionados? Esta acción no se puede deshacer.</p><div class="confirm-actions"><button type="button" class="secondary">Cancelar</button><button type="button" class="danger-button">Sí, eliminar</button></div></div>`
    const [cancelButton, confirmButton] = layer.querySelectorAll('button')
    cancelButton.onclick = () => setBulkDeleteConfirm(false)
    confirmButton.onclick = deleteSelected
    document.body.append(layer)
    return () => layer.remove()
  }, [bulkDeleteConfirm, selected])
  useEffect(() => {
    const toolbar = document.querySelector('.history-toolbar')
    if (!toolbar) return undefined
    const filters = document.createElement('div'); filters.className = 'history-date-filters'
    const createDateInput = (label, value, update) => {
      const field = document.createElement('label'); field.textContent = label
      const input = document.createElement('input'); input.type = 'date'; input.value = value
      input.onchange = event => update(event.target.value)
      field.append(input)
      return { field, input }
    }
    const from = createDateInput('Desde', fromDate, setFromDate)
    const to = createDateInput('Hasta', toDate, setToDate)
    const statusField = document.createElement('label'); statusField.textContent = 'Estado'
    const statusSelect = document.createElement('select')
    ;[['all', 'Todos'], ['Pendiente', 'Pendiente'], ['Completado', 'Completado'], ['Requiere revisión', 'Requiere revisión'], ['Reprogramado', 'Reprogramado'], ['Cancelado', 'Cancelado']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; statusSelect.append(option)
    })
    statusSelect.value = statusFilter
    statusSelect.onchange = event => setStatusFilter(event.target.value)
    statusField.append(statusSelect)
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary history-clear-filters'; clear.textContent = 'Limpiar filtros'
    clear.onclick = () => { from.input.value = ''; to.input.value = ''; statusSelect.value = 'all'; setFromDate(''); setToDate(''); setStatusFilter('all') }
    filters.append(from.field, to.field, statusField, clear)
    toolbar.prepend(filters)
    return () => filters.remove()
    // Los inputs permanecen montados mientras se usa el selector nativo de iOS.
  }, [])
  useEffect(() => {
    const clear = document.querySelector('.history-clear-filters')
    if (clear) clear.hidden = !fromDate && !toDate && statusFilter === 'all'
    const counter = document.querySelector('.history-toolbar>div:not(.history-date-filters)')
    if (counter) counter.innerHTML = `<b>${records.length}</b> ${records.length === history.length ? 'trabajos registrados' : 'trabajos encontrados'}`
  }, [fromDate, toDate, statusFilter, records.length, history.length])
  useEffect(() => {
    // El componente de historial conserva parte de su estructura legada; aplicar la clase
    // al chip ya renderizado evita duplicar la tabla y mantiene el color sincronizado al filtrar.
    const colorClasses = ['service-alarm', 'service-cameras', 'service-retirement', 'service-ownership', 'service-fence', 'service-survey', 'service-upgrade', 'service-other']
    document.querySelectorAll('.history-bulk .role-chip').forEach(chip => {
      chip.classList.remove(...colorClasses)
      chip.classList.add(serviceColorClass(chip.textContent))
      chip.title = chip.textContent
    })
  }, [records])
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Seleccioná varios servicios para confirmarlos, cancelarlos o reprogramarlos en una sola acción.</p></div><button className="primary" disabled={!selected.length} onClick={() => setBulkOpen(true)}><Icon name="check" />{selected.length ? `Gestionar ${selected.length} seleccionados` : 'Gestionar selección'}</button></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table history-bulk"><div className="table-head"><span><input aria-label="Seleccionar todos" type="checkbox" checked={records.length > 0 && selected.length === records.length} onChange={toggleAll} /></span><span>Fecha</span><span>Hora</span><span>Cliente</span><span>Servicio</span><span>Técnicos asignados</span><span>Estado</span><span>Acciones</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><span><input aria-label={`Seleccionar ${record.client}`} type="checkbox" checked={selected.includes(record.id)} onChange={() => toggle(record.id)} /></span><b>{prettyDate(record.date)}</b><div className="history-time" aria-label={`Hora asignada: ${record.time || record.scheduledTime ? `${record.time || record.scheduledTime} Hs` : 'A confirmar'}`}>{record.time || record.scheduledTime ? `${record.time || record.scheduledTime} Hs` : 'A confirmar'}</div><div className="history-client"><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div className="history-technicians" title={record.technicians?.join(' / ') || 'Sin asignar'}><span>{technicianNames(record)}</span></div><div><span className={`work-status ${status(record).toLowerCase().replace(/\s/g, '-')}`}>{status(record)}</span>{record.scheduledDate && <small className="scheduled-date">Para: {prettyDate(record.scheduledDate)}</small>}</div><div><button className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Gestionar</button></div></div>) : <div className="empty-state">No hay trabajos para mostrar.</div>}</div>{bulkOpen && <div className="modal-layer"><div className="modal bulk-modal"><button className="close-modal" onClick={() => setBulkOpen(false)}><Icon name="close" /></button><p className="eyebrow">GESTIÓN MÚLTIPLE</p><h2>{selected.length} servicio(s) seleccionados</h2><p>La modificación se aplicará a todos los servicios elegidos.</p><label>Nuevo estado<select value={bulkStatus} onChange={event => setBulkStatus(event.target.value)}><option>Completado</option><option>Cancelado</option><option>Reprogramado</option></select></label>{bulkStatus === 'Reprogramado' && <label>Reprogramar para<input type="date" min={minimumRescheduleDate} value={rescheduleDate} onChange={event => setRescheduleDate(event.target.value)} /></label>}<div className="modal-actions"><button className="secondary" onClick={() => setBulkOpen(false)}>Cancelar</button><button className="primary" disabled={bulkStatus === 'Reprogramado' && (!rescheduleDate || rescheduleDate < minimumRescheduleDate)} onClick={applyBulk}>Aplicar cambios</button></div></div></div>}{detail && <HistoryManagementDetail record={detail} setHistory={setHistory} close={() => setDetail(null)} customers={customers} services={services} employees={employees} />}</>
}

function HistoryManagement({ history, setHistory, customers, services, employees, authUser }) {
  return <HistoryBulkView {...{ history, setHistory, customers, services, employees, authUser }} />
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const records = history.filter(record => normalizeSearchText(`${record.client} ${record.service} ${record.technicians?.join(' ')}`).includes(normalizeSearchText(search))).sort(sortHistoryByDateAndTime)
  const status = record => record.status || 'Pendiente'
  return <><div className="module-intro"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h1>Historial técnico</h1><p>Gestioná la confirmación, cancelación o reprogramación de cada servicio.</p></div></div><div className="accounts-bar history-toolbar"><div><b>{history.length}</b> trabajos registrados</div><label><Icon name="search" size={16} /><input placeholder="Buscar cliente, servicio o técnico..." value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="data-card history-table"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Servicio</span><span>Estado</span><span>Detalle</span></div>{records.length ? records.map(record => <div className="history-row" key={record.id}><b>{prettyDate(record.date)}</b><div className="history-client"><strong>{record.client}</strong><small>{record.address || 'Sin dirección'}</small></div><div><em className="role-chip">{record.service}</em></div><div><span className={`work-status ${status(record).toLowerCase().replace(/\s/g, '-')}`}>{status(record)}</span>{record.scheduledDate && <small className="scheduled-date">Para: {prettyDate(record.scheduledDate)}</small>}</div><div><button className="secondary detail-button" onClick={() => setDetail(record)}><Icon name="eye" size={16} />Gestionar</button></div></div>) : <div className="empty-state">No hay trabajos para mostrar.</div>}</div>{detail && <HistoryManagementDetail record={detail} setHistory={setHistory} close={() => setDetail(null)} />}</>
}

function HistoryManagementDetail({ record, setHistory, close, customers, services, employees, authUser }) {
  const [rescheduleDate, setRescheduleDate] = useState(record.scheduledDate || '')
  const minimumRescheduleDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = document.querySelector('.history-detail .history-edit-grid, .history-detail .history-detail-grid')
      appendTraceElement(container, record)
      container?.querySelector(':scope > .service-trace')?.classList.add('history-modal-trace')
    })
    return () => cancelAnimationFrame(frame)
  }, [record, editing])
  const [draft, setDraft] = useState({ customerId: record.customerId || '', serviceId: record.serviceId || '', technicianIds: record.technicianIds || [], teamId: record.teamId || '', team: record.team || '', address: record.address || '', phone: record.phone || '', detail: record.detail || '' })
  const update = patch => {
    // Al elegir una nueva fecha, el servicio deja de pertenecer al día original y vuelve
    // a Pendiente para quedar disponible en la agenda de la fecha reprogramada.
    const isReschedule = patch.status === 'Reprogramado' && patch.scheduledDate
    const changes = isReschedule
      ? { ...patch, date: patch.scheduledDate, status: 'Pendiente', scheduledDate: '', rescheduledFrom: record.date, reprogrammedAt: new Date().toISOString() }
      : patch.technicalReportedAt === '' ? { ...patch, technicalReportedById: '', technicalReportedByName: '' } : patch
    const tracedRecord = stampServiceRecord({ ...record, ...changes }, authUser)
    if (isReschedule) window.dispatchEvent(new CustomEvent('pignus:reschedule-service', { detail: { record: tracedRecord, nextDate: patch.scheduledDate, sourceDate: record.date } }))
    setHistory(previous => previous.map(item => item.id === record.id ? tracedRecord : item)); close()
  }
  const remove = () => { setHistory(previous => previous.filter(item => item.id !== record.id)); close() }
  const saveChanges = () => {
    const customer = customers.find(item => String(item.customerId) === String(draft.customerId))
    const service = services.find(item => String(item.id) === String(draft.serviceId))
    const technicians = employees.filter(employee => draft.technicianIds.some(id => String(id) === String(employee.id)))
    if (!customer || !service) return
    const patch = { ...draft, customerId: customer.customerId, clientAccount: customer.account, clientNameAtService: customer.name, client: `${customer.account} ${customer.name}`, serviceId: service.id, service: service.name, technicianIds: technicians.map(employee => employee.id), technicians: technicians.map(employee => employee.name) }
    window.dispatchEvent(new CustomEvent('pignus:sync-agenda-service', { detail: { record, patch } })); update(patch)
  }
  const status = record.status || 'Pendiente'
  const setField = field => event => setDraft(previous => ({ ...previous, [field]: event.target.value }))
  useEffect(() => {
    if (!record.technicalObservation && !record.technicalReportedAt) return
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
  }, [record, editing])
  useEffect(() => {
    if (editing) return undefined
    const actions = document.querySelector('.history-detail .history-actions')
    const dateInput = actions?.querySelector('input[type="date"]')
    const field = dateInput?.closest('label')
    const trigger = [...(actions?.querySelectorAll('button') || [])].find(button => button.textContent.trim() === 'Reprogramar')
    if (!field || !trigger) return undefined
    field.classList.add('reschedule-field')
    trigger.classList.add('reschedule-trigger')
    field.hidden = true
    trigger.disabled = false
    trigger.setAttribute('aria-expanded', 'false')
    const reveal = event => {
      if (!field.hidden) return
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      field.hidden = false
      trigger.setAttribute('aria-expanded', 'true')
      requestAnimationFrame(() => dateInput.focus({ preventScroll: true }))
    }
    trigger.addEventListener('click', reveal, true)
    return () => trigger.removeEventListener('click', reveal, true)
  }, [editing])
  useEffect(() => {
    if (!pendingAction) return undefined
    const layer = document.createElement('div')
    layer.className = 'modal-layer history-action-confirmation'
    const modal = document.createElement('div'); modal.className = 'modal confirm-modal'
    const icon = document.createElement('span'); icon.className = `confirm-icon ${pendingAction.destructive ? 'danger' : ''}`; icon.textContent = pendingAction.icon
    const title = document.createElement('h2'); title.textContent = pendingAction.title
    const detail = document.createElement('p'); detail.textContent = pendingAction.detail
    const actions = document.createElement('div'); actions.className = 'confirm-actions'
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Volver'
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = pendingAction.destructive ? 'danger-button' : 'primary'; confirm.textContent = pendingAction.confirmLabel
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
      if (text.includes('marcar completado')) action = { title: 'Marcar servicio como completado', detail: '¿Confirmás que el servicio fue realizado?', confirmLabel: 'Sí, marcar completado', icon: '✓', patch: { status: 'Completado', scheduledDate: '' } }
      if (text.includes('marcar pendiente')) action = { title: 'Volver el servicio a pendiente', detail: '¿Confirmás que este servicio todavía no fue completado? Volverá a incluirse entre los trabajos pendientes.', confirmLabel: 'Sí, marcar pendiente', icon: '↶', patch: { status: 'Pendiente', scheduledDate: '', technicalStatus: '', technicalObservation: '', technicalReportedAt: '' } }
      if (text.includes('cancelar servicio')) action = { title: 'Cancelar servicio', detail: '¿Confirmás la cancelación de este servicio?', confirmLabel: 'Sí, cancelar servicio', icon: '!', destructive: true, patch: { status: 'Cancelado', scheduledDate: '' } }
      if (text.includes('reprogramar') && rescheduleDate >= minimumRescheduleDate) action = { title: 'Reprogramar servicio', detail: `¿Confirmás reprogramar el servicio para ${prettyDate(rescheduleDate)}?`, confirmLabel: 'Sí, reprogramar', icon: '↻', patch: { status: 'Reprogramado', scheduledDate: rescheduleDate } }
      if (!action) return
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      setPendingAction(action)
    }
    actions.addEventListener('click', intercept, true)
    return () => actions.removeEventListener('click', intercept, true)
  }, [editing, rescheduleDate, minimumRescheduleDate])
  return <><div className="modal-layer"><div className="modal detail-modal history-detail"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">{prettyDate(record.date)} · {status.toUpperCase()}</p><div className="history-detail-heading"><h2>{editing ? 'Editar servicio' : record.client}</h2><button className="secondary detail-edit" onClick={() => setEditing(!editing)}><Icon name="edit" size={15} />{editing ? 'Cancelar edición' : 'Editar datos'}</button></div>{editing ? <div className="history-edit-grid"><label>Cliente o cuenta<select value={draft.customerId} onChange={setField('customerId')}><option value="">Seleccionar</option>{customers.map(customer => <option key={customer.customerId} value={customer.customerId}>{customer.account} · {customer.name}</option>)}</select></label><label>Tipo de servicio<select value={draft.serviceId} onChange={setField('serviceId')}><option value="">Seleccionar</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Equipo<input readOnly value={draft.team} title="La identidad del equipo se conserva mediante su ID interno" /></label><label>Técnicos asignados<select multiple value={draft.technicianIds} onChange={event => setDraft(previous => ({ ...previous, technicianIds: [...event.target.selectedOptions].map(option => option.value) }))}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label>Dirección<input value={draft.address} onChange={setField('address')} /></label><label>Contacto<input value={draft.phone} onChange={setField('phone')} /></label><label className="detail-notes">Detalle / observaciones<textarea value={draft.detail} onChange={setField('detail')} /></label></div> : <div className="history-detail-grid"><div><b>Servicio</b><span>{record.service}</span></div><div><b>Equipo</b><span>{record.team}</span></div><div><b>Técnicos asignados</b><span>{record.technicians?.join(' / ') || 'Sin técnicos asignados'}</span></div><div><b>Hora asignada</b><span>{record.time || record.scheduledTime || 'Sin horario'}</span></div><div><b>Dirección</b><span>{record.address || 'Sin dirección'}</span></div><div><b>Contacto</b><span>{record.phone || 'Sin contacto'}</span></div><div className="detail-notes"><b>Detalle / observaciones</b><span>{record.detail || 'Sin observaciones'}</span></div></div>}{editing ? <div className="history-actions"><button className="primary" onClick={saveChanges}><Icon name="check" />Guardar cambios</button><button className="secondary" onClick={() => setEditing(false)}>Cancelar</button></div> : <div className="history-actions">{status === 'Pendiente' ? <button className="primary" onClick={() => update({ status: 'Completado', scheduledDate: '' })}><Icon name="check" />Marcar completado</button> : <button className="pending-button" onClick={() => update({ status: 'Pendiente', scheduledDate: '', technicalStatus: '', technicalObservation: '', technicalReportedAt: '' })}><Icon name="history" />Marcar pendiente</button>}<button className="secondary" onClick={() => update({ status: 'Cancelado', scheduledDate: '' })}><Icon name="close" />Cancelar servicio</button><label>Reprogramar para<input type="date" min={minimumRescheduleDate} value={rescheduleDate} onChange={event => setRescheduleDate(event.target.value)} /></label><button className="secondary" disabled={!rescheduleDate || rescheduleDate < minimumRescheduleDate} onClick={() => { if (rescheduleDate >= minimumRescheduleDate) update({ status: 'Reprogramado', scheduledDate: rescheduleDate }) }}><Icon name="calendar" />Reprogramar</button><button className="danger-button delete-history" onClick={() => setConfirmDelete(true)}><Icon name="trash" />Eliminar registro</button></div>}</div></div>{confirmDelete && <Confirm title="Eliminar registro" detail="¿Querés eliminar este servicio del historial? Esta acción no se puede deshacer." destructive action={remove} close={() => setConfirmDelete(false)} />}</> }

function HistoryDetail({ record, close }) { return <div className="modal-layer"><div className="modal detail-modal history-detail"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">{prettyDate(record.date)}</p><h2>{record.client}</h2><div className="history-detail-grid"><div><b>Servicio</b><span>{record.service}</span></div><div><b>Equipo</b><span>{record.team}</span></div><div><b>Técnicos asignados</b><span>{record.technicians?.join(' / ') || 'Sin técnicos asignados'}</span></div><div><b>Dirección</b><span>{record.address || 'Sin dirección'}</span></div><div><b>Contacto</b><span>{record.phone || 'Sin contacto'}</span></div><div className="detail-notes"><b>Detalle / observaciones</b><span>{record.detail || 'Sin observaciones'}</span></div></div></div></div> }

function Accounts({ customers, setCustomers, setNotice, ask, history, teams, weekly }) {
  const [search, setSearch] = useState(''); const [form, setForm] = useState(blankCustomer); const [editing, setEditing] = useState(null); const [showForm, setShowForm] = useState(false); const [importOpen, setImportOpen] = useState(false); const [detail, setDetail] = useState(null); const [customerHistory, setCustomerHistory] = useState(null)
  const [pageSize, setPageSize] = useState(20); const [page, setPage] = useState(1)
  const visible = useMemo(() => customers
    .filter(c => normalizeSearchText(`${c.account} ${c.name} ${c.locality}`).includes(normalizeSearchText(search)))
    .sort((a, b) => String(a.account || '').localeCompare(String(b.account || ''), 'es', { numeric: true, sensitivity: 'base' })), [customers, search])
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paginatedCustomers = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [search, pageSize])
  const save = e => {
    e.preventDefault()
    const kind = customerKind(form)
    const customer = { ...form, customerId: form.customerId || createCustomerId(), kind, account: normalizeAccountKey(form.account || nextCustomerCode(customers, kind)), name: normalizeCustomerName(form.name), address: [form.street, form.locality, form.province].filter(Boolean).join(', ') }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar los cambios de ${customer.name}?`, () => {
      setCustomers(previous => editing ? previous.map(item => item.customerId === editing ? customer : item) : [...previous, customer])
      setShowForm(false); setEditing(null); setNotice(`${customerKindLabel(customer)} guardado correctamente.`)
    })
  }
  const edit = customer => { setForm(customer); setEditing(customer.customerId); setShowForm(true) }
  const startNew = () => { const kind = 'client'; setEditing(null); setForm({ ...blankCustomer, customerId: createCustomerId(), kind, account: nextCustomerCode(customers, kind) }); setShowForm(true) }
  const removeCustomer = customer => {
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => String(record.customerId) === String(customer.customerId)) || agendaTeams.some(team => (team.tasks || []).some(task => String(task.customerId) === String(customer.customerId)))
    if (referenced) { setNotice('No se puede eliminar: el abonado o cliente tiene servicios vinculados.'); return }
    setCustomers(items => items.filter(item => item.customerId !== customer.customerId)); setNotice('El registro fue eliminado.')
  }
  return <><div className="module-intro"><div><p className="eyebrow">REGISTRO COMERCIAL</p><h1>Abonados y clientes</h1><p>Los códigos PIG identifican abonados; los códigos CLI, clientes sin abono.</p></div><div className="action-group"><button className="secondary" onClick={() => setImportOpen(true)}><Icon name="upload" />Importar abonados</button><button className="primary" onClick={startNew}><Icon name="plus" />Nuevo cliente</button></div></div>{showForm && <CustomerForm form={form} setForm={setForm} editing={editing} customers={customers} save={save} cancel={() => setShowForm(false)} />}<div className="accounts-bar"><div><b>{customers.length}</b> registros</div><label><Icon name="search" size={16} /><input placeholder="Buscar por nombre, código o localidad..." value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="data-card accounts-table"><div className="table-head">{['Código', 'Abonado / Cliente', 'Dirección', 'Teléfono', 'Acciones'].map(x => <span key={x}>{x}</span>)}</div>{visible.length ? paginatedCustomers.map(customer => <div className="account-row" key={customer.customerId}><b>{customer.account}</b><div><strong>{customer.name}</strong><small>{customerKindLabel(customer)} · {customer.type || 'Sin categoría'}</small></div><div>{customer.address}</div><div>{customer.phone || 'Sin teléfono'}</div><div className="row-actions"><button title="Ver historial de servicios" aria-label={`Ver historial de servicios de ${customer.account}`} onClick={() => setCustomerHistory(customer)}><Icon name="history" size={16} /></button><button title="Ver información completa" onClick={() => setDetail(customer)}><Icon name="eye" size={16} /></button><button title="Editar" onClick={() => edit(customer)}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar" onClick={() => ask(`Eliminar ${customerKindLabel(customer).toLowerCase()}`, `¿Querés eliminar ${customer.account}? Esta acción no se puede deshacer.`, () => removeCustomer(customer), true)}><Icon name="trash" size={16} /></button></div></div>) : <div className="empty-state">No hay abonados o clientes para mostrar.</div>}</div>{visible.length > 0 && <nav className="accounts-pagination" aria-label="Paginación de abonados y clientes"><div className="pagination-size"><span>Mostrar</span><select value={pageSize} onChange={event => setPageSize(Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select><span>registros</span></div><span className="pagination-summary">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} de {visible.length}</span><div className="pagination-controls"><button className="secondary" disabled={currentPage === 1} onClick={() => setPage(previous => Math.max(1, previous - 1))}>Anterior</button><span>Página {currentPage} de {totalPages}</span><button className="secondary" disabled={currentPage === totalPages} onClick={() => setPage(previous => Math.min(totalPages, previous + 1))}>Siguiente</button></div></nav>}{importOpen && <ImportModal {...{ customers, setCustomers, close: () => setImportOpen(false), setNotice }} />}{detail && <CustomerDetail customer={detail} close={() => setDetail(null)} />}{customerHistory && <CustomerServiceHistory customer={customerHistory} history={history} close={() => setCustomerHistory(null)} />}</>
}
function CustomerForm({ form, setForm, editing, customers, save, cancel }) {
  const set = key => event => setForm({ ...form, [key]: key === 'name' ? event.target.value.toLocaleUpperCase('es-AR') : event.target.value })
  const changeKind = event => { const kind = event.target.value; setForm({ ...form, kind, account: editing ? form.account : nextCustomerCode(customers, kind) }) }
  const requiredLabel = text => <RequiredLabel>{text}</RequiredLabel>
  return <div className="modal-layer customer-editor-layer" role="dialog" aria-modal="true" aria-label={editing ? 'Editar abonado o cliente' : 'Nuevo cliente'} onMouseDown={cancel}><div className="modal customer-editor-modal" onMouseDown={event => event.stopPropagation()}><button type="button" className="close-modal" onClick={cancel} aria-label="Cerrar"><Icon name="close" /></button><p className="eyebrow">{editing ? 'EDITAR REGISTRO' : 'NUEVO REGISTRO'}</p><h2>{editing ? `${form.account} · ${form.name}` : 'Crear cliente'}</h2><p>{editing ? 'Actualizá los datos del abonado o cliente seleccionado.' : 'Completá los datos obligatorios para poder usarlo en las agendas.'}</p><form className="customer-form" onSubmit={save}><label>Condición<select disabled={!!editing} value={customerKind(form)} onChange={changeKind}><option value="subscriber">Abonado</option><option value="client">Cliente</option></select></label><label>{requiredLabel('Código')}<input required readOnly value={form.account} /></label><label>{requiredLabel('Nombre')}<input required value={form.name} onChange={set('name')} /></label><label>Categoría<input value={form.type} onChange={set('type')} placeholder="Ej.: Residencial o Comercial" /></label><label>{requiredLabel('Calle / dirección')}<input required value={form.street} onChange={set('street')} /></label><label>Localidad<input value={form.locality} onChange={set('locality')} /></label><label>Provincia / Estado<input value={form.province} onChange={set('province')} /></label><label>{requiredLabel('Teléfono / contacto')}<input required value={form.phone} onChange={set('phone')} /></label><button className="primary"><Icon name="check" />Guardar {customerKindLabel(form).toLowerCase()}</button><button type="button" className="secondary" onClick={cancel}>Cancelar</button></form></div></div>
}

function ServiceTypes({ services, setServices, setNotice, ask, history, teams, weekly }) {
  const [form, setForm] = useState({ name: '', description: '', status: 'Activo' })
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const save = event => {
    event.preventDefault()
    const nextId = editing || Date.now()
    const record = { ...form, id: nextId, code: editing ? serviceCode(form) : `service-${nextId}`, category: editing ? (form.category || 'service') : (normalizeServiceName(form.name).startsWith('instalacion') ? 'installation' : 'service') }
    ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el tipo de servicio ${record.name}?`, () => {
      setServices(previous => editing ? previous.map(service => service.id === editing ? record : service) : [...previous, record])
      setOpen(false); setEditing(null); setNotice('El tipo de servicio fue guardado correctamente.')
    })
  }
  const removeService = service => {
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => String(record.serviceId) === String(service.id)) || agendaTeams.some(team => (team.tasks || []).some(task => String(task.serviceId) === String(service.id)))
    if (referenced) { setServices(previous => previous.map(item => item.id === service.id ? { ...item, status: 'Inactivo' } : item)); setNotice('El servicio tiene registros vinculados: se marcó como inactivo en lugar de eliminarlo.'); return }
    setServices(previous => previous.filter(item => item.id !== service.id)); setNotice('El tipo de servicio fue eliminado.')
  }
  return <><div className="module-intro"><div><p className="eyebrow">CATÁLOGO OPERATIVO</p><h1>Tipo de servicio</h1><p>Administrá los servicios disponibles para planificar en la agenda técnica.</p></div><button className="primary" onClick={() => { setForm({ name: '', description: '', status: 'Activo' }); setEditing(null); setOpen(true) }}><Icon name="plus" />Nuevo servicio</button></div>{open && <form className="service-form" onSubmit={save}><label><RequiredLabel>Nombre del servicio</RequiredLabel><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Descripción<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label><button className="primary"><Icon name="check" />{editing ? 'Guardar cambios' : 'Guardar servicio'}</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button></form>}<div className="data-card services-table"><div className="table-head"><span>Servicio</span><span>Descripción</span><span>Estado</span><span>Acciones</span></div>{services.map(service => <div className="service-row" key={service.id}><b>{service.name}</b><span>{service.description || 'Sin descripción'}</span><div><button className={`status ${service.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar ${service.name} como ${service.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => setServices(previous => previous.map(item => item.id === service.id ? { ...item, status: item.status === 'Activo' ? 'Inactivo' : 'Activo' } : item)))}>{service.status}</button></div><div className="row-actions"><button title="Editar servicio" onClick={() => { setForm(service); setEditing(service.id); setOpen(true) }}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar servicio" onClick={() => ask('Eliminar servicio', `¿Querés eliminar ${service.name}?`, () => removeService(service), true)}><Icon name="trash" size={16} /></button></div></div>)}</div></>
}

const blankVehicle = () => ({ brand: '', model: '', year: String(new Date().getFullYear()), mileage: '', plate: '' })

function Vehicles({ vehicles, setVehicles, setNotice, ask }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blankVehicle)
  const maximumYear = new Date().getFullYear() + 1
  const startCreate = () => { setForm(blankVehicle()); setEditing(null); setOpen(true) }
  const startEdit = vehicle => { setForm({ ...vehicle, year: String(vehicle.year), mileage: vehicle.mileage == null ? '' : String(vehicle.mileage) }); setEditing(vehicle.id); setOpen(true) }
  const save = event => {
    event.preventDefault()
    const record = { id: editing || globalThis.crypto?.randomUUID?.() || `vehicle-${Date.now()}`, brand: form.brand.trim(), model: form.model.trim(), year: Number(form.year), mileage: Number(form.mileage), plate: form.plate.trim().toLocaleUpperCase('es-AR') }
    if (!record.brand || !record.model || !record.plate || !Number.isInteger(record.year) || record.year < 1886 || record.year > maximumYear || form.mileage === '' || !Number.isInteger(record.mileage) || record.mileage < 0 || record.mileage > 99999999) return setNotice(`Completá Marca, Modelo, Año, Kilometraje y Matrícula. El año debe estar entre 1886 y ${maximumYear}, y el kilometraje debe ser un número entero no negativo.`)
    if (vehicles.some(vehicle => vehicle.id !== editing && String(vehicle.plate || '').trim().toLocaleUpperCase('es-AR') === record.plate)) return setNotice('Ya existe un vehículo con esa matrícula.')
    setVehicles(previous => editing ? previous.map(vehicle => vehicle.id === editing ? record : vehicle) : [...previous, record])
    setOpen(false)
    setNotice(editing ? 'Los datos del vehículo fueron actualizados.' : 'El vehículo fue agregado a la flota.')
  }
  const remove = vehicle => ask('Eliminar vehículo', `¿Querés eliminar ${vehicle.brand} ${vehicle.model} · ${vehicle.plate}?`, () => { setVehicles(previous => previous.filter(item => item.id !== vehicle.id)); setNotice('El vehículo fue eliminado de la flota.') }, true)
  return <><div className="module-intro"><div><p className="eyebrow">FLOTA DE LA EMPRESA</p><h1>Vehículos</h1><p>Administrá los vehículos disponibles y mantené actualizados sus datos identificatorios.</p></div><button className="primary" onClick={startCreate}><Icon name="plus" />Nuevo vehículo</button></div>{open && <form className="vehicle-form" onSubmit={save}><label><RequiredLabel>Marca</RequiredLabel><input required maxLength="80" autoFocus value={form.brand} onChange={event => setForm({ ...form, brand: event.target.value })} /></label><label><RequiredLabel>Modelo</RequiredLabel><input required maxLength="120" value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} /></label><label><RequiredLabel>Año</RequiredLabel><input required type="number" inputMode="numeric" min="1886" max={maximumYear} value={form.year} onChange={event => setForm({ ...form, year: event.target.value })} /></label><label><RequiredLabel>Kilometraje</RequiredLabel><input required type="number" inputMode="numeric" min="0" max="99999999" step="1" value={form.mileage} onChange={event => setForm({ ...form, mileage: event.target.value })} /></label><label><RequiredLabel>Matrícula</RequiredLabel><input required maxLength="20" autoCapitalize="characters" value={form.plate} onChange={event => setForm({ ...form, plate: event.target.value.toLocaleUpperCase('es-AR') })} /></label><button className="primary"><Icon name="check" />{editing ? 'Guardar cambios' : 'Guardar vehículo'}</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button></form>}<div className="data-card vehicles-table"><div className="table-head"><span>Marca</span><span>Modelo</span><span>Año</span><span>Kilometraje</span><span>Matrícula</span><span>Acciones</span></div>{vehicles.length ? vehicles.map(vehicle => <div className="vehicle-row" key={vehicle.id}><b>{vehicle.brand}</b><span>{vehicle.model}</span><span>{vehicle.year}</span><span>{vehicle.mileage == null ? 'Sin registrar' : `${Number(vehicle.mileage).toLocaleString('es-AR')} km`}</span><strong>{vehicle.plate}</strong><div className="row-actions"><button title="Editar vehículo" onClick={() => startEdit(vehicle)}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar vehículo" onClick={() => remove(vehicle)}><Icon name="trash" size={16} /></button></div></div>) : <div className="empty-state">Todavía no hay vehículos registrados.</div>}</div></>
}

function Employees({ employees, setEmployees, roles, setNotice, ask, history, teams, weekly }) {
  const [form, setForm] = useState(blankEmployee); const [editing, setEditing] = useState(null); const [open, setOpen] = useState(false)
  const save = e => { e.preventDefault(); const firstName = form.firstName.trim(); const lastName = form.lastName.trim(); const assignedRole = roles.find(role => String(role.id) === String(form.roleId)) || roles.find(role => role.name === form.role); const record = { ...form, firstName, lastName, name: `${firstName} ${lastName}`.trim(), roleId: assignedRole?.id, role: assignedRole?.name || form.role, id: editing || Date.now() }; ask(editing ? 'Confirmar edición' : 'Confirmar alta', `¿Querés guardar el perfil de ${record.name}?`, () => { setEmployees(prev => editing ? prev.map(x => x.id === editing ? record : x) : [...prev, record]); setOpen(false); setEditing(null); setNotice('El empleado fue guardado correctamente.') }) }
  const removeEmployee = employee => {
    const agendaTeams = [...(teams || []), ...Object.entries(weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams' ? Object.values(value || {}).flatMap(config => config?.teams || []) : key.startsWith('_') ? [] : value?.teams || [])]
    const referenced = history.some(record => (record.technicianIds || []).some(id => String(id) === String(employee.id))) || agendaTeams.some(team => (team.memberIds || []).some(id => String(id) === String(employee.id)))
    if (referenced) { setEmployees(previous => previous.map(item => item.id === employee.id ? { ...item, status: 'Inactivo' } : item)); setNotice('El empleado tiene asignaciones vinculadas: se marcó como inactivo en lugar de eliminarlo.'); return }
    setEmployees(previous => previous.filter(item => item.id !== employee.id)); setNotice('El empleado fue eliminado.')
  }
  return <><div className="module-intro"><div><p className="eyebrow">EQUIPO PIGNUS</p><h1>Técnicos y colaboradores</h1><p>Administrá accesos, datos de contacto y disponibilidad del equipo.</p></div><button className="primary" onClick={() => { setForm(blankEmployee); setEditing(null); setOpen(true) }}><Icon name="plus" />Nuevo empleado</button></div>{open && <EmployeeForm {...{ form, setForm, roles, save, cancel: () => setOpen(false), editing }} />}<div className="data-card employees-table"><div className="table-head">{['Empleado', 'Rol', 'Correo', 'Contacto', 'Estado', 'Acciones'].map(x => <span key={x}>{x}</span>)}</div>{employees.map(x => <div className="employee-row" key={x.id}><div className="person"><span>{initials(x.name)}</span><b>{x.name}</b></div><div><em className="role-chip">{roles.find(role => String(role.id) === String(x.roleId))?.name || x.role}</em></div><div>{x.email}</div><div>{x.phone || 'Sin teléfono'}</div><div><button className={`status ${x.status === 'Activo' ? 'on' : ''}`} onClick={() => ask('Cambiar estado', `¿Querés marcar a ${x.name} como ${x.status === 'Activo' ? 'inactivo' : 'activo'}?`, () => setEmployees(prev => prev.map(y => y.id === x.id ? { ...y, status: y.status === 'Activo' ? 'Inactivo' : 'Activo' } : y)))}>{x.status}</button></div><div className="row-actions"><button title="Editar empleado" onClick={() => { setForm(x); setEditing(x.id); setOpen(true) }}><Icon name="edit" size={16} /></button><button className="delete" title="Eliminar empleado" onClick={() => ask('Eliminar empleado', `¿Querés eliminar el perfil de ${x.name}?`, () => removeEmployee(x), true)}><Icon name="trash" size={16} /></button></div></div>)}</div></>
}
function EmployeeForm({ form, setForm, roles, save, cancel, editing }) { const set = key => e => setForm({ ...form, [key]: e.target.value }); return <form className="employee-form employee-form-wide" onSubmit={save}><label><RequiredLabel>Nombre</RequiredLabel><input required value={form.firstName || ''} onChange={set('firstName')} /></label><label><RequiredLabel>Apellido</RequiredLabel><input required value={form.lastName || ''} onChange={set('lastName')} /></label><label><RequiredLabel>Rol</RequiredLabel><select required value={form.roleId ?? roles.find(role => role.name === form.role)?.id ?? ''} onChange={event => { const selectedRole = roles.find(role => String(role.id) === event.target.value); setForm({ ...form, roleId: selectedRole?.id, role: selectedRole?.name || '' }) }}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Teléfono<input value={form.phone} onChange={set('phone')} /></label><label><RequiredLabel>Correo electrónico</RequiredLabel><input required type="email" value={form.email} onChange={set('email')} /></label><label>{editing ? 'Contraseña' : <RequiredLabel>Contraseña</RequiredLabel>}<input required={!editing} minLength="8" autoComplete="new-password" type="password" value={form.password || ''} placeholder={editing ? 'Dejar vacío para conservarla' : 'Mínimo 8 caracteres'} onChange={set('password')} /></label><button className="primary"><Icon name="check" />{editing ? 'Guardar cambios' : 'Guardar empleado'}</button><button type="button" className="secondary" onClick={cancel}>Cancelar</button></form> }

function Settings({ roles, setRoles, setNotice, ask }) {
  const [active, setActive] = useState(roles[0]?.id); const [editing, setEditing] = useState(false); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const role = roles.find(x => x.id === active) || roles[0]
  const startEdit = r => { setActive(r.id); setName(r.name); setDescription(r.description); setEditing(true) }
  const save = () => { const nextId = editing === 'new' ? Date.now() : role.id; const next = { id: nextId, code: editing === 'new' ? `role-${nextId}` : roleCode(role), name, description, permissions: editing === 'new' ? { ...DEFAULT_MODULE_PERMISSIONS, dashboard: true, agenda: true } : { ...DEFAULT_MODULE_PERMISSIONS, ...role.permissions } }; ask(editing === 'new' ? 'Crear rol' : 'Guardar permisos', `¿Querés confirmar los cambios del rol ${name}?`, () => { setRoles(prev => editing === 'new' ? [...prev, next] : prev.map(x => x.id === role.id ? next : x)); setActive(next.id); setEditing(false); setNotice('La configuración del rol fue guardada.') }) }
  const toggle = key => ask('Modificar permiso', `¿Querés ${role.permissions?.[key] ? 'revocar' : 'otorgar'} este permiso al rol ${role.name}?`, () => setRoles(prev => prev.map(x => x.id === role.id ? { ...x, permissions: { ...DEFAULT_MODULE_PERMISSIONS, ...x.permissions, [key]: !x.permissions?.[key] } } : x)))
  return <><div className="module-intro"><div><p className="eyebrow">ADMINISTRACIÓN</p><h1>Roles y permisos</h1><p>Definí el acceso que tendrá cada integrante de la plataforma.</p></div><button className="primary" onClick={() => { setName(''); setDescription(''); setEditing('new') }}><Icon name="plus" />Nuevo rol</button></div><div className="settings-grid"><article className="data-card roles-card"><h2>Roles disponibles</h2>{roles.map(r => <div className={r.id === role?.id ? 'selected-role' : ''} key={r.id} onClick={() => setActive(r.id)}><span className="role-dot">{r.name[0]}</span><div><b>{r.name}</b><p>{r.description}</p></div><button onClick={e => { e.stopPropagation(); startEdit(r) }} title="Editar rol"><Icon name="edit" size={16} /></button></div>)}</article><article className="data-card permissions-card">{editing ? <div className="role-editor"><p className="eyebrow">{editing === 'new' ? 'NUEVO ROL' : 'EDITAR ROL'}</p><label>Nombre del rol<input value={name} onChange={e => setName(e.target.value)} /></label><label>Descripción<input value={description} onChange={e => setDescription(e.target.value)} /></label><button className="primary" onClick={save}><Icon name="check" />Guardar rol</button><button className="secondary" onClick={() => setEditing(false)}>Cancelar</button></div> : <><p className="eyebrow">PERFIL: {role?.name?.toUpperCase()}</p><h2>Permisos del módulo</h2>{MODULE_PERMISSIONS.map(([key, label, detail]) => { const auditOnly = key === 'audit'; const adminRole = roleCode(role) === 'administrator'; return <label className={`permission ${auditOnly ? 'locked-permission' : ''}`} key={key}><span><b>{label}</b><small>{auditOnly ? 'Exclusivo del rol Administrador' : detail}</small></span><input type="checkbox" checked={auditOnly ? adminRole : !!role?.permissions?.[key]} disabled={auditOnly} onChange={() => toggle(key)} /><i /></label> })}<button className="primary save" onClick={() => startEdit(role)}><Icon name="edit" />Editar rol</button></>}</article></div></>
}

function ImportModal({ customers, setCustomers, close, setNotice }) {
  const [message, setMessage] = useState('')

  const importFile = async e => {
    const file = e.target.files?.[0]
    if (!file) return

    const doc = new DOMParser().parseFromString(await file.text(), 'text/html')
    const table = [...doc.querySelectorAll('table')].find(t => t.textContent.toLowerCase().includes('dealer/cuenta'))
    if (!table) return setMessage('No se encontró una tabla con la columna Dealer/Cuenta.')

    const rows = [...table.querySelectorAll('tr')]
      .map(r => [...r.querySelectorAll('th,td')].map(c => c.textContent.replace(/\s+/g, ' ').trim()))
      .filter(r => r.length)
    const headers = rows.shift()
    const get = (row, label) => row[headers.findIndex(x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === label)] || ''

    const imported = rows.map(row => {
      const account = normalizeAccountKey(get(row, 'dealercuenta'))
      const street = get(row, 'calle'), locality = get(row, 'localidad'), province = get(row, 'provinciaestado')
      const name = normalizeCustomerName(get(row, 'nombre')) || '-'
      const requiredStreet = street || '-'
      const phone = get(row, 'telefono') || '-'
      return account ? { customerId: '', kind: 'subscriber', account, name, type: get(row, 'tipodecuenta'), street: requiredStreet, locality, province, phone, address: [requiredStreet, locality, province].filter(Boolean).join(', '), fields: Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])) } : null
    }).filter(Boolean)
    if (!imported.length) return setMessage('El archivo no contiene registros válidos.')

    // The report is incremental: accounts not included in the file stay intact.
    // Matching accounts are updated, while missing report values preserve prior
    // customer data instead of accidentally erasing it.
    const existingByAccount = new Map(customers.map(customer => [normalizeAccountKey(customer.account), customer]))
    const importedKeys = new Set(imported.map(customer => customer.account))
    const updated = imported.filter(customer => existingByAccount.has(customer.account)).length
    const merged = imported.map(customer => {
      const previous = existingByAccount.get(customer.account)
      if (!previous) return { ...customer, customerId: createCustomerId() }
      const next = { ...previous, ...customer }
      ;['name', 'type', 'street', 'locality', 'province', 'phone'].forEach(field => {
        if (!customer[field] || customer[field] === '-') next[field] = previous[field] || customer[field] || ''
      })
      next.address = [next.street, next.locality, next.province].filter(Boolean).join(', ') || '-'
      next.fields = { ...(previous.fields || {}), ...(customer.fields || {}) }
      return next
    })
    setCustomers([...customers.filter(customer => !importedKeys.has(normalizeAccountKey(customer.account))), ...merged])
    setNotice(`Importación finalizada: ${imported.length - updated} abonados nuevos y ${updated} actualizados.`)
    close()
  }

  return <div className="modal-layer"><div className="modal"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">IMPORTACIÓN MASIVA</p><h2>Importar abonados</h2><p>Seleccioná el reporte exportado. Las coincidencias por <b>Dealer/Cuenta</b> se actualizarán como abonados PIG.</p><label className="file-drop"><Icon name="upload" size={30} /><b>Seleccioná un archivo .xls</b><small>Formato Maestro de Cuentas</small><input type="file" accept=".xls,.html" onChange={importFile} /></label>{message && <p className="import-error">{message}</p>}<div className="modal-info"><b>Campos importados</b><span>Se conserva toda la información disponible en el reporte.</span></div></div></div>
}
function CustomerServiceHistory({ customer, history, close, technicianView = false }) {
  const records = serviceHistoryForCustomer(history, customer)
  const account = historyAccount(customer) || 'SIN CÓDIGO'
  const customerName = customer.name || customer.clientNameAtService || String(customer.client || '').replace(new RegExp(`^${account}\\s*`, 'i'), '').trim() || 'Cliente'
  return <div className="modal-layer customer-history-layer" role="dialog" aria-modal="true" aria-labelledby="customer-history-title" onMouseDown={close}><div className="modal customer-history-modal" onMouseDown={event => event.stopPropagation()}><button className="close-modal" onClick={close} aria-label="Cerrar historial"><Icon name="close" /></button><p className="eyebrow">{technicianView ? 'CONSULTA TÉCNICA · SOLO LECTURA' : 'HISTORIAL DEL CLIENTE'} · {account}</p><h2 id="customer-history-title">{customerName}</h2><p className="customer-history-summary"><b>{records.length}</b> servicio(s) registrado(s), ordenados del más reciente al más antiguo.</p><div className="customer-history-list">{records.length ? records.map(record => { const recordStatus = record.technicalStatus || record.status || 'Pendiente'; const hasTechnicalReport = Boolean(record.technicalReportedAt || record.technicalStatus || record.technicalObservation); return <article className="customer-history-entry" key={record.id}><header><div><b>{prettyDate(record.date)}{record.time || record.scheduledTime ? ` · ${record.time || record.scheduledTime} Hs` : ''}</b><span>{record.service || 'Servicio sin categoría'}</span></div><em className={`work-status ${String(recordStatus).toLowerCase().replace(/\s/g, '-')}`}>{recordStatus}</em></header><dl><div><dt>Técnicos asignados</dt><dd>{record.technicians?.join(' / ') || 'Sin técnicos asignados'}</dd></div><div><dt>Observación de agenda / administración</dt><dd>{record.detail || 'Sin observaciones cargadas.'}</dd></div>{hasTechnicalReport && <div className="customer-history-technical"><dt>{technicalReporter(record)} indicó{record.technicalStatus ? ` · ${record.technicalStatus}` : ''}</dt><dd>{record.technicalObservation || 'Servicio informado sin observaciones adicionales.'}</dd>{record.technicalReportedAt && <small>{prettyReportDateTime(record.technicalReportedAt)}</small>}</div>}</dl></article> }) : <div className="empty-state">Este cliente todavía no tiene servicios registrados.</div>}</div><div className="modal-actions"><button className="secondary" onClick={close}>Cerrar</button></div></div></div>
}

function CustomerDetail({ customer, close }) { const entries = Object.entries(customer.fields || {}).filter(([, v]) => v); return <div className="modal-layer"><div className="modal detail-modal"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">{customerKindLabel(customer).toUpperCase()} · {customer.account}</p><h2>{customer.name}</h2><div className="detail-grid">{entries.length ? entries.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>) : <><div><b>Dirección</b><span>{customer.address}</span></div><div><b>Teléfono</b><span>{customer.phone}</span></div></>}</div></div></div> }
function Preview({ title, text, close }) { const format = line => line.split(/(\*[^*]+\*)/g).map((part, index) => part.startsWith('*') && part.endsWith('*') ? <strong key={index}>{part.slice(1, -1)}</strong> : part); return <div className="modal-layer"><div className="modal preview-modal"><button className="close-modal" onClick={close}><Icon name="close" /></button><p className="eyebrow">AGENDA TÉCNICA</p><h2>{title}</h2><div className="whatsapp-preview">{text.split('\n').map((line, index) => line ? <p key={index}>{format(line)}</p> : <div className="preview-space" key={index} />)}</div></div></div> }
function Confirm({ title, detail, action, destructive, confirmLabel, close }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await action()
      close()
    } catch (submitError) {
      setError(submitError?.message || 'No se pudo completar la operación. Intentá nuevamente.')
      setSubmitting(false)
    }
  }
  const label = confirmLabel || (destructive ? 'Sí, eliminar' : 'Confirmar cambios')
  return <div className="modal-layer"><div className="modal confirm-modal"><span className={destructive ? 'confirm-icon danger' : 'confirm-icon'}>{destructive ? <Icon name="trash" /> : <Icon name="lock" />}</span><h2>{title}</h2><p>{detail}</p>{error && <div className="notice confirm-error" role="alert">{error}</div>}<div className="confirm-actions"><button className="secondary" disabled={submitting} onClick={close}>Cancelar</button><button className={destructive ? 'danger-button' : 'primary'} disabled={submitting} onClick={submit}>{submitting ? 'Guardando…' : label}</button></div></div></div>
}
