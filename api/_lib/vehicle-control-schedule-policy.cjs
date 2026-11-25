const { vehicleControlFriday, vehicleControlSchedule } = require('./vehicle-control-schedule.cjs')
const { vehicleControlsPaused, pausedVehicleControl } = require('./vehicle-controls-pause.cjs')
const isControl = record => Boolean(record?.vehicleControl || record?.serviceId === 'vehicle-weekly-control')
const schedule = record => JSON.stringify([record?.date || '', record?.time || record?.scheduledTime || '', record?.scheduledDate || '', record?.teamId || '', Number(record?.estimatedMinutes ?? 15), record?.vehicleControlScheduledFriday || '', isControl(record)])
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400, code: 'VEHICLE_CONTROL_SCHEDULE_INVALID' }) }
function assertVehicleControlSchedule(record, previous, weekly = {}) {
 if (!record || !isControl(record) && !isControl(previous)) return
 if (previous && pausedVehicleControl(previous, weekly) &&
     ((record.status || 'Pendiente') !== (previous.status || 'Pendiente') ||
      ['startedAt','technicalStatus','technicalReportedAt','completedAt'].some(key => (record[key] || '') !== (previous[key] || '')))) {
  fail('Los controles vehiculares están pausados. Reanudalos desde Flota antes de informar su realización.')
 }
 // Unrelated edits and reports must not be blocked by legacy scheduling mistakes.
 if (previous && schedule(record) === schedule(previous)) return
 if (vehicleControlsPaused(weekly)) fail('Los controles vehiculares están pausados. Reanudalos desde Flota antes de generarlos o cambiar su agenda.')
 if (!isControl(record)) fail('No se puede quitar la condición de control vehicular para cambiar su agenda.')
 const friday = vehicleControlFriday(previous || record)
 if (vehicleControlFriday(record) !== friday) fail('El control debe conservar su semana original. No puede trasladarse a otra semana.')
 let expected
 try { expected = vehicleControlSchedule(friday, weekly, record.teamId || '') } catch (error) { fail(error.message) }
 const date = record.scheduledDate || record.date
 const time = record.time || record.scheduledTime || ''
 if (date !== expected.date || time !== expected.time || Number(record.estimatedMinutes ?? 15) !== 15) {
  fail('El control vehicular corresponde al ' + expected.date + ' a las ' + expected.time + ', 15 minutos antes del cierre. Solo se adelanta al jueves o miércoles cuando las jornadas anteriores no son operativas.')
 }
}
function validateVehicleControlSchedules(state, previousState = {}) {
 const oldHistory = new Map((previousState?.history || []).map(r => [String(r.id), r]))
 for (const record of state.history || []) assertVehicleControlSchedule(record, oldHistory.get(String(record.id)), state.agenda?.weekly)
 const plans = state => [...Object.entries(state?.agenda?.weekly || {}).filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day)).map(([day,plan]) => [day,plan,'weekly']), ...(state?.agenda?.date ? [[state.agenda.date, state.agenda,'daily']] : [])]
 const key = task => String(task.taskId || task.historyId || '')
 const previousTasks = new Map()
 for (const [date, plan, scope] of plans(previousState)) for (const team of plan.teams || []) for (const task of team.tasks || []) {
  if (key(task)) previousTasks.set(scope + ':' + date + ':' + key(task), { ...task, date, teamId: team.teamId })
 }
 for (const [date, plan, scope] of plans(state)) for (const team of plan.teams || []) for (const task of team.tasks || []) {
  const old = previousTasks.get(scope + ':' + date + ':' + key(task)) || oldHistory.get(String(task.historyId)) || [...previousTasks.values()].find(t => key(t) === key(task))
  assertVehicleControlSchedule({ ...task, id: task.historyId || task.taskId, date, teamId: team.teamId }, old, state.agenda?.weekly)
 }
}
module.exports = { assertVehicleControlSchedule, validateVehicleControlSchedules }
