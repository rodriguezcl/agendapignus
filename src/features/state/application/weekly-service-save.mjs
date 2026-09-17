import { stateOperations } from './state-operations.mjs'

export const vehicleControlSwapCandidate = (task, destination, sourceDay, destinationDay) => {
  if (!task?.vehicleControl || sourceDay !== destinationDay) return null
  const candidates = (destination?.tasks || []).filter(item => item.vehicleControl && item.time === task.time && item.taskId !== task.taskId)
  if (candidates.length > 1) throw new Error('Hay más de un control vehicular en ese horario. Revisá el equipo de destino antes de intercambiar.')
  return candidates[0] || null
}

// A move has no service form draft to save. Compare each persisted projection
// against its own server version, never against the reconciled display card.
export function weeklyServiceMoveOperations(snapshot, command) {
  const destination = snapshot.agenda?.weekly?.[command.day]?.teams?.find(team => String(team.teamId) === String(command.team.teamId))
  const swap = vehicleControlSwapCandidate(command.task, destination, command.sourceDay, command.day)
  if (String(swap?.taskId || '') !== String(command.swapTaskId || '')) throw new Error('El control del equipo de destino cambió. Volvé a abrir la reasignación para revisar el intercambio.')
  const operations = singleServiceMoveOperations(snapshot, command)
  if (!swap) return operations
  const source = snapshot.agenda.weekly[command.sourceDay].teams.find(team => String(team.teamId) === String(command.sourceTeamId))
  const record = snapshot.history.find(item => String(item.id) === String(swap.historyId) || String(item.sourceTaskId || '') === String(swap.taskId))
  const resolved = item => !item || item.technicalStatus || ['Completado', 'Cancelado', 'Reprogramado'].includes(item.status)
  const originalRecord = snapshot.history.find(item => String(item.id) === String(command.record.id))
  if (resolved(record) || resolved(originalRecord)) throw new Error('Solo se pueden intercambiar controles vehiculares pendientes.')
  return [...operations, ...singleServiceMoveOperations(snapshot, {
    day: command.sourceDay, sourceDay: command.day, sourceTeamId: destination.teamId,
    team: source, task: { ...swap },
    record: { ...record, teamId: source.teamId, team: source.label },
  })]
}

function singleServiceMoveOperations(snapshot, command) {
  const matches = item => (command.task.taskId && String(item.taskId || '') === String(command.task.taskId)) ||
    (command.task.historyId && String(item.historyId || '') === String(command.task.historyId))
  const sourceTeams = snapshot.agenda?.weekly?.[command.sourceDay]?.teams || []
  const source = sourceTeams.find(team => String(team.teamId) === String(command.sourceTeamId))
  const baseTask = source?.tasks?.find(matches)
  const baseRecord = snapshot.history?.find(record => String(record.id) === String(command.record.id))
  if (!baseTask || !baseRecord) throw new Error('No se encontró la versión guardada del servicio. Actualizá la agenda antes de reasignar.')
  const record = { ...command.record }
  const task = { ...command.task }
  if (baseRecord.vehicleControl) {
    const ids = command.team.memberIds || []
    const selected = ids.find(id => String(id) === String(baseRecord.technicianIds?.[0])) || (ids.length === 1 ? ids[0] : null)
    const position = ids.findIndex(id => String(id) === String(selected))
    const name = command.team.members?.[position]
    if (selected == null || !name) throw new Error('El control vehicular necesita un responsable único en el equipo de destino.')
    record.technicianIds = task.technicianIds = [selected]
    record.technicians = task.technicians = [name]
  }
  const operations = weeklyServiceOperations(snapshot, { ...command, task, record, baseTask, baseRecord })
  const destination = snapshot.agenda?.weekly?.[command.day]?.teams?.find(team => String(team.teamId) === String(command.team.teamId))
  if (destination) {
    // Membership is part of the user's choice of responsible technician.
    // These no-op checks reject a concurrent change without overwriting it.
    for (const key of ['memberIds', 'members']) {
      const existed = Object.hasOwn(destination, key)
      operations.unshift({ path: ['agenda', 'weekly', command.day, 'teams', { key: 'teamId', id: String(destination.teamId) }, key], before: destination[key] ?? null, after: destination[key] ?? null, existed, exists: existed })
    }
  }
  return operations
}

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
