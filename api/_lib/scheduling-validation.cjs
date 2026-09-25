const normalizedName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const isMonthlyMeeting = (task, serviceMap) => normalizedName(task.service || serviceMap.byId.get(String(task.serviceId))?.name).replace(/\s+/g, ' ') === 'reunion mensual'
const minimumReservation = (task, serviceMap) => task.vehicleControl || isMonthlyMeeting(task, serviceMap) ? 15 : 60
const allowedMeetingControlOverlap = (first, second, serviceMap) => (isMonthlyMeeting(first, serviceMap) && second.vehicleControl) || (first.vehicleControl && isMonthlyMeeting(second, serviceMap))

const argentinaToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
const nextArgentinaQuarterMinute = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const elapsed = Number(parts.hour) * 60 + Number(parts.minute) + (Number(parts.second) > 0 ? 1 : 0)
  return Math.ceil(elapsed / 15) * 15
}

const historyRecordForAgendaTask = (task, date, history = []) => {
  const taskHistoryIds = [task?.historyId, task?.sourceHistoryId].filter(Boolean).map(String)
  const taskSourceIds = [task?.taskId, task?.sourceTaskId].filter(Boolean).map(String)
  const directMatch = (history || []).find(record => (
    taskHistoryIds.includes(String(record?.id || '')) ||
    [record?.taskId, record?.sourceTaskId].filter(Boolean).map(String).some(id => taskSourceIds.includes(id))
  ))
  if (directMatch) return directMatch
  const customer = normalizedName(task?.customerId || task?.clientAccount || task?.account || task?.client)
  const service = normalizedName(task?.serviceId || task?.service)
  const time = normalizedName(task?.time || task?.scheduledTime)
  if (!customer || !service || !time) return null
  return (history || []).find(record => (
    String(record?.date || '') === String(date || '') &&
    normalizedName(record?.customerId || record?.clientAccount || record?.account || record?.client) === customer &&
    normalizedName(record?.serviceId || record?.service) === service &&
    normalizedName(record?.time || record?.scheduledTime) === time
  )) || null
}

const agendaTaskIsResolvedForPlanning = (task, date, history = [], today = argentinaToday()) => {
  const resolvedStatus = record => ['Completado', 'Avance registrado'].includes(record?.status) || ['Completado', 'Avance registrado'].includes(record?.technicalStatus) || (String(record?.date || date || '') < String(today || '') && (record?.status === 'Cancelado' || record?.technicalStatus === 'Cancelado'))
  if (resolvedStatus(task)) return true
  const resolved = (history || []).filter(resolvedStatus)
  const taskHistoryIds = [task?.historyId, task?.sourceHistoryId].filter(Boolean).map(String)
  const taskSourceIds = [task?.taskId, task?.sourceTaskId].filter(Boolean).map(String)
  const directMatch = resolved.some(record => (
    taskHistoryIds.includes(String(record?.id || '')) ||
    [record?.taskId, record?.sourceTaskId].filter(Boolean).map(String).some(id => taskSourceIds.includes(id))
  ))
  if (directMatch) return true
  const customer = normalizedName(task?.customerId || task?.clientAccount || task?.account || task?.client)
  const service = normalizedName(task?.serviceId || task?.service)
  const time = normalizedName(task?.time || task?.scheduledTime)
  if (!customer || !service || !time) return false
  return resolved.some(record => (
    String(record?.date || '') === String(date || '') &&
    normalizedName(record?.customerId || record?.clientAccount || record?.account || record?.client) === customer &&
    normalizedName(record?.serviceId || record?.service) === service &&
    normalizedName(record?.time || record?.scheduledTime) === time
  ))
}

const agendaTaskForScheduleOccupancy = (task, date, history = [], today = argentinaToday()) => {
  const record = historyRecordForAgendaTask(task, date, history)
  const status = record?.status || record?.technicalStatus || task?.status || task?.technicalStatus || 'Pendiente'
  // Administrative review preserves the report, not the technician's slot.
  if (!(record?.vehicleControl || task?.vehicleControl) && (record || task).technicalStatus === 'Cancelado') return null
  if (['Completado', 'Avance registrado'].includes(status) && String(date || '') !== String(today || '')) return null
  if (status === 'Cancelado' && String(date || '') < String(today || '')) return null
  return { ...task, date, status, technicalStatus: record?.technicalStatus || task?.technicalStatus || '', completedAt: record?.completedAt || task?.completedAt || '', technicalReportedAt: record?.journeyClosedAt || record?.technicalReportedAt || task?.technicalReportedAt || '' }
}

const completedReleaseMinute = task => {
  if (!['Completado', 'Avance registrado'].includes(task?.status) && !['Completado', 'Avance registrado'].includes(task?.technicalStatus)) return null
  const value = task?.completedAt || task?.journeyClosedAt || task?.technicalReportedAt
  const instant = new Date(value)
  if (!value || Number.isNaN(instant.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  if (`${parts.year}-${parts.month}-${parts.day}` !== String(task.date || '')) return null
  const startParts = String(task.time || task.scheduledTime || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!startParts) return null
  const start = Number(startParts[1]) * 60 + Number(startParts[2])
  const completed = Number(parts.hour) * 60 + Number(parts.minute)
  if (completed < start) return null
  const elapsed = completed + (Number(parts.second) > 0 ? 1 : 0)
  return Math.ceil(elapsed / 15) * 15
}

const serviceMapFor = services => ({
  byId: new Map((services || []).map(service => [String(service.id), service])),
  byName: new Map((services || []).map(service => [normalizedName(service.name), service]))
})

const estimatedMinutesFor = (task, serviceMap) => {
  const service = serviceMap.byId.get(String(task?.serviceId ?? '')) || serviceMap.byName.get(normalizedName(task?.service))
  const value = task?.estimatedMinutes == null ? service?.estimatedMinutes : task.estimatedMinutes
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 720 ? minutes : 60
}

const rawEstimatedMinutesFor = (task, serviceMap) => {
  const service = serviceMap.byId.get(String(task?.serviceId ?? '')) || serviceMap.byName.get(normalizedName(task?.service))
  return task?.estimatedMinutes == null ? service?.estimatedMinutes : task.estimatedMinutes
}

const scheduleSignature = (teams, serviceMap, date, history) => JSON.stringify((teams || []).map(team => ({
  teamId: String(team.teamId || ''),
  memberIds: team.memberIds || [], members: team.members || [],
  tasks: (team.tasks || []).map((task, taskIndex) => ({ task: agendaTaskForScheduleOccupancy(task, date, history), taskIndex })).filter(({ task }) => task && (task.serviceId || task.service)).map(({ task, taskIndex }) => ({
    id: String(task.taskId || task.historyId || task.id || taskIndex), time: String(task.time || task.scheduledTime || ''),
    serviceId: String(task.serviceId || task.service || ''), estimatedMinutes: String(rawEstimatedMinutesFor(task, serviceMap) ?? ''),
    status: String(task.status || task.technicalStatus || ''), completedAt: String(task.completedAt || task.technicalReportedAt || ''), technicianIds: task.technicianIds || [], technicians: task.technicians || []
  }))
})))

const agendaPlans = agenda => {
  const plans = new Map()
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(agenda?.date || ''))) plans.set(`daily:${agenda.date}`, { date: agenda.date, scope: 'Agenda del día', teams: agenda?.teams || [] })
  Object.entries(agenda?.weekly || {}).forEach(([date, plan]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) plans.set(`weekly:${date}`, { date, scope: 'Agenda semanal', teams: plan?.teams || [] })
  })
  return plans
}

const longDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value || 'una fecha sin identificar')
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}

const humanList = values => values.length < 2 ? values[0] || '' : `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`

const teamDescription = (team, teamIndex) => {
  const members = (team?.members || []).map(name => String(name || '').trim()).filter(Boolean)
  return members.length ? `El equipo conformado por ${humanList(members)}` : `El ${String(team?.label || '').trim() || `Equipo ${teamIndex + 1}`}`
}

const taskDescription = (task, taskIndex) => {
  const details = [task?.service, task?.client || task?.clientAccount].map(value => String(value || '').trim()).filter(Boolean)
  return `Servicio ${taskIndex + 1}${details.length ? ` (${details.join(' · ')})` : ''}`
}

const taskIdentifiers = task => [task?.taskId, task?.historyId, task?.sourceTaskId, task?.sourceHistoryId].filter(Boolean).map(String)

const sameTaskIdentity = (left, right) => {
  const leftIds = taskIdentifiers(left)
  const rightIds = new Set(taskIdentifiers(right))
  if (leftIds.length && leftIds.some(id => rightIds.has(id))) return true
  const leftCustomer = normalizedName(left?.customerId || left?.clientAccount || left?.account || left?.client)
  const rightCustomer = normalizedName(right?.customerId || right?.clientAccount || right?.account || right?.client)
  const leftService = normalizedName(left?.serviceId || left?.service)
  const rightService = normalizedName(right?.serviceId || right?.service)
  return Boolean(leftCustomer && leftService && leftCustomer === rightCustomer && leftService === rightService)
}

const agendaTaskWasAlreadyScheduled = (task, date, previousPlan, previousHistory = []) => {
  const time = normalizedName(task?.time || task?.scheduledTime)
  if (!time) return false
  const previousTask = (previousPlan?.teams || []).flatMap(team => team?.tasks || []).find(candidate => (
    sameTaskIdentity(task, candidate) && normalizedName(candidate?.time || candidate?.scheduledTime) === time
  ))
  if (previousTask) return true
  const record = historyRecordForAgendaTask(task, date, previousHistory)
  return Boolean(record && String(record.date || '') === String(date || '') && normalizedName(record.time || record.scheduledTime) === time)
}

function validateChangedAgendaSchedules(state, previousState = null) {
  const serviceMap = serviceMapFor(state?.services)
  const nextPlans = agendaPlans(state?.agenda)
  const previousPlans = agendaPlans(previousState?.agenda)
  nextPlans.forEach((plan, key) => {
    const previous = previousPlans.get(key)
    // Removing unchanged scheduled tasks cannot introduce a new overlap.
    // Compare a multiset so duplicate tasks cannot hide an added occurrence.
    if (previous) {
      const before = JSON.parse(scheduleSignature(previous.teams, serviceMapFor(previousState?.services), previous.date, previousState?.history))
      const after = JSON.parse(scheduleSignature(plan.teams, serviceMap, plan.date, state?.history))
      const rows = teams => teams.flatMap(({ tasks, ...team }) => tasks.map(task => JSON.stringify({ team, task })))
      const remaining = rows(before)
      const nextRows = rows(after)
      if (nextRows.length < remaining.length && nextRows.every(row => {
        const index = remaining.indexOf(row)
        if (index < 0) return false
        remaining.splice(index, 1)
        return true
      })) return
    }
    const previousServiceMap = serviceMapFor(previousState?.services)
    const changedTeams = new Set((plan.teams || []).flatMap((team, index) => {
      const oldTeam = team.teamId
        ? previous?.teams?.find(item => String(item.teamId) === String(team.teamId))
        : previous?.teams?.[index]
      const unchanged = oldTeam && scheduleSignature([oldTeam], previousServiceMap, plan.date, previousState?.history) === scheduleSignature([team], serviceMap, plan.date, state?.history)
      return unchanged ? [] : [index]
    }))
    if (!changedTeams.size) return
    ;(plan.teams || []).forEach((team, teamIndex) => {
      if (!changedTeams.has(teamIndex)) return
      const activeTasks = (team.tasks || []).map((task, taskIndex) => ({ task, taskIndex })).filter(({ task }) => (task.serviceId || task.service) && !agendaTaskIsResolvedForPlanning(task, plan.date, state?.history))
      const occupancyTasks = (team.tasks || []).map((task, taskIndex) => ({ task: agendaTaskForScheduleOccupancy(task, plan.date, state?.history), taskIndex })).filter(({ task }) => task && (task.serviceId || task.service))
      activeTasks.forEach(({ task, taskIndex }) => {
        const estimatedMinutes = Number(rawEstimatedMinutesFor(task, serviceMap))
        if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 15 || estimatedMinutes > 720) {
          throw new Error(`${teamDescription(team, teamIndex)} del ${longDate(plan.date)} tiene un tiempo estimado inválido en el ${taskDescription(task, taskIndex)}. Configurá una duración de entre 15 minutos y 12 horas.`)
        }
        const startMatch = String(task.time || '').match(/^(\d{1,2}):(\d{2})$/)
        const start = startMatch ? Number(startMatch[1]) * 60 + Number(startMatch[2]) : null
        if (plan.date === argentinaToday() && start !== null && !agendaTaskWasAlreadyScheduled(task, plan.date, previous, previousState?.history) && start < nextArgentinaQuarterMinute()) {
          throw new Error(`${teamDescription(team, teamIndex)} del ${longDate(plan.date)} no puede agregar el ${taskDescription(task, taskIndex)} a las ${task.time} porque ese horario ya pasó. Elegí un horario futuro desde el próximo cuarto de hora disponible.`)
        }
      })
      const scheduled = occupancyTasks.filter(({ task }) => /^\d{1,2}:\d{2}$/.test(String(task.time || ''))).map(({ task, taskIndex }) => {
        const [hours, minutes] = task.time.split(':').map(Number)
        const start = hours * 60 + minutes
        const actualRelease = completedReleaseMinute(task)
        const plannedEnd = start + Math.max(minimumReservation(task, serviceMap), estimatedMinutesFor(task, serviceMap))
        return { task, taskIndex, start, end: actualRelease == null ? plannedEnd : Math.min(actualRelease, plannedEnd) }
      }).sort((first, second) => first.start - second.start)
      scheduled.forEach((current, index) => {
        const conflict = scheduled.slice(0, index).find(previousTask => current.start < previousTask.end && !allowedMeetingControlOverlap(current.task, previousTask.task, serviceMap))
        if (!conflict) return
        throw new Error(`${teamDescription(team, teamIndex)} del ${longDate(plan.date)} tiene un conflicto de horarios entre el ${taskDescription(conflict.task, conflict.taskIndex)} a las ${conflict.task.time} y el ${taskDescription(current.task, current.taskIndex)} a las ${current.task.time}. Ajustá el horario o el tiempo estimado de uno de los servicios.`)
      })
    })
    // La disponibilidad pertenece al técnico, no al equipo. Un mismo integrante
    // no puede quedar oculto en dos equipos con franjas superpuestas.
    const assignmentsByTechnician = new Map()
    ;(plan.teams || []).forEach((team, teamIndex) => {
      ;(team.tasks || []).forEach((candidate, taskIndex) => {
        const task = agendaTaskForScheduleOccupancy(candidate, plan.date, state?.history)
        const match = String(task?.time || task?.scheduledTime || '').match(/^(\d{1,2}):(\d{2})$/)
        if (!task || !(task.serviceId || task.service) || !match) return
        const start = Number(match[1]) * 60 + Number(match[2])
        const actualRelease = completedReleaseMinute(task)
        const plannedEnd = start + Math.max(minimumReservation(task, serviceMap), estimatedMinutesFor(task, serviceMap))
        const end = actualRelease == null ? plannedEnd : Math.min(actualRelease, plannedEnd)
        const technicianIds = task.vehicleControl && task.technicianIds?.length ? task.technicianIds : team.memberIds || []
        const technicianNames = task.vehicleControl && task.technicians?.length ? task.technicians : team.members || []
        const identities = [
          ...technicianIds.map((id, index) => ({ key: `id:${String(id)}`, name: technicianNames[index] || String(id) })),
          ...technicianNames.map(name => ({ key: `name:${normalizedName(name)}`, name }))
        ].filter(identity => identity.key !== 'name:')
        const entry = { task, taskIndex, team, teamIndex, start, end }
        ;[...new Map(identities.map(identity => [identity.key, identity])).values()].forEach(identity => {
          assignmentsByTechnician.set(identity.key, { name: identity.name, entries: [...(assignmentsByTechnician.get(identity.key)?.entries || []), entry] })
        })
      })
    })
    assignmentsByTechnician.forEach(({ name, entries }) => {
      const ordered = entries.sort((left, right) => left.start - right.start)
      ordered.forEach((current, index) => {
        const conflict = ordered.slice(0, index).find(previousAssignment =>
          previousAssignment.teamIndex !== current.teamIndex &&
          (changedTeams.has(current.teamIndex) || changedTeams.has(previousAssignment.teamIndex)) &&
          current.start < previousAssignment.end && !allowedMeetingControlOverlap(current.task, previousAssignment.task, serviceMap))
        if (!conflict || conflict.teamIndex === current.teamIndex) return
        throw new Error(`${name || 'El técnico'} tiene servicios incompatibles el ${longDate(plan.date)}: ${taskDescription(conflict.task, conflict.taskIndex)} en ${conflict.team.label || `Equipo ${conflict.teamIndex + 1}`} y ${taskDescription(current.task, current.taskIndex)} en ${current.team.label || `Equipo ${current.teamIndex + 1}`}. Reasigná el técnico o ajustá los horarios.`)
      })
    })
  })
}

module.exports = { agendaTaskForScheduleOccupancy, agendaTaskIsResolvedForPlanning, agendaTaskWasAlreadyScheduled, completedReleaseMinute, validateChangedAgendaSchedules }
