const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const tick = () => new Promise(resolve => setImmediate(resolve))

async function harness() {
  const { createSaveActivity, operationScopes } = await import('../src/features/state/application/save-activity.mjs')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const { alignOperationBaselines } = await import('../src/features/state/application/operation-baselines.mjs')
  const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  const code = source.slice(source.indexOf('  const persistStateCommand ='), source.indexOf('  const persistWeeklyService ='))
  const ref = current => ({ current })
  const snapshot = { history: [{ id: 'a' }, { id: 'b' }], agenda: {} }
  const requests = [], applied = []
  const context = {
    createSaveActivity, operationScopes, stateOperations, alignOperationBaselines,
    saveSessionEpochRef: ref(1), saveActivityRef: ref(createSaveActivity()), pendingConfirmedSavesRef: ref(0), saveBatchRef: ref(null),
    currentSnapshotRef: ref(JSON.stringify(snapshot)), lastPersistedSnapshotRef: ref(JSON.stringify(snapshot)), lastServerSnapshotRef: ref({ ...snapshot, revision: 1 }),
    confirmedSaveRef: ref(false), stateSaveTimerRef: ref(null), pendingStateSaves: ref(0), stateSaveGenerationRef: ref(0), stateSaveQueue: ref(Promise.resolve()),
    stateRevisionRef: ref(1), saveDraftConflictRef: ref(false), setConfirmedSaving() {}, window: { clearTimeout() {} },
    stateRepository: { commit: (ops, revision) => new Promise((resolve, reject) => requests.push({ ops, revision, resolve, reject })) },
    applyRemoteState: (state, options) => applied.push({ state, options })
  }
  const run = vm.runInNewContext(code + '\npersistStateCommand', context)
  return { context, requests, applied, run, snapshot }
}
const command = id => () => [{ path: ['history', { key: 'id', id }], before: { id }, after: { id, detail: 'saved' }, existed: true, exists: true }]

test('actual App command sends independent saves concurrently and hydrates newest response once', async () => {
  const { run, requests, applied, context, snapshot } = await harness()
  const a = run(command('a'), { combinePendingState: true })
  const b = run(command('b'), { combinePendingState: true })
  await tick()
  assert.equal(requests.length, 2)
  const newest = { ...snapshot, revision: 3 }
  requests[1].resolve({ state: newest }); await b
  assert.equal(applied.length, 0)
  assert.equal(context.confirmedSaveRef.current, true)
  requests[0].resolve({ state: { ...snapshot, revision: 2 } }); await a
  assert.equal(applied.length, 1)
  assert.equal(applied[0].state, newest)
  assert.equal(context.confirmedSaveRef.current, false)
  assert.equal(context.saveActivityRef.current.size, 0)
})

test('actual App rejects duplicate service saves and releases failed requests', async () => {
  const { run, requests, context } = await harness()
  const first = run(command('a'), { combinePendingState: true })
  await tick()
  await assert.rejects(run(command('a'), { combinePendingState: true }), /ya se está guardando/)
  assert.equal(requests.length, 1)
  requests[0].reject(new Error('offline'))
  await assert.rejects(first, /offline/)
  assert.equal(context.confirmedSaveRef.current, false)
  assert.equal(context.saveActivityRef.current.size, 0)
})

test('actual App does not apply a save response after its session has ended', async () => {
  const { run, requests, applied, context, snapshot } = await harness()
  const pending = run(command('a'), { combinePendingState: true })
  await tick()
  context.saveSessionEpochRef.current++
  context.saveBatchRef.current = null
  requests[0].resolve({ state: { ...snapshot, revision: 2 } })
  await pending
  assert.equal(applied.length, 0)
})

test('actual App aligns display baselines only with the matching server revision', async () => {
  for (const revision of [1, 2]) {
    const { run, requests, context } = await harness()
    const displayed = { history: [{ id: 'a', detail: 'Display enrichment' }], agenda: {} }
    context.currentSnapshotRef.current = JSON.stringify(displayed)
    context.lastPersistedSnapshotRef.current = JSON.stringify(displayed)
    context.lastServerSnapshotRef.current = { history: [{ id: 'a' }], agenda: {}, revision }
    const pending = run(() => [{ path: ['history', { key: 'id', id: 'a' }], before: displayed.history[0], after: { id: 'a', detail: 'Edited' }, existed: true, exists: true }], { combinePendingState: true, alignDisplayBaselines: true })
    await tick()
    assert.deepEqual(requests[0].ops[0].before, revision === 1 ? { id: 'a' } : displayed.history[0])
    requests[0].resolve({ state: { ...displayed, revision: 3 } })
    await pending
  }
})
