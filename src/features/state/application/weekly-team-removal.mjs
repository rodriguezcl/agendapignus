const sameId = (left, right) => String(left || '') === String(right || '')
const hasService = task => Boolean(task?.serviceId || task?.service || task?.customerId || task?.client || task?.vehicleControl || task?.historyId || task?.reservation)
const pendingControl = task => task?.vehicleControl && (!task.status || task.status === 'Pendiente') && !task.technicalStatus && !task.completedAt && !task.startedAt
const operation = (path, before, after) => ({
  path,
  before: before ?? null,
  after: after ?? null,
  existed: before !== undefined,
  exists: after !== undefined
})
const teamPath = (prefix, teamId) => [...prefix, { key: 'teamId', id: String(teamId) }]
const renumberOperations = (teams, removedIndex, prefix) => teams.flatMap((team, index) => {
  if (index === removedIndex || index < removedIndex || !/^Equipo \d+$/.test(team?.label || '')) return []
  const label = `Equipo ${index}`
  return label === team.label ? [] : [operation([...teamPath(prefix, team.teamId), 'label'], team.label, label)]
})

function resolveTeamIndex(teams, teamId, teamIndex) {
  const byId = (teams || []).findIndex(team => teamId && sameId(team.teamId, teamId))
  return byId >= 0 ? byId : teamId ? -1 : Number(teamIndex)
}

// Removing a team is one confirmed command. Weekly planning, the open daily
// projection and pending history records are changed in the same transaction,
// so the debounce cannot report a second, misleading conflict afterwards.
export function weeklyTeamRemovalOperations(snapshot, { day, teamId, teamIndex, fallbackPlan, allowVehicleControlRemoval = false }) {
  let plan = snapshot?.agenda?.weekly?.[day]
  if (!plan) {
    if (!fallbackPlan) throw new Error('El día todavía no está disponible. Recargá la planificación e intentá nuevamente.')
    plan = fallbackPlan
  }
  const storedIndex = resolveTeamIndex(plan.teams || [], teamId, teamIndex)
  const template = teamId && fallbackPlan?.teams?.find(team => sameId(team.teamId, teamId))
  const alreadyRemoved = teamId && (plan.removedTeams || []).some(marker => sameId(marker.teamId, teamId))
  const removedTeam = plan.teams?.[storedIndex] || (!alreadyRemoved && template)
  const resolvedIndex = storedIndex >= 0 ? storedIndex : Number(teamIndex)
  // An exact retry after a response was lost is already complete.
  if (!removedTeam) return []

  const resolvedTeamId = String(removedTeam.teamId || teamId || '').trim()
  const relatedTeams = [removedTeam, template, ...(snapshot.agenda?.date === day ? (snapshot.agenda.teams || []).filter(team => sameId(team.teamId, resolvedTeamId)) : [])].filter(Boolean)
  const taskIds = new Set(relatedTeams.flatMap(team => (team.tasks || []).map(task => String(task.taskId || '')).filter(Boolean)))
  const historyIds = new Set(relatedTeams.flatMap(team => (team.tasks || []).map(task => String(task.historyId || '')).filter(Boolean)))
  const relatedRecords = (snapshot.history || []).filter(record => historyIds.has(String(record.id)) || taskIds.has(String(record.sourceTaskId || '')) || (record.date === day && resolvedTeamId && sameId(record.teamId, resolvedTeamId)))
  const blocksRemoval = task => !(allowVehicleControlRemoval && pendingControl(task))
  if (relatedTeams.some(team => (team.tasks || []).some(task => hasService(task) && blocksRemoval(task))) || relatedRecords.some(blocksRemoval)) {
    throw new Error('No se puede eliminar un equipo con servicios cargados, pendientes o completados. Sólo se pueden eliminar equipos sin servicios.')
  }
  const teamNumber = Number(String(removedTeam.label || '').match(/\d+/)?.[0]) || resolvedIndex + 1
  const marker = {
    id: resolvedTeamId ? `team:${resolvedTeamId}` : `number:${teamNumber}`,
    teamId: resolvedTeamId,
    teamNumber
  }
  const removedTaskIds = [...new Set([
    ...(plan.removedTaskIds || []),
    ...relatedRecords.flatMap(record => [`history:${record.id}`, ...(record.sourceTaskId ? [`task:${record.sourceTaskId}`] : [])]),
    ...(removedTeam.tasks || []).flatMap(task => [
      task.taskId && `task:${task.taskId}`,
      task.historyId && `history:${task.historyId}`
    ].filter(Boolean))
  ])]
  const removedTeams = [...(plan.removedTeams || []).filter(item => item.id !== marker.id), marker]
  const weeklyPrefix = ['agenda', 'weekly', day, 'teams']
  const operations = []
  for (const record of relatedRecords) operations.push(operation(['history', { key: 'id', id: String(record.id) }], record, undefined))

  if (!snapshot?.agenda?.weekly?.[day]) {
    const teams = (plan.teams || []).filter((_, index) => index !== resolvedIndex).map((team, index) => ({
      ...team,
      label: /^Equipo \d+$/.test(team?.label || '') ? `Equipo ${index + 1}` : team?.label
    }))
    operations.push(operation(['agenda', 'weekly', day], undefined, { ...plan, removedTeams, removedTaskIds, teams }))
  } else {
    if (storedIndex >= 0) {
      operations.push(operation(teamPath(weeklyPrefix, removedTeam.teamId), removedTeam, undefined))
      operations.push(...renumberOperations(plan.teams || [], resolvedIndex, weeklyPrefix))
    }
    operations.push(operation(['agenda', 'weekly', day, 'removedTeams'], plan.removedTeams, removedTeams))
    operations.push(operation(['agenda', 'weekly', day, 'removedTaskIds'], plan.removedTaskIds, removedTaskIds))
  }

  if (snapshot?.agenda?.date === day) {
    const dailyTeams = snapshot.agenda.teams || []
    const dailyIndex = resolveTeamIndex(dailyTeams, resolvedTeamId, resolvedIndex)
    const dailyTeam = dailyTeams[dailyIndex]
    if (dailyTeam) {
      const dailyPrefix = ['agenda', 'teams']
      operations.push(operation(teamPath(dailyPrefix, dailyTeam.teamId), dailyTeam, undefined))
      operations.push(...renumberOperations(dailyTeams, dailyIndex, dailyPrefix))
    }
  }
  return operations
}
