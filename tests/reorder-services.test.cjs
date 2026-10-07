const test = require('node:test')
const assert = require('node:assert/strict')
const fixture = () => {
  const tasks = [{ taskId: 'a', historyId: 'ha', time: '11:00', estimatedMinutes: 60, client: 'A', status: 'Pendiente' }, { taskId: 'b', historyId: 'hb', time: '14:00', estimatedMinutes: 90, client: 'B', status: 'Pendiente' }]
  return { agenda: { date: '2026-10-07', teams: [{ teamId: 't', tasks: structuredClone(tasks) }], weekly: { '2026-10-07': { teams: [{ teamId: 't', tasks }] } } }, history: tasks.map(t => ({ ...t, id: t.historyId })) }
}
test('reordena ambos servicios y sincroniza historial y agenda sin perder datos', async () => {
  const { reorderServices } = await import('../src/domain/agenda/reorder-services.mjs')
  const state = fixture()
  const next = reorderServices(state, { day: '2026-10-07', teamId: 't', baseline: state.agenda.weekly['2026-10-07'].teams[0].tasks, changes: [{ taskId: 'b', time: '12:00' }, { taskId: 'a', time: '13:30' }], validate: team => assert.equal(team.tasks[0].time, '13:30') })
  assert.equal(state.history[0].time, '11:00')
  assert.equal(next.history[0].time, '13:30')
  assert.equal(next.history[1].estimatedMinutes, 90)
  assert.equal(next.agenda.teams[0].tasks[0].taskId, 'b')
  assert.equal(next.agenda.weekly['2026-10-07'].teams[0].tasks[0].taskId, 'b')
})
test('rechaza inicio concurrente, horario modificado y conflictos sin mutar datos', async () => {
  const { reorderServices } = await import('../src/domain/agenda/reorder-services.mjs')
  for (const mode of ['started', 'changed', 'conflict']) {
    const state = fixture(), baseline = structuredClone(state.agenda.weekly['2026-10-07'].teams[0].tasks)
    if (mode === 'started') state.history[1].startedAt = '2026-10-07T15:00:00Z'
    if (mode === 'changed') state.agenda.weekly['2026-10-07'].teams[0].tasks[1].time = '15:00'
    const before = structuredClone(state)
    assert.throws(() => reorderServices(state, { day: '2026-10-07', teamId: 't', baseline, changes: [{ taskId: 'a', time: '14:00' }, { taskId: 'b', time: '11:00' }], validate: () => { if (mode === 'conflict') throw Error('Conflicto') } }))
    assert.deepEqual(state, before)
  }
})
test('no permite controles ni servicios resueltos', async () => {
  const { canReorderService } = await import('../src/domain/agenda/reorder-services.mjs')
  const task = fixture().agenda.teams[0].tasks[0]
  assert.equal(canReorderService(task), true)
  for (const patch of [{ vehicleControl: true }, { status: 'Completado' }, { technicalStatus: 'Reprogramación solicitada' }, { startedAt: 'now' }]) assert.equal(canReorderService({ ...task, ...patch }), false)
})
