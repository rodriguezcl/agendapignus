const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const tick = () => new Promise(resolve => setImmediate(resolve))
async function harness() {
  const { canRefreshRemote, REMOTE_EDIT_NOTICE } = await import('../src/features/state/application/remote-refresh-policy.mjs')
  const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  const start = source.indexOf('    const refreshRemoteState = async () => {')
  const end = source.indexOf('    const refreshWhenVisible =', start)
  assert.ok(start > 0 && end > start)
  let revisionResolve, stateResolve
  const notices = [], applied = []
  const ref = current => ({ current })
  const context = {
    refreshing: false, stopped: false, confirmedSaveRef: ref(false), loggingOutRef: ref(false),
    pendingStateSaves: ref(0), document: { visibilityState: 'visible' },
    canRefreshRemote, REMOTE_EDIT_NOTICE, hasUnsavedFormFields: () => true,
    weeklyNavigationGuard: ref(null), isReadOnly: false, currentSnapshotRef: ref('{}'),
    lastPersistedSnapshotRef: ref('{}'), stateRevisionRef: ref(10), remoteConflictRevisionRef: ref(null),
    stateRepository: { revision: () => new Promise(resolve => { revisionResolve = resolve }), load: () => new Promise(resolve => { stateResolve = resolve }) },
    pendingRemoteSnapshot: (_, load) => load(), setAuthUser() {}, authUser: {},
    reconcileSessionUser: (_, next) => next, endInvalidatedSession() {},
    applyRemoteState: state => applied.push(state), setNotice: notice => notices.push(notice)
  }
  const refresh = vm.runInNewContext(source.slice(start, end) + '\nrefreshRemoteState', context)
  return { context, notices, applied, refresh, revision: value => revisionResolve(value), state: value => stateResolve(value) }
}
test('respuesta de revisión iniciada antes de guardar no genera aviso durante el guardado propio', async () => {
  const h = await harness(), pending = h.refresh()
  h.context.confirmedSaveRef.current = true
  h.revision({ revision: 11 }); await pending
  assert.deepEqual(h.notices, [])
  assert.deepEqual(h.applied, [])
})
test('respuesta de revisión anterior a nuestro guardado confirmado se ignora', async () => {
  const h = await harness(), pending = h.refresh()
  h.context.stateRevisionRef.current = 12
  h.revision({ revision: 11 }); await pending
  assert.deepEqual(h.notices, [])
})
for (const busy of [true, false]) test('carga de estado en vuelo no confunde la confirmación propia: busy=' + busy, async () => {
  const h = await harness(), pending = h.refresh()
  h.revision({ revision: 11 }); await tick()
  if (busy) h.context.pendingStateSaves.current = 1
  else h.context.stateRevisionRef.current = 11
  h.state({ revision: 11, history: [] }); await pending
  assert.deepEqual(h.notices, [])
  assert.deepEqual(h.applied, [])
})
test('una revisión realmente nueva conserva el aviso y protege el formulario abierto', async () => {
  const h = await harness(), pending = h.refresh()
  h.revision({ revision: 11 }); await tick()
  h.state({ revision: 11, history: [] }); await pending
  assert.equal(h.notices.length, 1)
  assert.match(h.notices[0], /otra sesión/)
  assert.deepEqual(h.applied, [])
})
