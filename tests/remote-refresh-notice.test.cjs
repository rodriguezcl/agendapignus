const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
const end = source.indexOf('const refreshWhenVisible =')
const start = source.lastIndexOf('const refreshRemoteState = async () => {', end)
assert.ok(start >= 0 && end > start)

async function refresh({ dirty = false, fail = false, repeatThenDiscard = false } = {}) {
  const notices = []
  const applied = []
  const state = { revision: 2 }
  const { canRefreshRemote, REMOTE_EDIT_NOTICE } = await import('../src/features/state/application/remote-refresh-policy.mjs')
  const { createRevisionSnapshotCache } = await import('../src/domain/shared/revision-snapshot-cache.mjs')
  let downloads = 0
  const context = {
    pendingRemoteSnapshot: createRevisionSnapshotCache(),
    canRefreshRemote, REMOTE_EDIT_NOTICE, isReadOnly: false, hasUnsavedFormFields: () => dirty, weeklyNavigationGuard: { current: null },
    confirmedSaveRef: { current: false }, loggingOutRef: { current: false },
    refreshing: false, stopped: false, pendingStateSaves: { current: 0 },
    document: { visibilityState: 'visible', activeElement: null },
    stateRepository: {
      revision: async () => { if (fail) throw new Error('offline'); return { revision: 2 } },
      load: async () => { downloads++; return state }
    },
    stateRevisionRef: { current: 1 }, isSupervisor: false,
    currentSnapshotRef: { current: dirty ? 'edited' : 'saved' },
    lastPersistedSnapshotRef: { current: 'saved' },
    remoteConflictRevisionRef: { current: null },
    setNotice: notice => { const value = typeof notice === 'function' ? notice('') : notice; if (value) notices.push(value) },
    applyRemoteState: value => applied.push(value)
  }
  const run = vm.runInNewContext(source.slice(start, end) + '\nrefreshRemoteState', context)
  await run()
  if (repeatThenDiscard) {
    await run(); await run()
    dirty = false
    context.currentSnapshotRef.current = 'saved'
    await run()
  }
  return { notices, applied, state, downloads }
}

test('pending remote state is downloaded once and applied after discarding the draft', async () => {
  const { applied, state, downloads } = await refresh({ dirty: true, repeatThenDiscard: true })
  assert.equal(downloads, 1)
  assert.deepEqual(applied, [state])
})

test('remote refresh applies updates silently', async () => {
  const { notices, applied, state } = await refresh()
  assert.deepEqual(applied, [state])
  assert.deepEqual(notices, [])
})

test('remote refresh keeps local conflict warnings', async () => {
  const { notices, applied } = await refresh({ dirty: true })
  assert.deepEqual(applied, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0], /edición en curso: guardala o cancelala/)
})

test('remote refresh keeps connection error warnings', async () => {
  const { notices, applied } = await refresh({ fail: true })
  assert.deepEqual(applied, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0], /No se pudo comprobar/)
})
