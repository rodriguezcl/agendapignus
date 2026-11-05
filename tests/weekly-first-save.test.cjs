const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
async function fixture() {
  const { weeklyServiceCreationOperations } = await import('../src/features/state/application/weekly-service-create.mjs')
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const day = '2026-11-06'
  const team = { teamId: 'team-1', memberIds: ['tech'], members: ['Técnico'], tasks: [] }
  const task = { taskId: 'task-new', historyId: 'work-new', time: '10:00', service: 'Service' }
  const record = { ...task, id: 'work-new', date: day, teamId: team.teamId, technicianIds: team.memberIds }
  const server = { revision: 1, customers: [], history: [], agenda: { date: '2026-11-05', teams: [], weekly: {} } }
  return { create: weeklyServiceCreationOperations, edit: weeklyServiceOperations, day, team, task, record, server, command: { day, team, task, record } }
}
test('primer servicio materializa el día reconstruido en pantalla sin conflicto de otra sesión', async () => {
  const f = await fixture(), display = structuredClone(f.server)
  display.agenda.weekly[f.day] = { teams: [f.team] }
  assert.throws(() => applyStateOperations(f.server, f.edit(display, f.command)), { code: 'RECORD_WRITE_CONFLICT' })
  const operations = f.create(f.server, 1, f.command)
  const saved = applyStateOperations(f.server, operations)
  assert.deepEqual(saved.history, [f.record])
  assert.deepEqual(saved.agenda.weekly[f.day].teams[0].tasks, [f.task])
  assert.deepEqual(applyStateOperations(saved, operations), saved)
})
test('primer servicio guarda equipo nuevo, equipo sin tasks y proyección diaria vacía', async () => {
  for (const mode of ['team', 'tasks', 'daily']) {
    const f = await fixture()
    if (mode === 'team') f.server.agenda.weekly[f.day] = { teams: [] }
    if (mode === 'tasks') { const { tasks, ...team } = f.team; f.server.agenda.weekly[f.day] = { teams: [team] } }
    if (mode === 'daily') f.server.agenda.date = f.day
    const saved = applyStateOperations(f.server, f.create(f.server, 1, f.command))
    assert.equal(saved.history.length, 1)
    assert.equal(saved.agenda.weekly[f.day].teams[0].tasks[0].taskId, f.task.taskId)
    if (mode === 'daily') assert.equal(saved.agenda.teams[0].tasks[0].taskId, f.task.taskId)
  }
})
test('alta no incluye borradores de otros servicios y conserva altas concurrentes', async () => {
  const f = await fixture()
  const operations = f.create(f.server, 1, f.command)
  const concurrent = structuredClone(f.server)
  const other = { taskId: 'other', historyId: 'work-other', time: '12:00' }
  concurrent.agenda.weekly[f.day] = { teams: [{ ...f.team, tasks: [other] }] }
  concurrent.history.push({ id: 'work-other' })
  const saved = applyStateOperations(concurrent, operations)
  assert.equal(saved.history.length, 2)
  assert.equal(saved.agenda.weekly[f.day].teams[0].tasks.length, 2)
  assert.ok(saved.agenda.weekly[f.day].teams[0].tasks.some(task => task.taskId === 'other'))
})
test('cambios reales de equipo y eliminación concurrente siguen protegidos', async () => {
  const f = await fixture()
  f.server.agenda.weekly[f.day] = { teams: [f.team] }
  const operations = f.create(f.server, 1, f.command)
  for (const remove of [false, true]) {
    const concurrent = structuredClone(f.server)
    if (remove) concurrent.agenda.weekly[f.day].teams = []
    else concurrent.agenda.weekly[f.day].teams[0].memberIds = ['other-tech']
    assert.throws(() => applyStateOperations(concurrent, operations), { code: 'RECORD_WRITE_CONFLICT' })
  }
})
test('reservas y clientes nuevos se crean atómicamente junto con el servicio', async () => {
  const f = await fixture(), customer = { customerId: 'new-client', account: 'CLI-1', name: 'CLIENTE' }
  const command = { ...f.command, customer, record: { ...f.record, customerId: customer.customerId } }
  const saved = applyStateOperations(f.server, f.create(f.server, 1, command))
  assert.deepEqual(saved.customers, [customer])
  assert.equal(saved.history[0].customerId, customer.customerId)
  assert.throws(() => f.create(f.server, 2, command), /actualizarse/)
  assert.throws(() => f.create(f.server, 1, { ...command, baseRecord: f.record }), /servicios nuevos/)
})
