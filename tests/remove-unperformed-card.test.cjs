const test = require('node:test')
const assert = require('node:assert/strict')
const { removeConfirmedCard } = require('../scripts/remove-unperformed-agenda-card-20260907.cjs')
const target = { taskId: '40da2eeb-03a0-4c55-9248-289d61d282ed', historyId: 'work-40da2eeb-03a0-4c55-9248-289d61d282ed', time: '14:00', customerId: '94fae970-7d34-42c1-829c-9cf58d9840d5', clientAccount: 'PIG-6686', serviceId: 1 }
const fixture = () => ({ weekly: { '2026-09-07': { teams: [{ tasks: [{ id: 'keep' }, target] }, { tasks: [{ id: 'neighbor' }] }] } } })
test('removes only the exact confirmed card and does not mutate its input', () => {
  const input = fixture(), output = removeConfirmedCard(input)
  assert.equal(input.weekly['2026-09-07'].teams[0].tasks.length, 2)
  assert.deepEqual(output.weekly['2026-09-07'].teams.flatMap(team => team.tasks).map(task => task.id), ['keep', 'neighbor'])
})
test('fails closed for zero, duplicate or changed matches', () => {
  const absent = fixture(); absent.weekly['2026-09-07'].teams[0].tasks.pop()
  assert.throws(() => removeConfirmedCard(absent), /se encontraron 0/)
  const duplicate = fixture(); duplicate.weekly['2026-09-07'].teams[1].tasks.push(target)
  assert.throws(() => removeConfirmedCard(duplicate), /se encontraron 2/)
  const changed = fixture(); changed.weekly['2026-09-07'].teams[0].tasks[1].time = '14:30'
  assert.throws(() => removeConfirmedCard(changed), /cam.*campos protegidos/)
})
