const normalizedName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

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

const scheduleSignature = (teams, serviceMap) => JSON.stringify((teams || []).map(team => ({
  teamId: String(team.teamId || ''),
  tasks: (team.tasks || []).filter(task => task.serviceId || task.service).map((task, taskIndex) => ({
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
    if (previous && scheduleSignature(previous.teams, serviceMap) === scheduleSignature(plan.teams, serviceMap)) return
    ;(plan.teams || []).forEach((team, teamIndex) => {
      const scheduled = (team.tasks || []).filter(task => (task.serviceId || task.service) && /^\d{1,2}:\d{2}$/.test(String(task.time || ''))).map(task => {
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

module.exports = { validateChangedAgendaSchedules }
