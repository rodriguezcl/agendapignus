const test = require('node:test')
const assert = require('node:assert/strict')
test('consultation and serialization order do not block remote refresh', async () => {
  const { canRefreshRemote } = await import('../src/features/state/application/remote-refresh-policy.mjs')
  assert.equal(canRefreshRemote({ current: JSON.stringify({ customers: [{ name: 'A', customerId: '1' }] }), baseline: JSON.stringify({ customers: [{ customerId: '1', name: 'A' }] }) }), true)
})
test('actual changes and component-local drafts protect edits until saved or cancelled', async () => {
  const { canRefreshRemote } = await import('../src/features/state/application/remote-refresh-policy.mjs')
  const baseline = JSON.stringify({ customers: [{ customerId: '1', name: 'A' }] })
  const current = JSON.stringify({ customers: [{ customerId: '1', name: 'B' }] })
  assert.equal(canRefreshRemote({ current, baseline }), false)
  assert.equal(canRefreshRemote({ current: baseline, baseline, draft: true }), false)
  assert.equal(canRefreshRemote({ current: baseline, baseline, saving: true }), false)
  assert.equal(canRefreshRemote({ current: baseline, baseline }), true)
})
test('a save or edit starting during a remote request prevents applying its result', async () => {
  const { canRefreshRemote } = await import('../src/features/state/application/remote-refresh-policy.mjs')
  const state = { current: '{"history":[]}', baseline: '{"history":[]}' }
  assert.equal(canRefreshRemote(state), true)
  state.draft = true
  assert.equal(canRefreshRemote(state), false)
  assert.equal(canRefreshRemote({ current: 'invalid', baseline: '{}' }), false)
})
