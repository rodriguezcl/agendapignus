const test = require('node:test')
const assert = require('node:assert/strict')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')

test('vehicle control reserves 15 minutes in UI and server, including cross-team assignments', async () => {
  const { taskOccupiedInterval, serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const control = { taskId: 'v', serviceId: 'v', vehicleControl: true, technicianIds: ['santos'], time: '15:30', estimatedMinutes: 15 }
  const service = { taskId: 's', serviceId: 's', time: '16:00', estimatedMinutes: 60 }
  assert.equal(taskOccupiedInterval(control).endTime, '15:45')
  assert.equal(taskOccupiedInterval({ ...control, vehicleControl: false }).endTime, '16:30')
  const team = tasks => ({ memberIds: ['santos'], members: ['Santos'], tasks })
  const state = teams => ({ services: [], history: [], agenda: { date: '2099-09-18', teams, weekly: {} } })
  for (const time of ['15:45', '16:00']) {
    const next = { ...service, time }
    assert.equal(serviceScheduleConflicts([team([control, next])]).length, 0)
    assert.doesNotThrow(() => validateChangedAgendaSchedules(state([team([control, next])])))
    assert.doesNotThrow(() => validateChangedAgendaSchedules(state([team([control]), team([next])])))
  }
  assert.throws(() => validateChangedAgendaSchedules(state([team([control, { ...service, time: '15:40' }])])), /conflicto/)
  assert.throws(() => validateChangedAgendaSchedules(state([team([{ ...control, vehicleControl: false }, service])])), /conflicto/)
})
