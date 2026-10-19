const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const { synchronizeVehicleControlAssignments } = require('../api/_lib/vehicle-control-assignment.cjs')
const day = '2026-10-23', today = '2026-10-19'
function fixture() {
  const teams = [{ teamId: 'a', label: 'Equipo 1', memberIds: ['leonardo', 'mariano'], members: ['Leonardo', 'Mariano'], tasks: [] }, { teamId: 'b', label: 'Equipo 2', memberIds: ['pascual', 'santos'], members: ['Pascual', 'Santos'], tasks: [] }]
  const history = [['ka', 'leonardo', 'Leonardo', 0], ['kangoo', 'pascual', 'Pascual', 1], ['partner', 'santos', 'Santos', 1]].map(([vehicleId, id, name, team]) => ({ id: vehicleId, sourceTaskId: vehicleId, vehicleId, vehicleControl: true, vehicleControlScheduledFriday: day, monthlyVehicleAssignment: '2026-10', date: day, time: '15:45', estimatedMinutes: 15, status: 'Pendiente', technicianIds: [id], technicians: [name], teamId: teams[team].teamId, team: teams[team].label, detail: 'Conservar detalle', vehicleMileageAtScheduling: 1234 }))
  for (const record of history) teams.find(team => team.teamId === record.teamId).tasks.push({ ...record, taskId: record.id, historyId: record.id })
  return { history, vehicles: [{ id: 'ka', brand: 'Ford', model: 'Ka' }, { id: 'kangoo', brand: 'Renault', model: 'Kangoo' }, { id: 'partner', brand: 'Peugeot', model: 'Partner' }], employees: history.map(record => ({ id: record.technicianIds[0], name: record.technicians[0] })), services: [], agenda: { date: day, teams: structuredClone(teams), weekly: { [day]: { teams }, _monthlyTeams: { '2026-10': { teams: structuredClone(teams), vehicleAssignments: history.map(record => ({ vehicleId: record.vehicleId, technicianId: record.technicianIds[0], weeklyOverrides: { '2026-10-30': record.technicianIds[0] } })) } } } } }
}
const command = state => ({ friday: day, vehicleIds: ['ka', 'kangoo'], baseRecords: structuredClone(state.history.slice(0, 2)), today, user: { id: 'admin', name: 'Administración' } })

test('intercambio semanal atómico entre duplas preserva mes, otras fechas, tercer vehículo y trazabilidad', async () => {
  const { swapVehicleResponsibilities } = await import('../src/features/state/application/vehicle-responsibility-swap.mjs')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const state = fixture(), before = structuredClone(state)
  state.history.push({ ...state.history[0], id: 'completed-old', date: '2026-10-16', vehicleControlScheduledFriday: '2026-10-16', status: 'Completado', servicePhotoUrl: 'photo', vehicleMileage: 1500 })
  const prior = structuredClone(state)
  const next = swapVehicleResponsibilities(state, command(state))
  const saved = applyStateOperations(state, stateOperations(state, next))
  const synchronized = synchronizeVehicleControlAssignments(saved, state)
  assert.deepEqual(synchronized.history.slice(0, 3).map(record => record.technicianIds), [['pascual'], ['leonardo'], ['santos']])
  assert.deepEqual(synchronized.history[3], state.history[3])
  for (const teams of [synchronized.agenda.teams, synchronized.agenda.weekly[day].teams]) {
    assert.deepEqual(teams.map(team => team.tasks.map(task => task.vehicleId).sort()), [['kangoo'], ['ka', 'partner']])
    assert.equal(teams.flatMap(team => team.tasks).every(task => task.technicianIds.length === 1), true)
  }
  const config = synchronized.agenda.weekly._monthlyTeams['2026-10']
  assert.deepEqual(config.vehicleAssignments.map(item => item.technicianId), ['leonardo', 'pascual', 'santos'])
  assert.deepEqual(config.vehicleAssignments.map(item => item.weeklyOverrides['2026-10-30']), ['leonardo', 'pascual', 'santos'])
  assert.deepEqual(config.vehicleAssignments.slice(0, 2).map(item => item.weeklyOverrides[day]), ['pascual', 'leonardo'])
  assert.equal(config.configurationHistory[0].user.name, 'Administración')
  assert.doesNotThrow(() => validateChangedAgendaSchedules(synchronized, state))
  assert.deepEqual(state, prior)
  assert.deepEqual(synchronized.history[2], before.history[2])
})

test('rechaza controles iniciados, cerrados, eliminados, antiguos, obsoletos o sin equipo sin guardar parcialmente', async () => {
  const { swapVehicleResponsibilities } = await import('../src/features/state/application/vehicle-responsibility-swap.mjs')
  for (const change of [s => { s.history[0].startedAt = '2026-10-23T18:45:00Z' }, s => { s.history[1].status = 'Completado' }, s => { s.history[1].technicalStatus = 'Cancelado' }, s => { s.history.splice(1, 1) }, s => { s.agenda.weekly[day].teams[1].memberIds = ['otro'] }]) {
    const state = fixture(); change(state)
    const before = structuredClone(state)
    assert.throws(() => swapVehicleResponsibilities(state, command(state)))
    assert.deepEqual(state, before)
  }
  const state = fixture(), input = command(state)
  assert.throws(() => swapVehicleResponsibilities(state, { ...input, today: '2026-10-24' }))
  state.history[0].detail = 'Edición concurrente'
  assert.throws(() => swapVehicleResponsibilities(state, input), /cambió/)
})

test('reasignación de agenda elige una persona de la dupla y el control correspondiente para el intercambio', async () => {
  const { weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const state = fixture(), task = state.agenda.weekly[day].teams[0].tasks[0]
  const input = { sourceDay: day, day, sourceTeamId: 'a', team: state.agenda.weekly[day].teams[1], task, record: { ...state.history[0], teamId: 'b', team: 'Equipo 2' }, responsibleId: 'pascual', swapTaskId: 'kangoo' }
  const applied = applyStateOperations(state, weeklyServiceMoveOperations(state, input))
  const next = synchronizeVehicleControlAssignments(applied, state)
  assert.deepEqual(next.history.map(record => record.technicianIds), [['pascual'], ['leonardo'], ['santos']])
  assert.doesNotThrow(() => validateChangedAgendaSchedules(next, state))
  assert.throws(() => weeklyServiceMoveOperations(state, { ...input, responsibleId: 'fuera-del-equipo' }), /responsable único/)
})

test('intercambia dos controles dentro de la misma dupla sin duplicar las tarjetas', async () => {
  const { weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const state = fixture(), team = state.agenda.weekly[day].teams[1], task = team.tasks[0]
  const input = { sourceDay: day, day, sourceTeamId: 'b', team, task, record: state.history[1], responsibleId: 'santos', swapTaskId: 'partner' }
  const next = synchronizeVehicleControlAssignments(applyStateOperations(state, weeklyServiceMoveOperations(state, input)), state)
  assert.deepEqual(next.history.map(record => record.technicianIds), [['leonardo'], ['santos'], ['pascual']])
  assert.equal(next.agenda.weekly[day].teams[1].tasks.length, 2)
  assert.doesNotThrow(() => validateChangedAgendaSchedules(next, state))
})
