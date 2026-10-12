const test = require('node:test')
const assert = require('node:assert/strict')
const hours = { min: '08:00', max: '17:00', breakStart: '13:00', breakEnd: '14:00' }
test('lunch falls between morning and afternoon availability in an empty team', async () => {
  const { withLunchNotice } = await import('../src/domain/agenda/lunch-placement.mjs')
  const gaps = [{ beforeIndex: 0, start: '08:30', end: '13:00' }, { beforeIndex: 0, start: '14:00', end: '17:00' }]
  assert.deepEqual(withLunchNotice([], gaps, hours).map(row => row.kind || row.start), ['08:30', 'lunch', '14:00'])
  assert.equal(gaps.length, 2)
})
test('lunch is after morning service and gap, before afternoon service', async () => {
  const { withLunchNotice } = await import('../src/domain/agenda/lunch-placement.mjs')
  const tasks = [{ time: '08:30' }, { time: '14:00' }]
  const rows = withLunchNotice(tasks, [{ beforeIndex: 1, start: '10:30', end: '13:00' }], hours)
  assert.deepEqual(rows.map(row => [row.beforeIndex, row.kind || row.start]), [[1, '10:30'], [1, 'lunch']])
})
test('a service spanning lunch remains a single card; lunch appears once before the following service', async () => {
  const { withLunchNotice } = await import('../src/domain/agenda/lunch-placement.mjs')
  const tasks = [{ time: '12:00', estimatedMinutes: 180 }, { time: '16:00' }]
  assert.equal(withLunchNotice(tasks, [], hours)[0].beforeIndex, 1)
  assert.equal(withLunchNotice([tasks[0]], [], hours)[0].beforeIndex, 1)
  assert.deepEqual(withLunchNotice(tasks, [], { ...hours, max: '12:00' }), [])
  assert.equal(withLunchNotice([{ time: '11:00' }, { time: '12:30' }], [], { ...hours, breakStart: '12:00', breakEnd: '12:30' })[0].beforeIndex, 1)
})
