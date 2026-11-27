const { vehicleControlsPaused, pausedVehicleControl } = require('./vehicle-controls-pause.cjs')
const { vehicleControlFriday, vehicleControlSchedule } = require('./vehicle-control-schedule.cjs')
const { vehicleControlScheduledAt } = require('./vehicle-control-window.cjs')
const same = (a, b) => String(a || '') === String(b || '')
const pauseReason = 'Control omitido por la pausa de Flota.'
const reportFields = ['startedAt', 'startedById', 'startedByName', 'technicalStatus', 'technicalObservation', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'completedAt', 'vehicleControlReportedAt', 'vehicleMileage', 'vehiclePhotoUrl', 'workCompletion']

function preserveInspection(record, task) {
  for (const field of reportFields) {
    if ((record[field] == null || record[field] === '') && task[field] != null) record[field] = task[field]
  }
}

function cancelDuringPause(record) {
  record.status = 'Cancelado'
  record.vehicleControlSkippedDuringPause = true
  record.detail = [record.detail, pauseReason].filter(Boolean).join('\n\n')
}

// Derive schedule repairs after authorization so Flota can resume controls
// without receiving or being allowed to edit unrelated agenda/history data.
function resumeVehicleControls(state, previous = {}, now = new Date()) {
  if (!vehicleControlsPaused(previous?.agenda?.weekly) || vehicleControlsPaused(state.agenda?.weekly)) return state
  const instant = typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now) ? new Date(now + 'T00:00:00-03:00') : new Date(now)
  const today = instant.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const next = structuredClone(state)
  const weekly = next.agenda?.weekly || {}
  const paused = previous.agenda.weekly
  const oldRecords = new Map((previous.history || []).map(record => [String(record.id), record]))
  const byTaskId = new Map((next.history || []).filter(record => record.sourceTaskId).map(record => [String(record.sourceTaskId), record.id]))
  const links = new Map()
  const slotFor = (friday, teamId) => {
    if (friday < today || (friday === today && weekly._holidayOverrides?.[friday]?.status === 'closed')) return null
    const slot = vehicleControlSchedule(friday, weekly, teamId)
    if (slot.date < today || (slot.date === today && instant.getTime() >= vehicleControlScheduledAt(slot).getTime() + slot.estimatedMinutes * 60000)) return null
    return slot
  }
  const plans = Object.entries(weekly).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
  if (next.agenda.date) plans.push([next.agenda.date, next.agenda])
  for (const [date, plan] of plans) {
    for (const team of plan?.teams || []) {
      for (const task of team.tasks || []) {
        const id = String(task.historyId || byTaskId.get(String(task.taskId)) || '')
        if (id && oldRecords.has(id)) {
          if (!pausedVehicleControl(oldRecords.get(id), paused)) continue
          if (!links.has(id)) links.set(id, [])
          links.get(id).push({ date, team, task })
        } else if (pausedVehicleControl(task, paused) && !task.vehicleControlReportedAt) {
          // Some old agenda-only tasks have neither a Friday ID nor an accurate weekday.
          const friday = vehicleControlFriday({ ...task, date })
          if (friday < today || (new Date(friday + 'T12:00:00Z').getUTCDay() === 5 && !slotFor(friday, team.teamId))) {
            cancelDuringPause(task)
          }
        }
      }
    }
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
    if (!pausedVehicleControl(old, paused) || !pausedVehicleControl(record, paused) || record.vehicleControlReportedAt) continue
    const copies = links.get(String(record.id)) || []
    // Older agendas can hold an inspection or a partial reading only on the task.
    const reported = copies.find(({ task }) => task.completedAt || task.vehicleControlReportedAt || task.status === 'Completado' || task.technicalStatus === 'Completado')
    if (reported) {
      preserveInspection(record, reported.task)
      for (const { task } of copies) preserveInspection(record, task)
      record.status = 'Completado'
      continue
    }
    const friday = vehicleControlFriday(old)
    const expected = slotFor(friday, record.teamId)
    if (!expected) {
      for (const { team, task } of copies) {
        preserveInspection(record, task)
        team.tasks = team.tasks.filter(item => item !== task)
      }
      cancelDuringPause(record)
      continue
    }
    if (old.startedAt || copies.some(({ task }) => task.startedAt)) continue
    if (expected.date === record.date && expected.time === record.time) continue
    const sourceDate = record.date
    const source = copies.find(copy => copy.date === sourceDate) || copies[0]
    Object.assign(record, expected, { scheduledTime: expected.time, vehicleControlScheduledFriday: friday })
    if (Object.hasOwn(record, 'scheduledDate')) record.scheduledDate = expected.date
    if (!source) continue // Do not recreate a control removed from the agenda.
    for (const { team, task } of copies) team.tasks = team.tasks.filter(item => item !== task)
    if (!weekly[expected.date]) {
      const templates = weekly._monthlyTeams?.[expected.date.slice(0, 7)]?.teams || []
      weekly[expected.date] = { teams: templates.map(team => ({ ...team, tasks: [] })) }
    }
    insert(weekly[expected.date], record, source, expected.date)
    if (next.agenda.date === expected.date) insert(next.agenda, record, source, expected.date)
  }
  return next
}
module.exports = { resumeVehicleControls }
