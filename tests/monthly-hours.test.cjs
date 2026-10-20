const test = require('node:test')
const assert = require('node:assert/strict')
const { validateMonthlyHours, validateMonthlyHoursChange } = require('../api/_lib/monthly-hours.cjs')

test('monthly hours accept valid default slots and dated periods', () => {
  assert.equal(validateMonthlyHours('2026-10', { defaultTimes: ['08:30', '10:30'], defaultTimePeriods: [{ from: '2026-10-20', times: ['09:00', '11:00'] }] }), true)
  assert.equal(validateMonthlyHours('2026-10', { defaultTimePeriods: [] }), true)
})

test('monthly hours reject malformed, duplicate, impossible or foreign dates', () => {
  for (const from of ['2026-11-01', '2026-10-32', '20/10/2026', '2026-10-1', '']) {
    assert.throws(() => validateMonthlyHours('2026-10', { defaultTimePeriods: [{ from, times: ['09:00', '11:00'] }] }))
  }
  assert.throws(() => validateMonthlyHours('2026-02', { defaultTimePeriods: [{ from: '2026-02-30', times: ['09:00', '11:00'] }] }))
  assert.throws(() => validateMonthlyHours('2026-10', { defaultTimePeriods: [1, 2].map(() => ({ from: '2026-10-20', times: ['09:00', '11:00'] })) }))
})

test('monthly hours require two ordered valid times and a valid month', () => {
  for (const times of [['11:00', '09:00'], ['09:00', '09:00'], ['24:00', '25:00'], ['09:00'], [900, 1100], ['9:00', '11:00']]) {
    assert.throws(() => validateMonthlyHours('2026-10', { defaultTimes: times }))
  }
  assert.throws(() => validateMonthlyHours('2026-13'))
})

test('monthly hour edits preserve past periods while allowing equivalent legacy conversion', () => {
  const before = { defaultTimes: ['08:30', '10:30'] }
  const after = { defaultTimePeriods: [{ from: '2026-10-01', times: ['08:30', '10:30'] }, { from: '2026-10-20', times: ['09:00', '11:00'] }] }
  assert.equal(validateMonthlyHoursChange('2026-10', before, after, '2026-10-20'), true)
  assert.throws(() => validateMonthlyHoursChange('2026-10', before, {}, '2026-10-20'), /conservarse/)
  assert.throws(() => validateMonthlyHoursChange('2026-09', {}, {}, '2026-10-20'), /finalizados/)
  assert.throws(() => validateMonthlyHoursChange('2026-10', {}, { defaultTimePeriods: [{ from: '2026-10-19', times: ['09:00', '11:00'] }] }, '2026-10-20'), /conservarse/)
})
