import { stateOperations } from './state-operations.mjs'

// One logical command: create/update the history record and both projections.
// The modal's original record is kept as the compare-and-swap baseline.
export function weeklyServiceOperations(snapshot, { day, team, task, record, baseRecord, baseTask, customer, sourceDay = '', sourceTeamId = '' }) {
  const next = structuredClone(snapshot)
  next.history ||= []
  const index = next.history.findIndex(item => String(item.id) === String(record.id))
  if (index < 0) next.history.push(record)
  else next.history[index] = record
  if (customer && !next.customers.some(item => item.customerId === customer.customerId)) next.customers.push(customer)
  const updateTeams = teams => {
    const found = teams.find(item => String(item.teamId) === String(team.teamId))
    if (!found) return [...teams, { ...team, tasks: [task] }]
    const exists = found.tasks?.some(item => String(item.taskId) === String(task.taskId))
    found.tasks = exists ? found.tasks.map(item => String(item.taskId) === String(task.taskId) ? task : item) : [...(found.tasks || []), task]
    found.tasks.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
    return teams
  }
  const matchesMovedTask = item => Boolean(sourceDay) && (
    (task.taskId && String(item.taskId || '') === String(task.taskId)) ||
    (task.historyId && String(item.historyId || '') === String(task.historyId))
  )
  const removeFromTeams = teams => (teams || []).map(item => ({
    ...item,
    tasks: (item.tasks || []).filter(candidate => {
      if (!matchesMovedTask(candidate)) return true
      return sourceTeamId && String(item.teamId || '') !== String(sourceTeamId)
    })
  }))
  next.agenda ||= {}
  next.agenda.weekly ||= {}
  if (sourceDay) {
    const sourcePlan = next.agenda.weekly[sourceDay] || {}
    next.agenda.weekly[sourceDay] = { ...sourcePlan, teams: removeFromTeams(sourcePlan.teams || []) }
    if (next.agenda.date === sourceDay) next.agenda.teams = removeFromTeams(next.agenda.teams || [])
  }
  const plan = next.agenda.weekly[day] || {}
  next.agenda.weekly[day] = { ...plan, teams: updateTeams(plan.teams || []) }
  if (next.agenda.date === day) next.agenda.teams = updateTeams(next.agenda.teams || [])
  const operations = stateOperations(snapshot, next)
  // Always check the record, including a retry whose local view already matches.
  const historyPath = ['history', { key: 'id', id: String(record.id) }]
  const filtered = operations.filter(operation => operation.path[0] !== 'history')
  filtered.push({ path: historyPath, before: baseRecord || null, after: record, existed: Boolean(baseRecord), exists: true })
  for (const operation of filtered) {
    if (operation.path[1] === 'weekly' && operation.path.at(-1)?.key === 'taskId' && operation.path.at(-1).id === String(task.taskId) && baseTask && operation.existed) {
      operation.before = baseTask
      operation.existed = true
    }
  }
  return filtered
}
