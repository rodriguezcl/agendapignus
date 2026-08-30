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

const scheduleSignature = (teams, serviceMap, date, history) => JSON.stringify((teams || []).map(team => ({
  teamId: String(team.teamId || ''),
  tasks: (team.tasks || []).filter(task => (task.serviceId || task.service) && !agendaTaskIsResolvedForPlanning(task, date, history)).map((task, taskIndex) => ({
    id: String(task.taskId || task.historyId || task.id || taskIndex),
    time: String(task.time || task.scheduledTime || ''),
    serviceId: String(task.serviceId || task.service || ''),
    estimatedMinutes: estimatedMinutesFor(task, serviceMap)
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

const prettyDate = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || 'sin fecha'
}

function validateChangedAgendaSchedules(state, previousState = null) {
  const serviceMap = serviceMapFor(state?.services)
  const nextPlans = agendaPlans(state?.agenda)
  const previousPlans = agendaPlans(previousState?.agenda)
  nextPlans.forEach((plan, key) => {
    const previous = previousPlans.get(key)
    if (previous && scheduleSignature(previous.teams, serviceMap, previous.date, previousState?.history) === scheduleSignature(plan.teams, serviceMap, plan.date, state?.history)) return
    ;(plan.teams || []).forEach((team, teamIndex) => {
      const scheduled = (team.tasks || []).filter(task => (task.serviceId || task.service) && !agendaTaskIsResolvedForPlanning(task, plan.date, state?.history) && /^\d{1,2}:\d{2}$/.test(String(task.time || ''))).map(task => {
        const [hours, minutes] = task.time.split(':').map(Number)
        const start = hours * 60 + minutes
        return { task, start, end: start + Math.max(60, estimatedMinutesFor(task, serviceMap)) }
      }).sort((first, second) => first.start - second.start)
      scheduled.forEach((current, index) => {
        const conflict = scheduled.slice(0, index).find(previousTask => current.start < previousTask.end)
        if (!conflict) return
        const teamLabel = String(team.label || '').trim() || `Equipo ${teamIndex + 1}`
        throw new Error(`${plan.scope} ${prettyDate(plan.date)}, ${teamLabel}: las franjas de ${conflict.task.time} y ${current.task.time} se superponen.`)
      })
    })
  })
}

module.exports = { agendaTaskIsResolvedForPlanning, validateChangedAgendaSchedules }
