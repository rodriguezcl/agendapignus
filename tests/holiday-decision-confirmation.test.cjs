const test = require('node:test')
const assert = require('node:assert/strict')
const { functionSource } = require('./helpers/frontend-source.cjs')
const panel = functionSource('HolidayDecisionPanel')

test('holiday choices open confirmation instead of applying immediately', () => {
  assert.match(panel, /onClick=\{\(\) => setPendingStatus\('working'\)\}/)
  assert.match(panel, /onClick=\{\(\) => setPendingStatus\('closed'\)\}/)
  assert.doesNotMatch(panel, /onClick=\{\(\) => onDecision/)
  assert.match(panel, /return onDecision\(pendingStatus\)/)
  assert.match(panel, /close=\{\(\) => setPendingStatus\(null\)\}/)
})

test('confirmation explains reversal and existing services and stays outside clipped cards', () => {
  assert.match(panel, /createPortal\(<Confirm/)
  assert.match(panel, /document.body/)
  assert.match(panel, /no se cancelan ni se reprograman automáticamente/)
  assert.match(panel, /Podés revertir esta decisión/)
  assert.match(panel, /Los controles vehiculares pendientes/)
  assert.match(panel, /disabled=\{decision\?\.status === 'working'\}/)
  assert.match(panel, /disabled=\{decision\?\.status === 'closed'\}/)
})
