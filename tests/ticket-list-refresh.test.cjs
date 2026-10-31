const test = require('node:test')
const assert = require('node:assert/strict')
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const result = (ids = ['a', 'b']) => ({ items: ids.map(id => ({ id, title: id })), counts: { Nuevo: ids.length }, total: ids.length, page: 1 })
async function fixture() {
  const { createTicketListRefresh } = await import('../src/features/tickets/ticket-list-refresh.mjs')
  const requests = [], states = []
  let time = 0
  const list = createTicketListRefresh({ now: () => time, fetchList: signal => { const request = { ...deferred(), signal }; requests.push(request); return request.promise }, onChange: state => states.push(state) })
  return { list, requests, states, advance: () => { time += 60000 }, state: () => states.at(-1) }
}
test('background results never remove or reorder the displayed list until applied', async () => {
  const f = await fixture(), first = f.list.refresh()
  f.requests[0].resolve(result()); await first
  const displayed = f.state().data
  f.advance()
  const poll = f.list.refresh({ background: true })
  assert.equal(f.state().loading, false)
  assert.equal(f.state().data, displayed)
  f.requests[1].resolve(result(['new', 'b', 'a'])); await poll
  assert.equal(f.state().data, displayed)
  assert.deepEqual(f.state().pending.items.map(t => t.id), ['new', 'b', 'a'])
  f.list.apply()
  assert.deepEqual(f.state().data.items.map(t => t.id), ['new', 'b', 'a'])
  assert.equal(f.state().pending, null)
})
test('focus storms are throttled and concurrent background requests are coalesced', async () => {
  const f = await fixture(), first = f.list.refresh()
  await f.list.refresh({ background: true })
  f.requests[0].resolve(result()); await first
  await f.list.refresh({ background: true })
  assert.equal(f.requests.length, 1)
  f.advance()
  const poll = f.list.refresh({ background: true })
  await f.list.refresh({ background: true })
  assert.equal(f.requests.length, 2)
  f.requests[1].resolve(result()); await poll
  assert.equal(f.state().pending, null)
})
test('explicit changes supersede a slow poll and ignore stale responses', async () => {
  const f = await fixture(), first = f.list.refresh()
  f.requests[0].resolve(result()); await first; f.advance()
  const poll = f.list.refresh({ background: true }), changed = f.list.refresh()
  assert.equal(f.requests[1].signal.aborted, true)
  f.requests[2].resolve(result(['saved'])); await changed
  f.requests[1].resolve(result(['obsolete'])); await poll
  assert.deepEqual(f.state().data.items.map(t => t.id), ['saved'])
  assert.equal(f.state().pending, null)
})
test('transient failures preserve reading; revoked access clears displayed and staged data', async () => {
  const f = await fixture(), first = f.list.refresh()
  f.requests[0].resolve(result()); await first; f.advance()
  const poll = f.list.refresh({ background: true })
  f.requests[1].reject(new Error('Sin conexión')); await poll
  assert.equal(f.state().data.total, 2)
  assert.equal(f.state().loading, false)
  const retry = f.list.refresh()
  f.requests[2].reject(Object.assign(new Error('Sin permiso'), { status: 403 })); await retry
  assert.equal(f.state().data.total, 0)
  assert.equal(f.state().pending, null)
})
test('filter changes/unmount abort outstanding requests without publishing old data', async () => {
  const f = await fixture(), first = f.list.refresh(), emitted = f.states.length
  f.list.dispose()
  assert.equal(f.requests[0].signal.aborted, true)
  f.requests[0].resolve(result()); await first
  assert.equal(f.states.length, emitted)
})
test('SLA minute countdown alone is not a novelty, but a breached deadline is', async () => {
  const f = await fixture(), first = f.list.refresh()
  const before = result(); before.items[0].slaSummary = { status: 'on-track', resolution: { remainingMinutes: 30, status: 'pending' } }
  f.requests[0].resolve(before); await first; f.advance()
  const poll = f.list.refresh({ background: true }), next = structuredClone(before)
  next.items[0].slaSummary.resolution.remainingMinutes = 29
  f.requests[1].resolve(next); await poll
  assert.equal(f.state().pending, null)
  f.advance(); const overdue = f.list.refresh({ background: true })
  next.items[0].slaSummary.resolution.status = 'overdue'
  f.requests[2].resolve(next); await overdue
  assert.ok(f.state().pending)
})
