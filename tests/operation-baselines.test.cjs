const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')

async function fixture(minutes = 420) {
  const { rescheduledAgendaTask } = await import('../src/domain/agenda/reschedule-repair.mjs')
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { alignOperationBaselines } = await import('../src/features/state/application/operation-baselines.mjs')
  const day = '2026-09-28'
  const task = { taskId: 'task-a', historyId: 'work-a', client: 'QA', service: 'Service de alarma', time: '08:45', estimatedMinutes: 90, estimatedMinutesCustomized: false, status: 'Pendiente' }
  const record = { ...task, id: 'work-a', sourceTaskId: task.taskId, date: day, teamId: 'team-2', team: 'Equipo 2', rescheduledFrom: '2026-09-29', reprogrammedAt: '2026-09-25T17:54:33.266Z', technicians: ['A', 'B'] }
  const server = { revision: 12, history: [record], agenda: { date: '2026-09-25', teams: [], weekly: { [day]: { teams: [{ teamId: 'team-2', tasks: [task] }] } } } }
  const display = structuredClone(server)
  const team = display.agenda.weekly[day].teams[0]
  team.tasks[0] = rescheduledAgendaTask(record, task)
  const command = { day, team, baseTask: team.tasks[0], baseRecord: record, task: { ...team.tasks[0], estimatedMinutes: minutes, estimatedMinutesCustomized: true }, record: { ...record, estimatedMinutes: minutes, estimatedMinutesCustomized: true } }
  const operations = weeklyServiceOperations(display, command)
  return { server, display, command, operations, alignOperationBaselines, weeklyServiceOperations, day }
}

for (const minutes of [420, 450]) test(`reprogrammed Monday service saves ${minutes} minutes despite hydration enrichment`, async () => {
  const { server, display, operations, alignOperationBaselines, day } = await fixture(minutes)
  assert.throws(() => applyStateOperations(server, operations), { code: 'RECORD_WRITE_CONFLICT' })
  const before = structuredClone(server)
  const aligned = alignOperationBaselines(operations, display, server)
  const saved = applyStateOperations(server, aligned)
  assert.equal(saved.history[0].estimatedMinutes, minutes)
  assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].estimatedMinutes, minutes)
  assert.equal(saved.history[0].time, '08:45')
  assert.deepEqual(saved.history[0].technicians, ['A', 'B'])
  assert.deepEqual(server, before)
  assert.deepEqual(applyStateOperations(saved, aligned), saved)
})

test('real concurrent history/task changes and deletions still conflict', async () => {
  const { server, display, operations, alignOperationBaselines, day } = await fixture()
  const aligned = alignOperationBaselines(operations, display, server)
  for (const change of [
    state => { state.history[0].detail = 'Other user' },
    state => { state.agenda.weekly[day].teams[0].tasks[0].time = '10:00' },
    state => { state.history = [] },
    state => { state.agenda.weekly[day].teams[0].tasks = [] },
  ]) {
    const concurrent = structuredClone(server)
    change(concurrent)
    assert.throws(() => applyStateOperations(concurrent, aligned), { code: 'RECORD_WRITE_CONFLICT' })
  }
})

test('a stale modal baseline is never replaced by the latest display baseline', async () => {
  const { server, display, operations, alignOperationBaselines } = await fixture()
  const stale = structuredClone(operations)
  const history = stale.find(op => op.path[0] === 'history')
  history.before.detail = 'Old version'
  assert.throws(() => applyStateOperations(server, alignOperationBaselines(stale, display, server)), { code: 'RECORD_WRITE_CONFLICT' })
})

test('unrelated concurrent services survive the aligned edit', async () => {
  const { server, display, operations, alignOperationBaselines, day } = await fixture()
  const current = structuredClone(server)
  current.history.push({ id: 'other', detail: 'Keep me' })
  current.agenda.weekly[day].teams[0].tasks.push({ taskId: 'other-task', historyId: 'other' })
  const saved = applyStateOperations(current, alignOperationBaselines(operations, display, server))
  assert.deepEqual(saved.history[1], current.history[1])
  assert.deepEqual(saved.agenda.weekly[day].teams[0].tasks[1], current.agenda.weekly[day].teams[0].tasks[1])
})

test('missing persisted records are not translated into creates', async () => {
  const { server, display, operations, alignOperationBaselines } = await fixture()
  server.history = []
  assert.throws(() => applyStateOperations(server, alignOperationBaselines(operations, display, server)), { code: 'RECORD_WRITE_CONFLICT' })
})

test('ordered pending edits retain their intermediate baseline', async () => {
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const { server, display, command, alignOperationBaselines, weeklyServiceOperations, day } = await fixture()
  const local = structuredClone(display)
  local.agenda.weekly[day].teams[0].tasks[0].detail = 'Local edit'
  const task = local.agenda.weekly[day].teams[0].tasks[0]
  const pending = stateOperations(display, local)
  const commands = weeklyServiceOperations(local, { ...command, baseTask: task, task: { ...command.task, detail: task.detail } })
  const saved = applyStateOperations(server, alignOperationBaselines([...pending, ...commands], display, server))
  assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].detail, 'Local edit')
  assert.equal(saved.agenda.weekly[day].teams[0].tasks[0].estimatedMinutes, 420)
})
