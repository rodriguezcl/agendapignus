const test = require('node:test')
const assert = require('node:assert/strict')
const { restoreScheduledVehicleControls } = require('../api/_lib/scheduled-vehicle-control-repair.cjs')
const dates = ['2026-09-11', '2026-09-18', '2026-09-25']
function fixture() {
  const vehicle = { id: 'v1', brand: 'Ford', model: 'Ka', plate: 'AA111AA', mileage: 100 }
  const weekly = { _monthlyTeams: { '2026-09': { vehicleAssignments: [{ vehicleId: 'v1', technicianId: 'e1' }] } } }
  for (const date of dates) weekly[date] = { teams: [{ teamId: 'g1', label: 'Equipo 1', memberIds: ['e1', 'e2'], tasks: [{
    taskId: `vehicle-control-${date}-v1`, historyId: `vehicle-control-${date}-v1`, date, time: '15:30', serviceId: 'vehicle-weekly-control',
    estimatedMinutes: 15, vehicleControl: true, vehicleId: 'v1', vehicleControlScheduledFriday: date, monthlyVehicleAssignment: '2026-09'
  }] }] }
  return { employees: [{ id: 'e1', name: 'Uno' }, { id: 'e2', name: 'Dos' }], vehicles: [vehicle], history: [], agenda: { weekly } }
}
test('restores scheduled controls from monthly assignments without assigning the whole team', () => {
  const state = fixture(), result = restoreScheduledVehicleControls(state)
  assert.equal(state.history.length, 0)
  assert.equal(result.records.length, 3)
  assert.ok(result.records.every(record => record.status === 'Pendiente' && record.technicianIds.join() === 'e1'))
  assert.ok(result.state.agenda.weekly['2026-09-11'].teams[0].tasks[0].technicianIds.join() === 'e1')
})
test('honors weekly overrides and fails closed for malformed or partial input', () => {
  const state = fixture(); state.agenda.weekly._monthlyTeams['2026-09'].vehicleAssignments[0].weeklyOverrides = { '2026-09-18': 'e2' }
  assert.equal(restoreScheduledVehicleControls(state).records.find(item => item.date === '2026-09-18').technicianIds[0], 'e2')
  const malformed = fixture(); malformed.agenda.weekly['2026-09-11'].teams[0].tasks[0].time = '15:31'
  assert.throws(() => restoreScheduledVehicleControls(malformed), /cam.*campos protegidos/)
  const partial = fixture(); partial.agenda.weekly['2026-09-25'].teams[0].tasks = []
  assert.throws(() => restoreScheduledVehicleControls(partial), /Se esperaban 3/)
})
