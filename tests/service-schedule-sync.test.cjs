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

test('normalizing a service changes only its private working copy, including on a conflict', () => {
  const { normalizeStateForSave } = require('../api/_lib/core.cjs')
  const { fixture: planningState, day } = require('./helpers/planning-click-fixture.cjs')
  const previous = planningState()
  previous.reviews = [{ id: 'review', note: 'Original' }]
  const original = structuredClone(previous)
  const proposed = { ...previous, history: [{ ...previous.history[0], time: '10:00' }] }
  delete proposed.reviews // Older clients may omit this collection.
  const submitted = structuredClone(proposed)
  const next = normalizeStateForSave(proposed, previous)
  assert.equal(next.agenda.weekly[day].teams[0].tasks[0].time, '10:00')
  assert.deepEqual(next.reviews, previous.reviews)
  assert.notEqual(next.reviews[0], previous.reviews[0])
  assert.deepEqual(previous, original)
  assert.deepEqual(proposed, submitted)

  const conflicting = structuredClone(proposed)
  conflicting.agenda.weekly[day].teams[0].tasks[0].time = '11:00'
  const failedAttempt = structuredClone(conflicting)
  assert.throws(() => normalizeStateForSave(conflicting, previous), { code: 'SERVICE_SCHEDULE_CONFLICT' })
  assert.deepEqual(previous, original)
  assert.deepEqual(conflicting, failedAttempt)
})

test('five-hour Antigua Estancia visit never creates morning availability', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const gaps = serviceGaps([
    { time: '08:30', serviceId: 5, client: 'CLI-0006 ANTIGUA ESTANCIA', estimatedMinutes: 300 },
    { time: '14:00' }
  ], { min: '08:00', max: '17:00', day: '2026-10-05', now: new Date('2026-10-02T15:00:00Z') })
  assert.deepEqual(gaps, [{ beforeIndex: 2, start: '14:30', end: '17:00' }])
})
