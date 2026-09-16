const test = require('node:test')
const assert = require('node:assert/strict')

test('focuses the exact pending service by id even when rows are reordered', async () => {
  const { focusPendingService } = await import('../src/presentation/components/forms/focus-pending-service.mjs')
  const calls = []
  const row = id => ({ getAttribute: () => id, focus: options => calls.push([id, 'focus', options]), scrollIntoView: options => calls.push([id, 'scroll', options]) })
  const previous = global.window
  global.window = { matchMedia: () => ({ matches: true }) }
  try {
    const root = { querySelectorAll: () => [row('second'), row('first')] }
    assert.equal(focusPendingService('first', root), true)
    assert.deepEqual(calls, [['first', 'focus', { preventScroll: true }], ['first', 'scroll', { block: 'start', behavior: 'auto' }]])
    assert.equal(focusPendingService('removed', root), false)
    assert.equal(focusPendingService('', root), false)
    assert.equal(calls.length, 2)
  } finally { global.window = previous }
})
