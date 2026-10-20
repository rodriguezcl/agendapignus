const test = require('node:test')
const assert = require('node:assert/strict')
const read = require('../api/_lib/granular-read-policy.cjs')
const endpoint = require('../api/_lib/endpoint-policy.cjs')
const user = keys => ({ id: 'one', roleCode: 'custom', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) } })
const record = {
  id: 'work', date: '2026-10-20', status: 'Completado', client: 'CLI-1 Cliente', amount: '100', paymentMethod: 'Transferencia',
  collection: { status: 'confirmed', confirmedAt: '2026-10-20T14:00:00Z', original: { amount: '100' }, events: [{ action: 'confirm' }], receipt: { id: 'active', name: 'comprobante.pdf' }, receipts: [{ id: 'previous' }, { id: 'active' }] }
}
const state = { history: [record], customers: [], employees: [], roles: [], agenda: {} }

test('receipt metadata is financial collections data, with older versions restricted to timeline', () => {
  const financialHistory = user(['history.view', 'records.read', 'records.financial'])
  const history = read.sanitizeService(record, financialHistory, state)
  assert.equal(history.amount, '100')
  assert.equal(history.collection.receipt, undefined)
  assert.equal(history.collection.receipts, undefined)
  const reader = user(['collections.view', 'records.financial'])
  const visible = read.sanitizeService(record, reader, state)
  assert.deepEqual(visible.collection.receipt, record.collection.receipt)
  assert.equal(visible.collection.receipts, undefined)
  assert.equal(visible.collection.events, undefined)
  const timeline = user(['collections.view', 'records.financial', 'collections.timeline'])
  assert.deepEqual(read.sanitizeService(record, timeline, state).collection.receipts, record.collection.receipts)
  const revoked = user(['collections.view', 'records.read'])
  assert.equal(read.sanitizeService(record, revoked, state).collection, undefined)
})

test('receipt endpoints and uploads require effective collections permissions', () => {
  const reader = user(['collections.view', 'records.financial'])
  const route = '/collections/work/receipts/active'
  assert.doesNotThrow(() => endpoint.assertEndpointPermission(reader, 'GET', route))
  for (const actor of [user(['history.view', 'records.read', 'records.financial']), user(['collections.view'])]) {
    assert.throws(() => endpoint.assertEndpointPermission(actor, 'GET', route), /permiso/)
  }
  assert.throws(() => endpoint.assertEndpointPermission(reader, 'DELETE', route), /conservan/)
  const corrector = user(['collections.view', 'records.financial', 'collections.amount'])
  const input = { recordId: record.id, action: 'correct', amount: '110', paymentMethod: record.paymentMethod }
  assert.doesNotThrow(() => endpoint.assertCollectionAction(corrector, state, input))
  assert.throws(() => endpoint.assertCollectionAction(corrector, state, { ...input, receipt: { id: 'forged' } }), /collections.confirm/)
  assert.throws(() => endpoint.assertCollectionAction(corrector, state, { ...input, action: 'receipt' }), /collections.confirm/)
})

test('a role without timeline can save against its visible collection base without bypassing concurrency', async () => {
  const { collectionBase, manageCollection } = await import('../src/domain/collections/collections.mjs')
  const actor = user(['collections.view', 'records.financial', 'collections.amount'])
  const visible = read.sanitizeService(record, actor, state)
  const input = { recordId: record.id, action: 'correct', amount: '110', paymentMethod: record.paymentMethod, base: collectionBase(visible) }
  const restored = endpoint.collectionInput(state, input, actor, collectionBase)
  assert.deepEqual(restored.base, collectionBase(record))
  const saved = manageCollection(state, restored, actor)
  assert.equal(saved.after.amount, '110')
  assert.deepEqual(saved.after.collection.receipt, record.collection.receipt)
  assert.equal(saved.after.collection.events.length, 2)
  const changed = { ...state, history: [{ ...record, amount: '200' }] }
  assert.throws(() => endpoint.collectionInput(changed, input, actor, collectionBase), error => error.statusCode === 409)
  const tampered = { ...input, base: { ...input.base, collection: { ...input.base.collection, receipt: { id: 'forged' } } } }
  assert.throws(() => endpoint.collectionInput(state, tampered, actor, collectionBase), error => error.statusCode === 409)
})
