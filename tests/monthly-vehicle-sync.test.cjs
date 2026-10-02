const test = require('node:test'), assert = require('node:assert/strict')
const { synchronizeVehicleControlAssignments } = require('../api/_lib/vehicle-control-assignment.cjs')
test('al rotar equipos se asigna el Ka al solitario y se preservan excepciones y controles cerrados', async () => {
  const { synchronizeMonthlyVehicles } = await import('../src/domain/vehicles/monthly-vehicle-sync.mjs')
  const technicians = ['a', 'b', 'c'].map(id => ({ id, name: id }))
  const teams = [{ teamId: 't1', label: 'Equipo 1', memberIds: ['a', 'b'], members: ['a', 'b'], tasks: [] }, { teamId: 't2', label: 'Equipo 2', memberIds: ['c'], members: ['c'], tasks: [] }]
  const vehicles = [{ id: 'ka', brand: 'Ford', model: 'Ka' }, { id: 'van', brand: 'Renault', model: 'Kangoo' }]
  const records = ['02', '09', '16', '23'].map(day => ({ id: `ka-${day}`, sourceTaskId: `ka-${day}`, date: `2026-10-${day}`, time: '15:45', vehicleId: 'ka', vehicleControl: true, monthlyVehicleAssignment: '2026-10', technicianIds: ['a'], technicians: ['a'], status: day === '02' ? 'Completado' : 'Pendiente', ...(day === '23' ? { startedAt: '2026-10-23T15:45:00Z' } : {}) }))
  const weekly = { _monthlyTeams: { '2026-09': { vehicleAssignments: [{ vehicleId: 'van', technicianId: 'a' }] }, '2026-10': { teams, vehicleAssignments: [{ vehicleId: 'ka', technicianId: 'a', weeklyOverrides: { '2026-10-09': 'b', '2026-10-16': 'a' } }, { vehicleId: 'van', technicianId: 'a' }] } } }
  for (const record of records) weekly[record.date] = { teams: teams.map((team, i) => ({ ...team, tasks: i ? [] : [{ ...record, historyId: record.id, taskId: record.sourceTaskId }] })) }
  const state = { history: records, employees: technicians, agenda: { date: '2026-10-16', teams: structuredClone(weekly['2026-10-16'].teams), weekly } }
  const result = synchronizeMonthlyVehicles(state, { month: '2026-10', teams, vehicles, technicians, fromDate: '2026-10-02' })
  const assignments = result.agenda.weekly._monthlyTeams['2026-10'].vehicleAssignments
  assert.equal(assignments.find(a => a.vehicleId === 'ka').technicianId, 'c')
  assert.equal(assignments.find(a => a.vehicleId === 'van').technicianId, 'b')
  assert.deepEqual(assignments[0].weeklyOverrides, { '2026-10-09': 'b' })
  assert.deepEqual(result.history[0], records[0])
  assert.deepEqual(result.history[3], records[3])
  assert.deepEqual(result.history[1].technicianIds, ['b'])
  assert.deepEqual(result.history[2].technicianIds, ['c'])
  assert.equal(result.agenda.teams[1].tasks[0].historyId, 'ka-16')
  assert.equal(result.history.length, records.length)
  assert.deepEqual(synchronizeVehicleControlAssignments(result, state).history[2].technicianIds, ['c'])
  assert.deepEqual(synchronizeVehicleControlAssignments(result, state).agenda.weekly._monthlyTeams['2026-10'].vehicleAssignments[0].weeklyOverrides, { '2026-10-09': 'b' })
})

test('la lectura o normalización no inventa reemplazos por dotaciones desalineadas', () => {
  const record = { id: 'control', sourceTaskId: 'control', vehicleControl: true, vehicleId: 'ka', date: '2026-10-02', technicianIds: ['solo'], technicians: ['Solo'] }
  const state = { history: [record], agenda: { weekly: { '2026-10-02': { teams: [{ teamId: 'old', memberIds: ['other'], members: ['Otro'], tasks: [{ ...record, historyId: 'control' }] }] } } } }
  assert.deepEqual(synchronizeVehicleControlAssignments(state, state), state)
})
