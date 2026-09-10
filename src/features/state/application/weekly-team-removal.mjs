import { stateOperations } from './state-operations.mjs'

const sameId = (left, right) => String(left || '') === String(right || '')
const closedRecord = record => ['Completado', 'Cancelado', 'Reprogramado'].includes(record?.status) || Boolean(record?.technicalStatus)
const renumberTeams = teams => teams.map((team, index) => ({
  ...team,
  label: /^Equipo \d+$/.test(team?.label || '') ? `Equipo ${index + 1}` : team?.label
}))

function resolveTeamIndex(teams, teamId, teamIndex) {
  const byId = (teams || []).findIndex(team => teamId && sameId(team.teamId, teamId))
  return byId >= 0 ? byId : Number(teamIndex)
}

// Removing a team is one confirmed command. Weekly planning, the open daily
// projection and pending history records are changed in the same transaction,
// so the debounce cannot report a second, misleading conflict afterwards.
export function weeklyTeamRemovalOperations(snapshot, { day, teamId, teamIndex, fallbackPlan }) {
  const next = structuredClone(snapshot)
  next.agenda ||= {}
  next.agenda.weekly ||= {}
  let plan = next.agenda.weekly[day]
  if (!plan) {
    if (!fallbackPlan) throw new Error('El día todavía no está disponible. Recargá la planificación e intentá nuevamente.')
    plan = structuredClone(fallbackPlan)
  }
  const resolvedIndex = resolveTeamIndex(plan.teams || [], teamId, teamIndex)
  const removedTeam = plan.teams?.[resolvedIndex]
  // An exact retry after a response was lost is already complete.
  if (!removedTeam) return []

  const resolvedTeamId = String(removedTeam.teamId || teamId || '').trim()
  const teamNumber = Number(String(removedTeam.label || '').match(/\d+/)?.[0]) || resolvedIndex + 1
  const marker = {
    id: resolvedTeamId ? `team:${resolvedTeamId}` : `number:${teamNumber}`,
    teamId: resolvedTeamId,
    teamNumber
  }
  const removedTaskIds = [...new Set([
    ...(plan.removedTaskIds || []),
    ...(removedTeam.tasks || []).flatMap(task => [
      task.taskId && `task:${task.taskId}`,
      task.historyId && `history:${task.historyId}`
    ].filter(Boolean))
  ])]
  next.agenda.weekly[day] = {
    ...plan,
    removedTeams: [...(plan.removedTeams || []).filter(item => item.id !== marker.id), marker],
    removedTaskIds,
    teams: renumberTeams((plan.teams || []).filter((_, index) => index !== resolvedIndex))
  }

  const taskIds = new Set((removedTeam.tasks || []).map(task => String(task.taskId || '')).filter(Boolean))
  const historyIds = new Set((removedTeam.tasks || []).map(task => String(task.historyId || '')).filter(Boolean))
  next.history = (next.history || []).filter(record => closedRecord(record) || !(
    historyIds.has(String(record.id || '')) || taskIds.has(String(record.sourceTaskId || ''))
  ))

  if (next.agenda.date === day) {
    const dailyIndex = resolveTeamIndex(next.agenda.teams || [], resolvedTeamId, resolvedIndex)
    if (next.agenda.teams?.[dailyIndex]) next.agenda.teams = renumberTeams(next.agenda.teams.filter((_, index) => index !== dailyIndex))
  }
  return stateOperations(snapshot, next)
}
