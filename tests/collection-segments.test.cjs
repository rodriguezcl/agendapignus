const test = require('node:test')
const assert = require('node:assert/strict')
const domain = import('../src/domain/collections/collection-segments.mjs')
const collections = import('../src/domain/collections/collections.mjs')
const today = '2026-10-20'
const payment = (id, date, extra = {}) => ({ id, date, status: 'Pendiente', amount: '100', paymentMethod: 'Efectivo', ...extra })
const paid = (id, date, extra = {}) => payment(id, date, { collection: { status: 'confirmed' }, ...extra })

test('today and earlier dates stay current, while prepaid future services stay future independently of payment state', async () => {
  const { collectionSegments } = await domain
  const records = [
    payment('yesterday', '2026-10-19', { amount: '50.25' }),
    paid('today-paid', today, { amount: '100.75' }),
    payment('today', today, { amount: '200' }),
    paid('tomorrow-paid', '2026-10-21', { amount: '300.50' }),
    payment('tomorrow', '2026-10-21', { amount: '400.25' })
  ]
  const [current, future] = collectionSegments(records, { today })
  assert.equal(current.id, 'current')
  assert.equal(future.id, 'future')
  assert.deepEqual(current.records.map(record => record.id), ['yesterday', 'today-paid', 'today'])
  assert.deepEqual(future.records.map(record => record.id), ['tomorrow-paid', 'tomorrow'])
  assert.deepEqual({ total: current.total, pending: current.pending, confirmed: current.confirmed }, {
    total: 351, pending: { count: 2, total: 250.25 }, confirmed: { count: 1, total: 100.75 }
  })
  assert.deepEqual({ total: future.total, pending: future.pending, confirmed: future.confirmed }, {
    total: 700.75, pending: { count: 1, total: 400.25 }, confirmed: { count: 1, total: 300.5 }
  })
})

test('a cancelled first journey follows its first active visit and contributes one shared collection', async () => {
  const { collectionSegments } = await domain
  const { collectionRecords, collectionServiceResolver } = await collections
  const history = [1, 2, 3, 4].map(index => payment(index === 1 ? 'job' : `visit-${index}`, `2026-10-${19 + index}`, {
    amount: '1250.50', serviceJourney: { id: 'job', index, total: 4 }, ...(index === 1 ? { status: 'Cancelado' } : {})
  }))
  const resolveService = collectionServiceResolver(history)
  const records = collectionRecords(history, resolveService)
  const [current, future] = collectionSegments(records, { today, resolveService })
  assert.deepEqual(current.records, [])
  assert.deepEqual(future.records, [history[0]])
  assert.equal(future.total, 1250.5)
  assert.deepEqual(future.pending, { count: 1, total: 1250.5 })
  const [nextCurrent, nextFuture] = collectionSegments(records, { today: '2026-10-21', resolveService })
  assert.deepEqual(nextCurrent.records, [history[0]])
  assert.equal(nextFuture.total, 0)
})

test('fully cancelled confirmed jobs fall back to the owner date without losing their payment', async () => {
  const { collectionSegments } = await domain
  const { collectionRecords, collectionServiceResolver } = await collections
  const history = [
    paid('job', today, { status: 'Cancelado', serviceJourney: { id: 'job', index: 1, total: 2 } }),
    payment('visit', '2026-10-21', { technicalStatus: 'Cancelado', serviceJourney: { id: 'job', index: 2, total: 2 } })
  ]
  const resolveService = collectionServiceResolver(history)
  const [current, future] = collectionSegments(collectionRecords(history, resolveService), { today, resolveService })
  assert.deepEqual(current.confirmed, { count: 1, total: 100 })
  assert.equal(future.records.length, 0)
})

test('missing and invalid effective dates remain current conservatively, including impossible calendar dates', async () => {
  const { collectionSegments } = await domain
  const records = ['', undefined, '2026-10-99', '2027-02-29', '2026-1-2', 'not-a-date'].map((date, index) => payment(`bad-${index}`, date))
  const [current, future] = collectionSegments(records, { today })
  assert.deepEqual(current.records, records)
  assert.deepEqual(future.records, [])
  const [unknownCurrent, unknownFuture] = collectionSegments([payment('later', '2026-12-01')], { today: '2026-02-30' })
  assert.equal(unknownCurrent.records.length, 1)
  assert.equal(unknownFuture.records.length, 0)
  const [leapCurrent, leapFuture] = collectionSegments([payment('leap', '2028-02-29')], { today: '2028-02-28' })
  assert.equal(leapCurrent.records.length, 0)
  assert.equal(leapFuture.records.length, 1)
})

test('classification preserves input order and object references with one resolver call per record and no mutation', async () => {
  const { collectionSegments } = await domain
  const records = [paid('later-first', '2026-10-23'), payment('current', today), payment('later-second', '2026-10-21')]
  const snapshot = structuredClone(records)
  const calls = []
  const result = collectionSegments(records, { today, resolveService: record => { calls.push(record); return record } })
  assert.deepEqual(calls, records)
  assert.deepEqual(result[1].records.map(record => record.id), ['later-first', 'later-second'])
  assert.equal(result[1].records[0], records[0])
  assert.equal(result[0].records[0], records[1])
  assert.deepEqual(records, snapshot)
})

test('empty segments and cent totals stay finite without hiding records with malformed legacy amounts', async () => {
  const { collectionSegments } = await domain
  const empty = collectionSegments([], { today })
  assert.deepEqual(empty, ['current', 'future'].map(id => ({ id, records: [], total: 0, pending: { count: 0, total: 0 }, confirmed: { count: 0, total: 0 } })))
  const records = [
    payment('cents-one', today, { amount: '0.10' }),
    payment('cents-two', today, { amount: '0.20' }),
    paid('large', today, { amount: '999999999.99' }),
    ...['NaN', Infinity, '-100', '', undefined].map((amount, index) => payment(`invalid-${index}`, today, { amount }))
  ]
  const [current] = collectionSegments(records, { today })
  assert.equal(current.total, 1000000000.29)
  assert.deepEqual(current.pending, { count: 7, total: .3 })
  assert.deepEqual(current.confirmed, { count: 1, total: 999999999.99 })
  assert.equal(current.records.length, records.length)
})
