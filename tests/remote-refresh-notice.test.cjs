const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
const end = source.indexOf('const refreshWhenVisible =')
const start = source.lastIndexOf('const refreshRemoteState = async () => {', end)
assert.ok(start >= 0 && end > start)

async function refresh({ dirty = false, fail = false } = {}) {
  const notices = []
  const applied = []
  const state = { revision: 2 }
  const context = {
    confirmedSaveRef: { current: false }, loggingOutRef: { current: false },
    refreshing: false, stopped: false, pendingStateSaves: { current: 0 },
    document: { visibilityState: 'visible', activeElement: null },
    stateRepository: {
      revision: async () => { if (fail) throw new Error('offline'); return { revision: 2 } },
      load: async () => state
    },
    stateRevisionRef: { current: 1 }, isSupervisor: false,
    currentSnapshotRef: { current: dirty ? 'edited' : 'saved' },
    lastPersistedSnapshotRef: { current: 'saved' },
    remoteConflictRevisionRef: { current: null },
    setNotice: notice => notices.push(notice),
    applyRemoteState: value => applied.push(value)
  }
  await vm.runInNewContext(source.slice(start, end) + '\nrefreshRemoteState()', context)
  return { notices, applied, state }
}

test('remote refresh applies updates silently', async () => {
  const { notices, applied, state } = await refresh()
  assert.deepEqual(applied, [state])
  assert.deepEqual(notices, [])
})

test('remote refresh keeps local conflict warnings', async () => {
  const { notices, applied } = await refresh({ dirty: true })
  assert.deepEqual(applied, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0], /sin sobrescribirlos/)
})

test('remote refresh keeps connection error warnings', async () => {
  const { notices, applied } = await refresh({ fail: true })
  assert.deepEqual(applied, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0], /No se pudo comprobar/)
})
