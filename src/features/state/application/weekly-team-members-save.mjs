import { stateOperations } from './state-operations.mjs'

const sameId = (left, right) => String(left || '') === String(right || '')

function updateMembership(teams, { teamId, teamIndex, memberIds, members, guardOverride }) {
  let resolvedIndex = (teams || []).findIndex(team => teamId && sameId(team.teamId, teamId))
  // An index is only a legacy fallback, never another team's identity.
  if (resolvedIndex < 0 && (!teamId || !teams?.[teamIndex]?.teamId)) resolvedIndex = teamIndex
  if (!teams?.[resolvedIndex]) return { teams, found: false }
  return {
    found: true,
    teams: teams.map((team, index) => index === resolvedIndex
      ? { ...team, ...(guardOverride === undefined ? {} : { guardOverride }), memberIds: [...memberIds], members: [...members] }
      : team)
  }
}

// Team membership is its own atomic command. It must never rewrite the team's
// services: another user can edit, add or remove a task at the same time.
export function weeklyTeamMemberOperations(snapshot, command) {
  const { day, teamId, teamIndex, baseMemberIds, baseMembers, memberIds, members, guardOverride, fallbackPlan, materializeTeam = false } = command
  const next = structuredClone(snapshot)
  next.agenda ||= {}
  next.agenda.weekly ||= {}

  let plan = next.agenda.weekly[day]
  if (!plan) {
    if (!fallbackPlan) throw new Error('El día todavía no está disponible. Recargá la planificación e intentá nuevamente.')
    plan = structuredClone(fallbackPlan)
  }
  let weeklyResult = updateMembership(plan.teams || [], { teamId, teamIndex, memberIds, members, guardOverride })
  if (!weeklyResult.found && materializeTeam && teamId) {
    // The board also shows monthly teams not yet persisted in this day. Save
    // only the selected visible team, retaining the day's other data and tasks.
    const template = fallbackPlan?.teams?.find(team => sameId(team.teamId, teamId))
    const teamNumber = Number(String(template?.label || '').match(/\d+/)?.[0]) || teamIndex + 1
    const removed = (plan.removedTeams || []).some(marker => marker.teamId
      ? sameId(marker.teamId, teamId) : Number(marker.teamNumber) === teamNumber)
    if (template && !removed) {
      weeklyResult = updateMembership([...(plan.teams || []), structuredClone(template)], { teamId, teamIndex, memberIds, members, guardOverride })
    }
  }
  if (!weeklyResult.found) throw new Error('El equipo cambió o fue eliminado. Recargá la planificación antes de reintentar.')
  next.agenda.weekly[day] = { ...plan, teams: weeklyResult.teams }

  if (next.agenda.date === day) {
    const dailyResult = updateMembership(next.agenda.teams || [], { teamId, teamIndex, memberIds, members, guardOverride })
    if (dailyResult.found) next.agenda.teams = dailyResult.teams
  }

  const operations = stateOperations(snapshot, next)
  for (const operation of operations) {
    const field = operation.path.at(-1)
    const selectedTeam = operation.path.find(item => item?.key === 'teamId')
    if (selectedTeam && sameId(selectedTeam.id, teamId) && field === 'memberIds') operation.before = [...baseMemberIds]
    if (selectedTeam && sameId(selectedTeam.id, teamId) && field === 'members') operation.before = [...baseMembers]
  }
  return operations
}
