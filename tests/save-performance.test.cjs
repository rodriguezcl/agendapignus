const test = require('node:test')
const assert = require('node:assert/strict')
const { assertPreparedRevision, retryPreparedWrite } = require('../api/_lib/prepared-state-write.cjs')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')

test('independent saves revalidate after a concurrent commit without losing either service', async () => {
  let state = { revision: 1, history: [{ id: 'a', detail: 'old' }, { id: 'b', detail: 'old' }] }
  const operation = { path: ['history', { key: 'id', id: 'a' }], before: state.history[0], after: { id: 'a', detail: 'new' }, existed: true, exists: true }
  let attempts = 0
  await retryPreparedWrite(async () => {
    const snapshot = structuredClone(state)
    const next = applyStateOperations(snapshot, [operation])
    if (!attempts++) state = { revision: 2, history: [state.history[0], { id: 'b', detail: 'other session' }] }
    assertPreparedRevision(snapshot.revision, state.revision)
    state = { ...next, revision: state.revision + 1 }
  })
  assert.equal(attempts, 2)
  assert.deepEqual(state.history, [{ id: 'a', detail: 'new' }, { id: 'b', detail: 'other session' }])
  await assert.rejects(retryPreparedWrite(() => applyStateOperations(state, [{ ...operation, after: { id: 'a', detail: 'overwrite' } }])), { code: 'RECORD_WRITE_CONFLICT' })
  let retries = 0
  await assert.rejects(retryPreparedWrite(() => { retries++; assertPreparedRevision(1, 2) }), { statusCode: 503 })
  assert.equal(retries, 5)
})

test('compact response reconstructs exact state with stable identities, additions, removals and daily plans', async () => {
  const { stateDelta, applyStateDelta } = await import('../src/domain/shared/state-delta.mjs')
  const before = { revision: 1, history: [{ id: 'a', detail: 'old' }, { id: 'b' }], customers: [{ customerId: 'c', name: 'Client' }], agenda: { date: '2026-09-22', teams: [], weekly: { '2026-09-22': { teams: [] }, '2026-09-23': { teams: [] } } }, preferences: { theme: 'light' } }
  const after = { ...before, revision: 2, history: [{ id: 'c' }, { id: 'a', detail: 'new' }], agenda: { date: '2026-09-23', teams: [{ teamId: 't' }], weekly: { '2026-09-23': { teams: [{ teamId: 't' }] } } } }
  const delta = stateDelta(before, after)
  assert.deepEqual(applyStateDelta(before, delta), after)
  assert.equal(delta.changes.customers, undefined)
  assert.throws(() => applyStateDelta({ ...before, revision: 3 }, delta))
  assert.deepEqual(before.history, [{ id: 'a', detail: 'old' }, { id: 'b' }])
  const large = { ...before, history: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), detail: 'x'.repeat(200) })) }
  const edited = { ...large, revision: 2, history: large.history.map((row, i) => i === 10 ? { ...row, detail: 'edited' } : row) }
  const compact = stateDelta(large, edited)
  assert.deepEqual(applyStateDelta(large, compact), edited)
  assert.ok(JSON.stringify(compact).length < JSON.stringify(edited).length / 100)
})

test('client coordinates by service rather than a global busy flag', async () => {
  const { createSaveActivity, operationScopes } = await import('../src/features/state/application/save-activity.mjs')
  const activity = createSaveActivity()
  const operations = id => [{ path: ['history', { key: 'id', id }], after: { sourceTaskId: `task-${id}` } }]
  const releaseA = activity.acquire(operationScopes(operations('a')))
  const releaseB = activity.acquire(operationScopes(operations('b')))
  assert.equal(activity.size, 2)
  assert.throws(() => activity.acquire(['task:a', 'task:task-a']))
  assert.throws(() => activity.acquire(['*']))
  releaseA(); releaseB()
  const releaseAll = activity.acquire(['*'])
  assert.throws(() => activity.acquire(['history:a']))
  releaseAll()
  assert.equal(activity.size, 0)
})

test('responses preserve edits made while saving and flag contradictory edits', async () => {
  const { preserveLocalDraft } = await import('../src/features/state/application/save-activity.mjs')
  const base = { history: [{ id: 'a', detail: 'old' }, { id: 'b', detail: 'old' }] }
  const local = { history: [{ id: 'a', detail: 'old' }, { id: 'b', detail: 'typing' }] }
  const remote = { history: [{ id: 'a', detail: 'saved' }, { id: 'b', detail: 'old' }, { id: 'c', detail: 'other user' }] }
  const result = preserveLocalDraft(base, local, remote)
  assert.equal(result.conflict, false)
  assert.deepEqual(result.state.history, [{ id: 'a', detail: 'saved' }, { id: 'b', detail: 'typing' }, { id: 'c', detail: 'other user' }])
  const conflict = preserveLocalDraft(base, local, { history: [{ id: 'b', detail: 'remote edit' }] })
  assert.equal(conflict.conflict, true)
  assert.equal(conflict.state.history[0].detail, 'typing')
})
