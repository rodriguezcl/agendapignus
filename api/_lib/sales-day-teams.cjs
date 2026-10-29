// Materialize the monthly identities, retaining day-specific membership and
// explicit removals. Empty display placeholders never reserve time here.
function salesDayTeams(defaults, plan) {
  const number = t => Number(String(t.label || '').match(/\d+/)?.[0]) || 0
  const teams = defaults.map(t => ({ ...t, tasks: [] }))
  for (const [index, stored] of (plan.teams || []).entries()) {
    const at = stored.teamId ? teams.findIndex(t => String(t.teamId) === String(stored.teamId)) : number(stored) ? teams.findIndex(t => number(t) === number(stored)) : index < teams.length ? index : -1
    if (at < 0) teams.push({ ...stored, tasks: stored.tasks || [] })
    else teams[at] = { ...teams[at], ...stored, teamId: teams[at].teamId || stored.teamId, label: teams[at].label || stored.label, tasks: stored.tasks || [] }
  }
  const removedTasks = new Set(plan.removedTaskIds || [])
  return teams.filter((t, index) => !(plan.removedTeams || []).some(marker => marker.teamId ? String(marker.teamId) === String(t.teamId) : Number(marker.teamNumber) === (number(t) || index + 1))).map(t => ({ ...t, tasks: t.tasks.filter(task => !removedTasks.has(`task:${task.taskId}`) && !removedTasks.has(`history:${task.historyId}`)) }))
}
module.exports = { salesDayTeams }
