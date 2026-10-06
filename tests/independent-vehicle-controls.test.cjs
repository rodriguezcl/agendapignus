const test = require('node:test')
const assert = require('node:assert/strict')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const control = (vehicleId, technicianId) => ({ vehicleControl: true, vehicleId, service: 'Control semanal de vehículo', time: '15:45', estimatedMinutes: 15, technicianIds: [technicianId], technicians: [technicianId] })
const stateFor = tasks => ({ history: [], services: [], agenda: { weekly: { '2099-10-09': { teams: [{ teamId: 'team', memberIds: ['a', 'b'], members: ['a', 'b'], tasks }] } } } })

test('dos controles individuales de distintos vehículos y responsables pueden coincidir dentro del equipo', async () => {
  const { serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const tasks = [control('partner', 'a'), control('ka', 'b')]
  assert.deepEqual(serviceScheduleConflicts([{ tasks }]), [])
  assert.doesNotThrow(() => validateChangedAgendaSchedules(stateFor(tasks)))
})

test('sigue bloqueando responsable repetido, vehículo repetido, responsable ausente y servicio común', async () => {
  const { serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const first = control('partner', 'a')
  for (const second of [control('ka', 'a'), control('partner', 'b'), { ...control('ka', 'b'), technicianIds: [] }, { service: 'Alarma', time: '15:45', estimatedMinutes: 60 }]) {
    const tasks = [first, second]
    assert.equal(serviceScheduleConflicts([{ tasks }]).length, 1)
    assert.throws(() => validateChangedAgendaSchedules(stateFor(tasks)), /conflicto/)
  }
})

test('rotación mensual con jornadas existentes permite controles de dos responsables en el mismo equipo', async () => {
  const { synchronizeMonthlyVehicles } = await import('../src/domain/vehicles/monthly-vehicle-sync.mjs')
  const technicians = ['a', 'b', 'c'].map(id => ({ id, name: id }))
  const oldTeams = [{ teamId: 't1', label: 'Equipo 1', memberIds: ['a', 'b'], members: ['a', 'b'], tasks: [] }, { teamId: 't2', label: 'Equipo 2', memberIds: ['c'], members: ['c'], tasks: [] }]
  const teams = [{ ...oldTeams[0], memberIds: ['a', 'c'], members: ['a', 'c'] }, { ...oldTeams[1], memberIds: ['b'], members: ['b'] }]
  const vehicles = [{ id: 'ka', brand: 'Ford', model: 'Ka' }, { id: 'van', brand: 'Renault', model: 'Kangoo' }]
  const date = '2099-10-09'
  const history = [control('ka', 'c'), control('van', 'a')].map((record, i) => ({ ...record, id: `r${i}`, sourceTaskId: `task${i}`, date, status: 'Pendiente', monthlyVehicleAssignment: '2099-10' }))
  const state = { history, employees: technicians, services: [], agenda: { weekly: { _monthlyTeams: { '2099-10': { teams: oldTeams, vehicleAssignments: [{ vehicleId: 'ka', technicianId: 'c' }, { vehicleId: 'van', technicianId: 'a' }] } }, [date]: { teams: oldTeams.map(team => ({ ...team, tasks: history.filter(record => team.memberIds.includes(record.technicianIds[0])).map(record => ({ ...record, historyId: record.id, taskId: record.sourceTaskId })) })) } } } }
  const result = synchronizeMonthlyVehicles(state, { month: '2099-10', teams, vehicles, technicians, fromDate: '2099-10-01' })
  assert.equal(result.agenda.weekly._monthlyTeams['2099-10'].vehicleAssignments.find(item => item.vehicleId === 'ka').technicianId, 'b')
  assert.equal(result.history.length, 2)
  assert.doesNotThrow(() => validateChangedAgendaSchedules(result, state))
  assert.deepEqual(state.history, history)
})
