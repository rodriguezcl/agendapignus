const test = require('node:test')
const assert = require('node:assert/strict')
const { synchronizeServiceSchedules: sync } = require('../api/_lib/service-schedule-sync.cjs')
const fixture = () => {
  const task = { taskId: 't', historyId: 'h', time: '08:30', estimatedMinutes: 60, estimatedMinutesCustomized: true }
  return { history: [{ ...task, id: 'h', sourceTaskId: 't', date: '2026-10-05' }], agenda: { date: '2026-10-05', teams: [{ tasks: [{ ...task }] }], weekly: { '2026-10-05': { teams: [{ tasks: [{ ...task }] }] } } } }
}
test('weekly duration propagates to history and daily copy', () => {
  const old = fixture(), next = structuredClone(old)
  next.agenda.weekly['2026-10-05'].teams[0].tasks[0].estimatedMinutes = 300
  const result = sync(next, old)
  assert.equal(result.history[0].estimatedMinutes, 300)
  assert.equal(result.agenda.teams[0].tasks[0].estimatedMinutes, 300)
  assert.equal(old.history[0].estimatedMinutes, 60)
})
test('history time and duration propagate to both agendas', () => {
  const old = fixture(), next = structuredClone(old)
  Object.assign(next.history[0], { time: '09:00', estimatedMinutes: 300 })
  const result = sync(next, old)
  for (const plan of [result.agenda, result.agenda.weekly['2026-10-05']]) {
    assert.equal(plan.teams[0].tasks[0].estimatedMinutes, 300)
    assert.equal(plan.teams[0].tasks[0].time, '09:00')
  }
})
test('different simultaneous edits are rejected', () => {
  const old = fixture(), next = structuredClone(old)
  next.history[0].estimatedMinutes = 300
  next.agenda.teams[0].tasks[0].estimatedMinutes = 315
  assert.throws(() => sync(next, old), { code: 'SERVICE_SCHEDULE_CONFLICT' })
})
test('unrelated save preserves legacy discrepancy', () => {
  const old = fixture(); old.history[0].estimatedMinutes = 15
  assert.deepEqual(sync(old, old), old)
})

test('five-hour Antigua Estancia visit never creates morning availability', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const gaps = serviceGaps([
    { time: '08:30', serviceId: 5, client: 'CLI-0006 ANTIGUA ESTANCIA', estimatedMinutes: 300 },
    { time: '14:00' }
  ], { min: '08:00', max: '17:00', day: '2026-10-05', now: new Date('2026-10-02T15:00:00Z') })
  assert.deepEqual(gaps, [])
})
