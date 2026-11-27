const { isDeepStrictEqual } = require('node:util')

// Only an authorized weekly creation can populate the derived daily cache.
// Read the card from the authorized weekly plan, including its validated crew.
function mirrorWeeklyServiceCreations(state, previous, operations) {
  const date = state.agenda?.date
  if (!date || !Array.isArray(operations)) return state
  const originalTeams = state.agenda.teams || []
  let dailyTeams = originalTeams
  for (const op of operations) {
    if (!op?.mirrorWeeklyTaskId || op.path?.[0] !== 'history' || op.path.length !== 2 ||
        op.path[1]?.key !== 'id' || op.existed !== false || op.exists !== true || op.after?.date !== date) continue
    const recordId = op.path[1].id
    if (previous.history?.some(record => String(record.id) === recordId)) continue
    const record = state.history?.find(item => String(item.id) === recordId)
    if (record?.date !== date || (record.sourceTaskId || record.taskId) !== op.mirrorWeeklyTaskId) continue
    const team = state.agenda.weekly?.[date]?.teams?.find(item => String(item.teamId) === String(record.teamId))
    const task = team?.tasks?.find(item => item.taskId === op.mirrorWeeklyTaskId && String(item.historyId) === recordId)
    if (!task) continue
    const oldTeam = previous.agenda?.weekly?.[date]?.teams?.find(item => String(item.teamId) === String(team.teamId))
    const oldTask = oldTeam?.tasks?.find(item => item.taskId === task.taskId)
    if (isDeepStrictEqual(oldTask, task)) continue
    const destination = dailyTeams.find(item => String(item.teamId) === String(team.teamId))
    const matches = dailyTeams.flatMap(item => (item.tasks || []).filter(card =>
      card.taskId === task.taskId || String(card.historyId) === recordId).map(card => ({ team: item, card })))
    const matchingCard = matches.length === 1 && matches[0].team === destination ? matches[0].card : null
    if (matchingCard && isDeepStrictEqual(matchingCard, task)) continue
    if (matches.length && !(matchingCard && isDeepStrictEqual(matchingCard, oldTask))) {
      throw Object.assign(new Error('La agenda del día ya tiene otra versión de este servicio. Revisá el registro antes de reintentar.'), { statusCode: 409, code: 'RECORD_WRITE_CONFLICT' })
    }
    if (destination) {
      const tasks = [...(destination.tasks || []).filter(card => card !== matchingCard), task].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
      dailyTeams = dailyTeams.map(item => item === destination ? { ...item, tasks } : item)
    } else {
      dailyTeams = [...dailyTeams, { ...team, tasks: [task] }]
    }
  }
  return dailyTeams === originalTeams ? state : { ...state, agenda: { ...state.agenda, teams: dailyTeams } }
}

module.exports = { mirrorWeeklyServiceCreations }
