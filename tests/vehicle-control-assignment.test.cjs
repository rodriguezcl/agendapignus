const test = require('node:test')
const assert = require('node:assert/strict')
const { synchronizeVehicleControlAssignments: sync } = require('../api/_lib/vehicle-control-assignment.cjs')
const fixture = () => {
  const task = { taskId: 'control', historyId: 'control', vehicleControl: true, technicianIds: ['leo'], technicians: ['Leonardo'] }
  const team = { teamId: 't3', label: 'Equipo 3', memberIds: ['mariano'], members: ['Mariano'], tasks: [task] }
  return { history: [{ ...task, id: 'control', sourceTaskId: 'control', date: '2026-09-18', vehicleId: 'ka', status: 'Pendiente' }],
    agenda: { date: '2026-09-18', teams: [structuredClone(team)], weekly: {
      '2026-09-18': { teams: [team] }, _monthlyTeams: { '2026-09': { vehicleAssignments: [{ vehicleId: 'ka', technicianId: 'leo' }] } }
    } } }
}
test('replacement updates history and both agendas, only for this Friday', () => {
  const state = fixture(), next = sync(state, state)
  assert.deepEqual(next.history[0].technicianIds, ['mariano'])
  assert.deepEqual(next.agenda.teams[0].tasks[0].technicianIds, ['mariano'])
  assert.deepEqual(next.agenda.weekly['2026-09-18'].teams[0].tasks[0].technicianIds, ['mariano'])
  const assignment = next.agenda.weekly._monthlyTeams['2026-09'].vehicleAssignments[0]
  assert.equal(assignment.technicianId, 'leo')
  assert.deepEqual(assignment.weeklyOverrides, { '2026-09-18': 'mariano' })
  assert.deepEqual(sync(next, next), next)
  assert.deepEqual(state.history[0].technicianIds, ['leo'])
})
test('does not rewrite completed controls, recreate removals or guess among multiple replacements', () => {
  for (const status of ['Completado', 'Cancelado', 'Reprogramado']) {
    const state = fixture(); state.history[0].status = status
    assert.deepEqual(sync(state, state), state)
  }
  const removed = fixture(); removed.history = []
  assert.deepEqual(sync(removed, removed).history, [])
  const ambiguous = fixture()
  ambiguous.agenda.weekly['2026-09-18'].teams[0].memberIds.push('santos')
  assert.deepEqual(sync(ambiguous, ambiguous).history[0].technicianIds, ['leo'])
})
test('daily membership edits also synchronize the control', () => {
  const previous = fixture()
  previous.agenda.teams[0].memberIds = ['leo']; previous.agenda.teams[0].members = ['Leonardo']
  previous.agenda.weekly['2026-09-18'].teams = structuredClone(previous.agenda.teams)
  const next = structuredClone(previous)
  next.agenda.teams[0].memberIds = ['mariano']; next.agenda.teams[0].members = ['Mariano']
  const result = sync(next, previous)
  assert.deepEqual(result.history[0].technicianIds, ['mariano'])
  assert.deepEqual(sync(result, result), result)
})
