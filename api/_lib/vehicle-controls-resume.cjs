const { vehicleControlsPaused, pausedVehicleControl } = require('./vehicle-controls-pause.cjs')
const { vehicleControlFriday, vehicleControlSchedule } = require('./vehicle-control-schedule.cjs')
const { historyRecordMatchesTask } = require('./history-record-operation.cjs')
const same = (a, b) => String(a || '') === String(b || '')

// Derive schedule repairs after authorization so Flota can resume controls
// without receiving or being allowed to edit unrelated agenda/history data.
function resumeVehicleControls(state, previous = {}, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })) {
  if (!vehicleControlsPaused(previous?.agenda?.weekly) || vehicleControlsPaused(state.agenda?.weekly)) return state
  const next = structuredClone(state)
  const weekly = next.agenda?.weekly || {}
  const oldRecords = new Map((previous.history || []).map(record => [String(record.id), record]))
  const locate = (plan, record) => (plan?.teams || []).flatMap(team => (team.tasks || []).filter(task => historyRecordMatchesTask(task, record)).map(task => ({ team, task })))[0]
  const remove = (plan, record) => {
    for (const team of plan?.teams || []) team.tasks = (team.tasks || []).filter(task => !historyRecordMatchesTask(task, record))
  }
  const insert = (plan, record, source, date) => {
    const removed = plan.removedTaskIds || []
    if (removed.some(value => [String(record.sourceTaskId), `task:${record.sourceTaskId}`, `history:${record.id}`].includes(String(value)))) throw new Error('No se puede reanudar un control omitido en su fecha de destino. Revisá la planificación de Flota.')
    if ((plan.removedTeams || []).some(marker => same(marker.teamId, record.teamId) || String(marker.id || '') === `team:${record.teamId}`)) throw new Error('El equipo del control fue eliminado de la fecha de destino. Revisá la planificación antes de reanudar.')
    plan.teams ||= []
    let team = plan.teams.find(item => same(item.teamId, record.teamId))
    if (!team) {
      const template = weekly._monthlyTeams?.[date.slice(0, 7)]?.teams?.find(item => same(item.teamId, record.teamId)) || source.team
      team = { ...template, tasks: [] }
      plan.teams.push(team)
    }
    const task = { ...source.task, time: record.time, scheduledTime: record.time, estimatedMinutes: 15, vehicleControlScheduledFriday: record.vehicleControlScheduledFriday }
    if (Object.hasOwn(task, 'date')) task.date = date
    if (Object.hasOwn(task, 'scheduledDate')) task.scheduledDate = date
    team.tasks = [...(team.tasks || []), task].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
  }
  for (const record of next.history || []) {
    const old = oldRecords.get(String(record.id))
    if (!old || !pausedVehicleControl(old, previous.agenda?.weekly) || old.startedAt || old.date < today || !pausedVehicleControl(record, { _vehicleControls: { paused: true } })) continue
    const friday = vehicleControlFriday(old)
    const expected = vehicleControlSchedule(friday, weekly, record.teamId)
    if (expected.date < today) continue
    if (expected.date === record.date && expected.time === record.time) continue
    const sourceDate = record.date
    const source = locate(weekly[sourceDate], record) || (next.agenda?.date === sourceDate ? locate(next.agenda, record) : null)
    Object.assign(record, expected, { scheduledTime: expected.time, vehicleControlScheduledFriday: friday })
    if (Object.hasOwn(record, 'scheduledDate')) record.scheduledDate = expected.date
    if (!source) continue // Do not recreate a control removed from the agenda.
    remove(weekly[sourceDate], record)
    if (!weekly[expected.date]) {
      const templates = weekly._monthlyTeams?.[expected.date.slice(0, 7)]?.teams || []
      weekly[expected.date] = { teams: templates.map(team => ({ ...team, tasks: [] })) }
    }
    remove(weekly[expected.date], record)
    insert(weekly[expected.date], record, source, expected.date)
    if (next.agenda.date === sourceDate || next.agenda.date === expected.date) remove(next.agenda, record)
    if (next.agenda.date === expected.date) insert(next.agenda, record, source, expected.date)
  }
  return next
}
module.exports = { resumeVehicleControls }
