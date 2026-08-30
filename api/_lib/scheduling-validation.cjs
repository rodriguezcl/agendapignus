const normalizedName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

const argentinaToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })

const agendaTaskIsResolvedForPlanning = (task, date, history = [], today = argentinaToday()) => {
  const resolvedStatus = record => record?.status === 'Completado' || record?.technicalStatus === 'Completado' || (String(record?.date || date || '') < String(today || '') && (record?.status === 'Cancelado' || record?.technicalStatus === 'Cancelado'))
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
  tasks: (team.tasks || []).filter(task => (task.serviceId || task.service) && !agendaTaskIsResolvedForPlanning(task, date, history)).map((task, taskIndex) => ({
    id: String(task.taskId || task.historyId || task.id || taskIndex),
    time: String(task.time || task.scheduledTime || ''),
    serviceId: String(task.serviceId || task.service || ''),
    estimatedMinutes: String(rawEstimatedMinutesFor(task, serviceMap) ?? '')
  }))
})))

const agendaPlans = agenda => {
  const plans = new Map()
  if (agenda?.date || agenda?.teams?.length) plans.set(`daily:${agenda?.date || ''}`, { date: agenda?.date || '', scope: 'Agenda del día', teams: agenda?.teams || [] })
  Object.entries(agenda?.weekly || {}).forEach(([date, plan]) => {
    if (!date.startsWith('_')) plans.set(`weekly:${date}`, { date, scope: 'Agenda semanal', teams: plan?.teams || [] })
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

function validateChangedAgendaSchedules(state, previousState = null) {
  const serviceMap = serviceMapFor(state?.services)
  const nextPlans = agendaPlans(state?.agenda)
  const previousPlans = agendaPlans(previousState?.agenda)
  nextPlans.forEach((plan, key) => {
    const previous = previousPlans.get(key)
    if (previous && scheduleSignature(previous.teams, serviceMap, previous.date, previousState?.history) === scheduleSignature(plan.teams, serviceMap, plan.date, state?.history)) return
    ;(plan.teams || []).forEach((team, teamIndex) => {
      const activeTasks = (team.tasks || []).map((task, taskIndex) => ({ task, taskIndex })).filter(({ task }) => (task.serviceId || task.service) && !agendaTaskIsResolvedForPlanning(task, plan.date, state?.history))
      activeTasks.forEach(({ task, taskIndex }) => {
        const estimatedMinutes = Number(rawEstimatedMinutesFor(task, serviceMap))
        if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 15 || estimatedMinutes > 720) {
          throw new Error(`${teamDescription(team, teamIndex)} del ${longDate(plan.date)} tiene un tiempo estimado inválido en el ${taskDescription(task, taskIndex)}. Configurá una duración de entre 15 minutos y 12 horas.`)
        }
      })
      const scheduled = activeTasks.filter(({ task }) => /^\d{1,2}:\d{2}$/.test(String(task.time || ''))).map(({ task, taskIndex }) => {
        const [hours, minutes] = task.time.split(':').map(Number)
        const start = hours * 60 + minutes
        return { task, taskIndex, start, end: start + Math.max(60, estimatedMinutesFor(task, serviceMap)) }
      }).sort((first, second) => first.start - second.start)
      scheduled.forEach((current, index) => {
        const conflict = scheduled.slice(0, index).find(previousTask => current.start < previousTask.end)
        if (!conflict) return
        throw new Error(`${teamDescription(team, teamIndex)} del ${longDate(plan.date)} tiene un conflicto de horarios entre el ${taskDescription(conflict.task, conflict.taskIndex)} a las ${conflict.task.time} y el ${taskDescription(current.task, current.taskIndex)} a las ${current.task.time}. Ajustá el horario o el tiempo estimado de uno de los servicios.`)
      })
    })
  })
}

module.exports = { agendaTaskIsResolvedForPlanning, validateChangedAgendaSchedules }
