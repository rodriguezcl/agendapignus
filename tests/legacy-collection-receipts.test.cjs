const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleStateForUser, authorizeIncomingState } = require('../api/_lib/core.cjs')
const { serviceResponse, recordBaseMatches, restoreServiceProposal } = require('../api/_lib/endpoint-policy.cjs')
const { assertCollectionChange } = require('../api/_lib/collection-policy.cjs')

const historyUser = { id: 'legacy-history', roleCode: 'legacy-history', permissions: { history: true, historyManage: true, weekly: true, agenda: true } }
const collectionUser = { id: 'legacy-collections', roleCode: 'legacy-collections', permissions: { collections: true, history: true } }
const admin = { id: 'admin', roleCode: 'administrator', permissions: {} }
const receipt = id => ({ id, name: `${id}.pdf`, mime: 'application/pdf', bytes: 100, digest: 'a'.repeat(64), createdAt: '2026-10-20T12:00:00Z', uploadedBy: 'admin' })
function fixture() {
  const old = receipt('private-previous-receipt'), current = receipt('private-current-receipt')
  const record = {
    id: 'record', sourceTaskId: 'task', date: '2099-10-20', time: '09:00', service: 'Servicio técnico', status: 'Pendiente',
    client: 'Cliente sintético', amount: '100', paymentMethod: 'Transferencia', detail: 'Detalle original',
    collection: {
      status: 'confirmed', confirmedAt: '2026-10-20T12:00:00Z', receipt: current, receipts: [old, current],
      original: { amount: '100', paymentMethod: 'Transferencia' },
      events: [{ action: 'receipt', at: '2026-10-20T12:00:00Z', actor: { id: 'admin', name: 'Administración' }, receiptBefore: old.id, receiptAfter: current.id, before: { amount: '100' }, after: { amount: '100' }, note: 'Nota visible' }]
    }
  }
  return {
    revision: 1, roles: [], employees: [], services: [], customers: [], vehicles: [], preferences: {}, reviews: [],
    history: [record],
    agenda: { date: record.date, teams: [{ teamId: 'team', tasks: [{ ...record, taskId: 'task', historyId: record.id }] }], weekly: { [record.date]: { teams: [{ teamId: 'team', tasks: [{ ...record, taskId: 'task', historyId: record.id }] }] } } }
  }
}
const withoutPrivate = value => {
  const copy = structuredClone(value)
  delete copy.collection.receipt
  delete copy.collection.receipts
  delete copy.collection.events[0].receiptBefore
  delete copy.collection.events[0].receiptAfter
  return copy
}

test('legacy history/planning hides only receipt metadata in history and agenda without mutating state', () => {
  const state = fixture(), before = structuredClone(state)
  const visible = visibleStateForUser(state, historyUser)
  assert.deepEqual(visible.history[0], withoutPrivate(state.history[0]))
  assert.deepEqual(visible.agenda.teams[0].tasks[0], withoutPrivate(state.agenda.teams[0].tasks[0]))
  assert.deepEqual(visible.agenda.weekly['2099-10-20'].teams[0].tasks[0], withoutPrivate(state.agenda.weekly['2099-10-20'].teams[0].tasks[0]))
  assert.doesNotMatch(JSON.stringify(visible), /private-(?:current|previous)-receipt/)
  assert.equal(visible.history[0].collection.events[0].note, 'Nota visible')
  assert.equal(visible.history[0].amount, '100')
  assert.deepEqual(state, before)
  const operator = visibleStateForUser(state, { id: 'operator', roleCode: 'operator', permissions: {} })
  assert.equal(operator.history[0].collection, undefined)
  assert.doesNotMatch(JSON.stringify(operator), /private-(?:current|previous)-receipt/)
})

test('legacy collections readers and administrators retain receipt metadata in state and service responses', () => {
  const state = fixture()
  for (const user of [collectionUser, admin]) {
    assert.deepEqual(visibleStateForUser(state, user).history[0], state.history[0])
    assert.strictEqual(serviceResponse(state.history[0], user), state.history[0])
  }
  assert.deepEqual(serviceResponse(state.history[0], historyUser), withoutPrivate(state.history[0]))
})

test('legacy state save restores hidden receipts while allowing unrelated history and planning edits', () => {
  const state = fixture()
  const incoming = structuredClone(visibleStateForUser(state, historyUser))
  incoming.history[0].detail = 'Detalle actualizado'
  incoming.agenda.teams[0].tasks[0].detail = 'Detalle actualizado'
  incoming.agenda.weekly['2099-10-20'].teams[0].tasks[0].detail = 'Detalle actualizado'
  const next = authorizeIncomingState(incoming, state, historyUser)
  assert.equal(next.history[0].detail, 'Detalle actualizado')
  assert.deepEqual(next.history[0].collection, state.history[0].collection)
  assert.deepEqual(next.agenda.teams[0].tasks[0].collection, state.agenda.teams[0].tasks[0].collection)
  assert.deepEqual(next.agenda.weekly['2099-10-20'].teams[0].tasks[0].collection, state.agenda.weekly['2099-10-20'].teams[0].tasks[0].collection)
  assert.doesNotThrow(() => assertCollectionChange(state.history[0], next.history[0]))
  assert.equal(incoming.history[0].collection.receipt, undefined, 'Authorization does not mutate the submitted projection')
})

test('legacy optimistic bases compare the visible record and still reject changed visible data', () => {
  const current = fixture().history[0]
  const base = serviceResponse(current, historyUser)
  assert.equal(recordBaseMatches(current, base, historyUser), true)
  assert.equal(recordBaseMatches(current, { ...base, amount: '999' }, historyUser), false)
  assert.equal(recordBaseMatches(current, { ...base, detail: 'Otro detalle' }, historyUser), false)
  assert.equal(recordBaseMatches(current, current, admin), true)
  assert.equal(recordBaseMatches(current, base, admin), false)
})

test('legacy service proposal restores canonical receipt references and ignores injected hidden metadata', () => {
  const current = fixture().history[0]
  const proposed = structuredClone(serviceResponse(current, historyUser))
  proposed.detail = 'Nueva nota'
  proposed.collection.receipt = receipt('forged-receipt')
  proposed.collection.receipts = []
  proposed.collection.events[0].receiptAfter = 'forged-event-receipt'
  const next = restoreServiceProposal(current, proposed, historyUser)
  assert.equal(next.detail, 'Nueva nota')
  assert.deepEqual(next.collection, current.collection)
  assert.doesNotThrow(() => assertCollectionChange(current, next))
  assert.equal(proposed.collection.receipt.id, 'forged-receipt')
})

test('legacy partial proposals retain the canonical collection and new records cannot inject receipt metadata', () => {
  const current = fixture().history[0]
  const proposed = { ...current, detail: 'Cambio permitido' }
  delete proposed.collection
  assert.deepEqual(restoreServiceProposal(current, proposed, historyUser).collection, current.collection)
  const forged = { id: 'new', collection: { status: 'pending', receipt: receipt('forged'), receipts: [receipt('forged')] } }
  assert.deepEqual(restoreServiceProposal(null, forged, historyUser), { id: 'new', collection: { status: 'pending' } })
})

test('restoration follows record identity after reordering and does not hide prohibited visible collection changes', () => {
  const state = fixture()
  const second = structuredClone(state.history[0])
  second.id = 'second'
  second.collection.receipt = receipt('second-receipt')
  state.history.push(second)
  const incoming = structuredClone(visibleStateForUser(state, historyUser))
  incoming.history.reverse()
  const next = authorizeIncomingState(incoming, state, historyUser)
  assert.equal(next.history[0].id, 'second')
  assert.equal(next.history[0].collection.receipt.id, 'second-receipt')
  assert.equal(next.history[1].collection.receipt.id, 'private-current-receipt')
  const altered = structuredClone(serviceResponse(state.history[0], historyUser))
  altered.collection.status = 'pending'
  const restored = restoreServiceProposal(state.history[0], altered, historyUser)
  assert.throws(() => assertCollectionChange(state.history[0], restored), { code: 'COLLECTION_PROTECTED' })
})
