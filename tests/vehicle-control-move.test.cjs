const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { synchronizeVehicleControlAssignments } = require('../api/_lib/vehicle-control-assignment.cjs')
const day = '2026-09-18'
const fixture = () => {
  const task = { taskId: 'control-kangoo', historyId: 'control-kangoo', vehicleControl: true, time: '15:30', detail: 'Control de limpieza y kilometraje', technicianIds: ['santos'], technicians: ['Santos'] }
  const teams = [
    { teamId: 't2', label: 'Equipo 2', memberIds: ['santos'], members: ['Santos'], tasks: [task] },
    { teamId: 't3', label: 'Equipo 3', memberIds: ['mariano'], members: ['Mariano'], tasks: [] }
  ]
  const stored = { history: [{ ...task, id: task.historyId, sourceTaskId: task.taskId, date: day, status: 'Pendiente', vehicleId: 'kangoo', teamId: 't2', vehicleMileageAtScheduling: 12345 }], agenda: { date: day, teams: structuredClone(teams), weekly: { [day]: { teams }, _monthlyTeams: { '2026-09': { vehicleAssignments: [{ vehicleId: 'kangoo', technicianId: 'santos' }] } } } } }
  stored.agenda.teams[0].tasks[0].detail = 'Texto diferente en la proyección diaria'
  const local = structuredClone(stored)
  // App reconciles the daily card from weekly on hydration, without saving it.
  local.agenda.teams[0].tasks[0] = structuredClone(task)
  const command = { day, sourceDay: day, sourceTeamId: 't2', team: teams[1], task, baseTask: task, baseRecord: local.history[0], record: { ...local.history[0], teamId: 't3', team: 'Equipo 3' } }
  return { stored, local, command }
}

test('reproduces false CAS conflict after daily/weekly display reconciliation', async () => {
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { stored, local, command } = fixture()
  assert.throws(() => applyStateOperations(stored, weeklyServiceOperations(local, command)), error => error.code === 'RECORD_WRITE_CONFLICT' && error.conflictPath.includes('"teams"'))
})

test('server baseline moves control once, updates responsible and keeps monthly default', async () => {
  const { weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { stored, command } = fixture()
  const before = structuredClone(stored)
  const operations = weeklyServiceMoveOperations(stored, command)
  const applied = applyStateOperations(stored, operations)
  const next = synchronizeVehicleControlAssignments(applied, stored)
  for (const teams of [next.agenda.teams, next.agenda.weekly[day].teams]) {
    assert.equal(teams[0].tasks.length, 0)
    assert.equal(teams[1].tasks.length, 1)
    assert.deepEqual(teams[1].tasks[0].technicianIds, ['mariano'])
  }
  assert.equal(next.history.length, 1)
  assert.equal(next.history[0].id, 'control-kangoo')
  assert.equal(next.history[0].vehicleMileageAtScheduling, 12345)
  assert.deepEqual(next.history[0].technicianIds, ['mariano'])
  const assignment = next.agenda.weekly._monthlyTeams['2026-09'].vehicleAssignments[0]
  assert.equal(assignment.technicianId, 'santos')
  assert.equal(assignment.weeklyOverrides[day], 'mariano')
  assert.deepEqual(stored, before)
  assert.deepEqual(applyStateOperations(applied, operations), applied)
})

test('real concurrent history and projection changes still reject the move', async () => {
  const { weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  for (const edit of [state => { state.history[0].status = 'Completado' }, state => { state.agenda.teams[0].tasks[0].detail = 'Edición nueva' }, state => { state.agenda.weekly[day].teams[0].tasks[0].time = '16:00' }, state => { state.agenda.weekly[day].teams[1].memberIds = ['otro'] }]) {
    const { stored, command } = fixture()
    const operations = weeklyServiceMoveOperations(stored, command)
    const concurrent = structuredClone(stored)
    edit(concurrent)
    assert.throws(() => applyStateOperations(concurrent, operations), { code: 'RECORD_WRITE_CONFLICT' })
  }
})

test('missing source or ambiguous replacement cannot silently move a control', async () => {
  const { weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { stored, command } = fixture()
  assert.throws(() => weeklyServiceMoveOperations(stored, { ...command, sourceTeamId: 'missing' }), /versión guardada/)
  assert.throws(() => weeklyServiceMoveOperations(stored, { ...command, team: { ...command.team, memberIds: ['mariano', 'otro'], members: ['Mariano', 'Otro'] } }), /responsable único/)
})

test('vehicle moves use captured server snapshots without mixing pending edits', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  assert.match(source, /lastServerSnapshotRef\.current = structuredClone\(data\)/)
  assert.match(source, /const moveSnapshot = isolatedMove \? lastServerSnapshotRef\.current : null/)
  assert.match(source, /if \(serialized !== lastPersistedSnapshotRef.current\) throw new Error\('Guardá los cambios pendientes/)
  assert.match(source, /isolatedMove: Boolean\(command.sourceDay && command.task\?\.vehicleControl\)/)
})

test('swaps same-time controls atomically in both agendas and history', async () => {
  const { weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { stored, command } = fixture()
  const ford = { ...command.task, taskId: 'control-ford', historyId: 'control-ford', technicianIds: ['mariano'], technicians: ['Mariano'] }
  stored.agenda.weekly[day].teams[1].tasks.push(ford)
  stored.agenda.teams[1].tasks.push(structuredClone(ford))
  stored.history.push({ ...stored.history[0], id: ford.historyId, sourceTaskId: ford.taskId, vehicleId: 'ford', teamId: 't3', technicianIds: ['mariano'], technicians: ['Mariano'] })
  stored.agenda.weekly._monthlyTeams['2026-09'].vehicleAssignments.push({ vehicleId: 'ford', technicianId: 'mariano' })
  command.swapTaskId = ford.taskId
  const operations = weeklyServiceMoveOperations(stored, command)
  const applied = applyStateOperations(stored, operations)
  const next = synchronizeVehicleControlAssignments(applied, stored)
  for (const teams of [next.agenda.teams, next.agenda.weekly[day].teams]) {
    assert.deepEqual(teams.map(team => team.tasks.map(task => task.taskId)), [['control-ford'], ['control-kangoo']])
    assert.deepEqual(teams[0].tasks[0].technicianIds, ['santos'])
    assert.deepEqual(teams[1].tasks[0].technicianIds, ['mariano'])
  }
  assert.equal(next.history.length, 2)
  assert.deepEqual(next.history.map(record => record.teamId), ['t3', 't2'])
  assert.deepEqual(next.history.map(record => record.technicianIds), [['mariano'], ['santos']])
  const assignments = next.agenda.weekly._monthlyTeams['2026-09'].vehicleAssignments
  assert.deepEqual(assignments.map(item => item.technicianId), ['santos', 'mariano'])
  assert.deepEqual(assignments.map(item => item.weeklyOverrides[day]), ['mariano', 'santos'])
  assert.deepEqual(applyStateOperations(applied, operations), applied)
  const concurrent = structuredClone(stored)
  concurrent.history[1].status = 'Completado'
  const unchanged = structuredClone(concurrent)
  assert.throws(() => applyStateOperations(concurrent, operations), { code: 'RECORD_WRITE_CONFLICT' })
  assert.deepEqual(concurrent, unchanged)
  assert.throws(() => weeklyServiceMoveOperations(stored, { ...command, swapTaskId: '' }), /destino cambió/)
  assert.throws(() => weeklyServiceMoveOperations(concurrent, command), /pendientes/)
})

test('swap candidates require same date, time and a vehicle control', async () => {
  const { vehicleControlSwapCandidate: candidate } = await import('../src/features/state/application/weekly-service-save.mjs')
  const task = { taskId: 'a', vehicleControl: true, time: '15:30' }
  const other = { ...task, taskId: 'b' }
  assert.equal(candidate(task, { tasks: [other] }, day, day), other)
  assert.equal(candidate(task, { tasks: [other] }, day, '2026-09-25'), null)
  assert.equal(candidate(task, { tasks: [{ ...other, time: '16:00' }] }, day, day), null)
  assert.equal(candidate({ ...task, vehicleControl: false }, { tasks: [other] }, day, day), null)
  assert.throws(() => candidate(task, { tasks: [other, { ...other, taskId: 'c' }] }, day, day), /más de un control/)
})
