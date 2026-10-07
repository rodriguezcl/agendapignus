const test = require('node:test')
const assert = require('node:assert/strict')

const old = [{ teamId: 'pair', memberIds: ['a', 'b'], members: ['A', 'B'] }, { teamId: 'solo', memberIds: ['c'], members: ['C'] }]
const teams = [{ ...old[0], memberIds: ['a', 'c'], members: ['A', 'C'] }, { ...old[1], memberIds: ['b'], members: ['B'] }]
function fixture() {
  const task = { taskId: 't', historyId: 'r', status: 'Pendiente', technicianIds: ['a', 'b'], technicians: ['A', 'B'] }
  const plan = { teams: [{ ...old[0], tasks: [task] }, { ...old[1], tasks: [] }] }
  return { history: [{ ...task, id: 'r', date: '2026-10-09' }], agenda: { date: '2026-10-09', teams: structuredClone(plan.teams), weekly: { _monthlyTeams: { '2026-10': { teams: old } }, '2026-10-09': plan } } }
}
test('sincroniza dotación heredada en agenda semanal, diaria e historial sin mutar origen', async () => {
  const { synchronizeMonthlyTeams } = await import('../src/domain/agenda/monthly-team-sync.mjs')
  const state = fixture(), snapshot = structuredClone(state)
  const next = synchronizeMonthlyTeams(state, { month: '2026-10', teams, fromDate: '2026-10-07' })
  assert.deepEqual(next.agenda.weekly['2026-10-09'].teams[0].memberIds, ['a', 'c'])
  assert.deepEqual(next.agenda.teams[0].tasks[0].technicianIds, ['a', 'c'])
  assert.deepEqual(next.history[0].technicianIds, ['a', 'c'])
  assert.deepEqual(state, snapshot)
})
test('conserva excepciones manuales, días pasados y trabajos iniciados o cerrados', async () => {
  const { synchronizeMonthlyTeams } = await import('../src/domain/agenda/monthly-team-sync.mjs')
  for (const mutate of [
    s => { s.agenda.weekly['2026-10-09'].teams[0].memberIds = ['x'] },
    s => { s.agenda.weekly['2026-10-09'].teams[0].monthlyStaffingOverride = true },
    s => { s.history[0].startedAt = '2026-10-09T08:00:00Z' },
    s => { s.history[0].status = 'Completado' }
  ]) {
    const state = fixture(); mutate(state)
    const next = synchronizeMonthlyTeams(state, { month: '2026-10', teams, fromDate: '2026-10-07' })
    assert.deepEqual(next.agenda.weekly['2026-10-09'].teams[0], state.agenda.weekly['2026-10-09'].teams[0])
  }
  const state = fixture()
  assert.deepEqual(synchronizeMonthlyTeams(state, { month: '2026-10', teams, fromDate: '2026-10-10' }), state)
})
test('recalcula el Ford Ka sobre el nuevo equipo individual sin duplicar controles', async () => {
  const { synchronizeMonthlyTeams } = await import('../src/domain/agenda/monthly-team-sync.mjs')
  const { synchronizeMonthlyVehicles } = await import('../src/domain/vehicles/monthly-vehicle-sync.mjs')
  const state = fixture()
  const control = { id: 'ka-control', sourceTaskId: 'ka-task', vehicleControl: true, vehicleId: 'ka', monthlyVehicleAssignment: '2026-10', date: '2026-10-09', time: '15:45', status: 'Pendiente', technicianIds: ['c'], technicians: ['C'] }
  state.history.push(control)
  state.agenda.weekly._monthlyTeams['2026-10'].vehicleAssignments = [{ vehicleId: 'ka', technicianId: 'c' }]
  state.agenda.weekly['2026-10-09'].teams[1].tasks.push({ ...control, taskId: 'ka-task', historyId: control.id })
  state.agenda.teams = structuredClone(state.agenda.weekly['2026-10-09'].teams)
  const options = { month: '2026-10', teams, fromDate: '2026-10-07', vehicles: [{ id: 'ka', brand: 'Ford', model: 'Ka' }], technicians: ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase() })) }
  const next = synchronizeMonthlyVehicles(synchronizeMonthlyTeams(state, options), options)
  assert.deepEqual(next.history.find(r => r.id === control.id).technicianIds, ['b'])
  assert.equal(next.agenda.weekly['2026-10-09'].teams[1].tasks.length, 1)
  assert.equal(next.history.length, 2)
})
