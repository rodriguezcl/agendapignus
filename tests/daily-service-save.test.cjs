const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')

async function fixture() {
  const { dailyServiceOperations } = await import('../src/features/state/application/daily-service-save.mjs')
  const day = '2026-09-30'
  const blank = { taskId: 'task', time: '09:00', service: '', client: '' }
  const team = { teamId: 'team', tasks: [blank] }
  const server = { revision: 1, history: [], agenda: { date: day, teams: [team], weekly: { [day]: { teams: [team] } } } }
  const task = { ...blank, service: 'Service de alarma', client: 'Prueba', historyId: 'work-task', status: 'Pendiente' }
  const record = { id: 'work-task', sourceTaskId: 'task', date: day, status: 'Pendiente' }
  const command = { day, team, task, record, baseRecord: null, baseTask: task }
  return { dailyServiceOperations, server, command, day }
}

for (const autosaved of [false, true]) test(`daily confirmation works with autosave ${autosaved ? 'acknowledged' : 'pending'}`, async () => {
  const { dailyServiceOperations, server, command, day } = await fixture()
  if (autosaved) {
    const draft = { ...command.task }; delete draft.historyId; delete draft.status
    server.agenda.teams[0].tasks = [draft]
    server.agenda.weekly[day].teams[0].tasks = [draft]
  }
  const saved = applyStateOperations(server, dailyServiceOperations(server, 1, command))
  assert.equal(saved.history[0].id, 'work-task')
  assert.equal(saved.agenda.teams[0].tasks[0].historyId, 'work-task')
  assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].status, 'Pendiente')
})

test('daily confirmation preserves unrelated drafts and rejects real concurrent changes', async () => {
  const { dailyServiceOperations, server, command, day } = await fixture()
  const ops = dailyServiceOperations(server, 1, command)
  const other = structuredClone(server)
  other.history.push({ id: 'unrelated' })
  assert.equal(applyStateOperations(other, ops).history.length, 2)
  for (const deleted of [false, true]) {
    const concurrent = structuredClone(server)
    if (deleted) concurrent.agenda.weekly[day].teams[0].tasks = []
    else concurrent.agenda.weekly[day].teams[0].tasks[0].detail = 'Otra sesión'
    assert.throws(() => applyStateOperations(concurrent, ops), { code: 'RECORD_WRITE_CONFLICT' })
  }
  assert.throws(() => dailyServiceOperations(server, 2, command), /actualizarse/)
})
