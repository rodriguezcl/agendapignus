const test = require('node:test')
const assert = require('node:assert/strict')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')

test('vehicle control reserves 15 minutes in UI and server, including cross-team assignments', async () => {
  const { taskOccupiedInterval, serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const { vehicleControlSchedule, vehicleControlTask } = await import('../src/domain/vehicles/vehicle-controls.mjs')
  const friday = '2099-01-09'
  const control = vehicleControlTask({ id: 'control', vehicleId: 'kangoo', ...vehicleControlSchedule(friday), technicianIds: ['santos'], technicians: ['Santos'], service: 'Control semanal de vehículo' })
  const service = { taskId: 's', serviceId: 's', time: '14:45', estimatedMinutes: 60 }
  const team = (teamId, tasks) => ({ teamId, memberIds: ['santos'], members: ['Santos'], tasks })
  const state = teams => ({ services: [], history: [], agenda: { date: friday, teams, weekly: {} } })

  assert.equal(taskOccupiedInterval(control).startTime, '15:45')
  assert.equal(taskOccupiedInterval(control).endTime, '16:00')
  assert.equal(taskOccupiedInterval(service).endTime, '15:45')
  const adjacent = [team('equipo-1', [service, control])]
  assert.deepEqual(serviceScheduleConflicts(adjacent), [])
  assert.doesNotThrow(() => validateChangedAgendaSchedules(state(adjacent)))
  assert.doesNotThrow(() => validateChangedAgendaSchedules(state([team('equipo-1', [service]), team('equipo-2', [control])])))

  const lateService = { ...service, time: '15:00' }
  const overlap = [team('equipo-1', [lateService, control])]
  assert.equal(serviceScheduleConflicts(overlap).length, 1)
  assert.throws(() => validateChangedAgendaSchedules(state(overlap)), /conflicto de horarios/)
  assert.throws(() => validateChangedAgendaSchedules(state([team('equipo-1', [lateService]), team('equipo-2', [control])])), /Santos tiene servicios incompatibles/)
})
