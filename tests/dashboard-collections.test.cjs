const test = require('node:test')
const assert = require('node:assert/strict')
const model = import('../src/domain/dashboard/collection-chart-model.mjs')
const options = { month: '2026-10', today: '2026-10-20' }
const payment = (id, date, extra = {}) => ({ id, date, status: 'Pendiente', amount: '100', paymentMethod: 'A confirmar', ...extra })
const confirmed = (id, date, extra = {}) => payment(id, date, { collection: { status: 'confirmed', confirmedAt: '2026-11-02T12:00:00Z' }, ...extra })
const scopedUser = scope => ({ id: 'tech', roleCode: 'custom', permissions: { __catalogV2: true, [`scope.services.read.${scope}`]: true } })
const zero = { amount: 0, count: 0 }

test('selected service month groups confirmed, due and future amounts regardless of technical completion or confirmation month', async () => {
  const { buildCollectionOverview } = await model
  const history = [
    confirmed('paid', '2026-10-14', { amount: '125.25', status: 'Completado' }),
    payment('today', '2026-10-20', { amount: '250.10' }),
    payment('past', '2026-10-16', { amount: '80.50', status: 'Avance registrado' }),
    payment('future', '2026-10-24', { amount: '90.30' }),
    confirmed('prepaid', '2026-10-30', { amount: '25.55' }),
    payment('next-month', '2026-11-02', { amount: '900' }),
    payment('zero', '2026-10-15', { amount: '0' }),
    payment('no-method', '2026-10-15', { paymentMethod: '' }),
    payment('no-payment', '2026-10-15', { paymentMethod: 'No aplica' }),
    payment('vehicle', '2026-10-15', { vehicleControl: true })
  ]
  const before = structuredClone(history)
  const result = buildCollectionOverview(history, options)
  assert.deepEqual(result.totals, {
    confirmed: { amount: 150.80, count: 2 },
    pending: { amount: 330.60, count: 2 },
    future: { amount: 90.30, count: 1 }
  })
  assert.equal(result.hasData, true)
  assert.equal(result.trackingAvailable, true)
  assert.equal(result.coverageStart, '2026-10-14')
  assert.equal(result.weeks.find(week => week.from === '2026-10-12').confirmed.amount, 125.25)
  assert.equal(result.weeks.find(week => week.from === '2026-10-19').future.amount, 90.30)
  assert.deepEqual(history, before, 'Aggregation must not mutate records or collection metadata')
})

test('calendar weeks are Monday to Sunday, clipped to the selected month including a month starting Sunday', async () => {
  const { buildCollectionOverview } = await model
  const october = buildCollectionOverview([], options)
  assert.deepEqual(october.weeks.map(({ from, through, label }) => [from, through, label]), [
    ['2026-10-01', '2026-10-04', '1–4 oct'],
    ['2026-10-05', '2026-10-11', '5–11 oct'],
    ['2026-10-12', '2026-10-18', '12–18 oct'],
    ['2026-10-19', '2026-10-25', '19–25 oct'],
    ['2026-10-26', '2026-10-31', '26–31 oct']
  ])
  const november = buildCollectionOverview([], { ...options, month: '2026-11' })
  assert.equal(november.weeks.length, 6)
  assert.deepEqual([november.weeks[0].from, november.weeks[0].through, november.weeks[0].label], ['2026-11-01', '2026-11-01', '1 nov'])
  assert.deepEqual([november.weeks.at(-1).from, november.weeks.at(-1).through], ['2026-11-30', '2026-11-30'])
})

test('multi-day service contributes one shared amount and uses the first non-cancelled journey date', async () => {
  const { buildCollectionOverview } = await model
  const history = [1, 2, 3, 4].map(index => payment(index === 1 ? 'job' : `visit-${index}`, `2026-10-${13 + index}`, {
    amount: '1250.50',
    serviceJourney: { id: 'job', index, total: 4 }
  }))
  let result = buildCollectionOverview(history, { ...options, today: '2026-10-14' })
  assert.deepEqual(result.totals.pending, { amount: 1250.50, count: 1 })
  assert.deepEqual(result.totals.future, zero)
  history[0].status = 'Cancelado'
  result = buildCollectionOverview(history, { ...options, today: '2026-10-14' })
  assert.deepEqual(result.totals.pending, zero)
  assert.deepEqual(result.totals.future, { amount: 1250.50, count: 1 })
  history[1].date = '2026-11-05'
  history[2].technicalStatus = 'Cancelado'
  history[3].status = 'Cancelado'
  assert.equal(buildCollectionOverview(history, options).hasData, false)
  result = buildCollectionOverview(history, { ...options, month: '2026-11' })
  assert.deepEqual(result.totals.future, { amount: 1250.50, count: 1 })
})

test('cancelled pending collections disappear but confirmed money remains even when every journey was cancelled', async () => {
  const { buildCollectionOverview } = await model
  const history = [
    payment('cancelled', '2026-10-15', { status: 'Cancelado' }),
    payment('technical-cancelled', '2026-10-16', { technicalStatus: 'Cancelado' }),
    payment('corrected-cancelled', '2026-10-17', { status: 'Cancelado', collection: { status: 'pending', events: [{}] } }),
    confirmed('paid-cancelled', '2026-10-18', { status: 'Cancelado', amount: '200' }),
    confirmed('journey', '2026-10-19', { status: 'Cancelado', amount: '300', serviceJourney: { id: 'journey', index: 1, total: 2 } }),
    payment('journey-2', '2026-10-20', { status: 'Cancelado', amount: '300', serviceJourney: { id: 'journey', index: 2, total: 2 } })
  ]
  const result = buildCollectionOverview(history, options)
  assert.deepEqual(result.totals, { confirmed: { amount: 500, count: 2 }, pending: zero, future: zero })
})

test('rollout date excludes older services and their reschedules, with honest coverage for old, partial and future months', async () => {
  const { buildCollectionOverview } = await model
  const history = [
    payment('old', '2026-10-13'),
    payment('old-reschedule', '2026-10-20', { rescheduledFrom: '2026-10-10' }),
    payment('old-trace', '2026-10-21', { reschedulingHistory: [{ date: '2026-10-05' }] }),
    payment('new-reschedule', '2026-10-21', { rescheduledFrom: '2026-10-14' })
  ]
  const october = buildCollectionOverview(history, options)
  assert.deepEqual(october.totals.future, { amount: 100, count: 1 })
  assert.match(october.coverageNote, /14\/10\/2026/)
  assert.match(october.coverageNote, /cobertura completa/)
  const prior = buildCollectionOverview([payment('old', '2026-09-20')], { ...options, month: '2026-09' })
  assert.equal(prior.trackingAvailable, false)
  assert.equal(prior.hasData, false)
  assert.match(prior.coverageNote, /14\/10\/2026/)
  const future = buildCollectionOverview([payment('future', '2026-11-01')], { ...options, month: '2026-11' })
  assert.equal(future.trackingAvailable, true)
  assert.equal(future.coverageStart, '2026-11-01')
  assert.deepEqual(future.totals.future, { amount: 100, count: 1 })
  assert.equal(future.coverageNote, undefined)
})

test('explicit older collection records are preserved without claiming full historical coverage', async () => {
  const { buildCollectionOverview } = await model
  const result = buildCollectionOverview([
    confirmed('explicit', '2026-09-20', { amount: '110.25' }),
    payment('not-tracked', '2026-09-21'),
    payment('explicit-correction', '2026-09-22', { amount: '55', collection: { status: 'pending' } })
  ], { ...options, month: '2026-09' })
  assert.deepEqual(result.totals.confirmed, { amount: 110.25, count: 1 })
  assert.deepEqual(result.totals.pending, { amount: 55, count: 1 })
  assert.equal(result.trackingAvailable, true)
  assert.equal(result.hasData, true)
  assert.equal(result.coverageStart, '2026-10-14', 'Coverage start still describes the general rollout, not completeness of the exceptional records')
  assert.match(result.coverageNote, /antes de esa fecha/)
  assert.match(result.coverageNote, /no representan cobertura completa/)
})

test('scoped access requires both the owner and effective service and never changes the date by filtering away hidden siblings', async () => {
  const { buildCollectionOverview } = await model
  const user = scopedUser('assigned')
  const owner = payment('job', '2026-10-14', { status: 'Cancelado', technicianIds: ['tech'], serviceJourney: { id: 'job', index: 1, total: 3 } })
  const hiddenFirst = payment('first', '2026-10-15', { technicianIds: ['other'], serviceJourney: { id: 'job', index: 2, total: 3 } })
  const visibleLater = payment('later', '2026-10-22', { technicianIds: ['tech'], serviceJourney: { id: 'job', index: 3, total: 3 } })
  assert.equal(buildCollectionOverview([owner, hiddenFirst, visibleLater], { ...options, user }).hasData, false)
  const visibleFirst = { ...hiddenFirst, technicianIds: ['tech'] }
  const included = buildCollectionOverview([owner, visibleFirst, visibleLater], { ...options, user })
  assert.deepEqual(included.totals.pending, { amount: 100, count: 1 })
  assert.deepEqual(included.totals.future, zero)
  assert.equal(buildCollectionOverview([{ ...owner, technicianIds: ['other'] }, visibleFirst, visibleLater], { ...options, user }).hasData, false)
})

test('CCTV scope uses the current customer flag before a stale record marker, while an omitted user preserves all input records', async () => {
  const { buildCollectionOverview } = await model
  const history = [
    payment('removed', '2026-10-16', { customerId: 'old', supervisorVisible: true }),
    payment('current', '2026-10-17', { customerId: 'new', supervisorVisible: false })
  ]
  const customers = [{ customerId: 'old', cctvService: false }, { customerId: 'new', cctvService: true }]
  assert.deepEqual(buildCollectionOverview(history, { ...options, user: scopedUser('cctv'), customers }).totals.pending, { amount: 100, count: 1 })
  assert.deepEqual(buildCollectionOverview(history, options).totals.pending, { amount: 200, count: 2 })
})

test('cent totals are exact across records and weeks; invalid financial values never create NaN or negative bars', async () => {
  const { buildCollectionOverview } = await model
  const result = buildCollectionOverview([
    payment('ten-cents', '2026-10-14', { amount: '0.10' }),
    payment('twenty-cents', '2026-10-19', { amount: '0.20' }),
    payment('legacy-fraction', '2026-10-20', { amount: '1.005' }),
    confirmed('bad', '2026-10-20', { amount: 'NaN' }),
    confirmed('infinite', '2026-10-20', { amount: Infinity }),
    confirmed('negative', '2026-10-20', { amount: '-50' }),
    confirmed('zero', '2026-10-20', { amount: '0' })
  ], options)
  assert.deepEqual(result.totals.pending, { amount: 1.31, count: 3 })
  assert.deepEqual(result.totals.confirmed, zero)
  assert.equal(result.weeks.find(week => week.from === '2026-10-19').pending.amount, 1.21)
  assert.equal(Math.round(result.weeks.reduce((sum, week) => sum + week.pending.amount * 100, 0)), 131)
})

test('empty or malformed input remains finite and cannot leak records into a different month', async () => {
  const { buildCollectionOverview } = await model
  const empty = buildCollectionOverview([], options)
  assert.equal(empty.hasData, false)
  assert.deepEqual(empty.totals, { confirmed: zero, pending: zero, future: zero })
  const badDates = buildCollectionOverview([confirmed('bad-date', '2026-10-99'), confirmed('bad-format', '2026-10-1'), null], options)
  assert.equal(badDates.hasData, false)
  const badMonth = buildCollectionOverview([payment('record', '2026-10-20')], { ...options, month: '2026-13' })
  assert.equal(badMonth.trackingAvailable, false)
  assert.deepEqual(badMonth.weeks, [])
  const badToday = buildCollectionOverview([payment('record', '2026-10-20')], { ...options, today: '2026-02-30' })
  assert.equal(badToday.hasData, false)
  assert.equal(badToday.trackingAvailable, false)
})

test('shared journey resolver preserves the original service selection and collection ordering without mutating history', async () => {
  const { collectionService, collectionServiceResolver, collectionRecords, hasCollection } = await import('../src/domain/collections/collections.mjs')
  const journey = (id, group, index, date, extra = {}) => payment(id, date, { serviceJourney: { id: group, index, total: 4 }, ...extra })
  const records = [
    journey('later-index', 'job', 3, '2026-10-15'),
    journey('job', 'job', 1, '2026-10-14', { status: 'Cancelado' }),
    journey('technical-cancelled', 'job', 2, '2026-10-14', { technicalStatus: 'Cancelado' }),
    journey('first-index', 'job', 2, '2026-10-15'),
    journey('equal-first', 'tied', 2, '2026-10-17'),
    journey('equal-second', 'tied', 2, '2026-10-17'),
    journey('tied', 'tied', 1, '2026-10-18'),
    journey('number', 7, 1, '2026-10-19'),
    journey('string', '7', 1, '2026-10-20'),
    journey('all-cancelled', 'all-cancelled', 1, '2026-10-18', { status: 'Cancelado', collection: { status: 'confirmed' } }),
    journey('all-cancelled-2', 'all-cancelled', 2, '2026-10-19', { technicalStatus: 'Cancelado' }),
    payment('single', '2026-10-15'),
    payment('single-cancelled', '2026-10-15', { status: 'Cancelado' }),
    payment('same-date-late', '2026-10-15', { time: '15:30' }),
    payment('same-date-early', '2026-10-15', { time: '08:30' })
  ]
  for (const history of [records, [...records].reverse()]) {
    const before = structuredClone(history)
    const resolveService = collectionServiceResolver(history)
    for (const record of [...history, journey('absent', 'absent', 1, '2026-10-20')]) {
      assert.equal(resolveService(record), collectionService(record, history), record.id)
      assert.equal(hasCollection(record, history, resolveService), hasCollection(record, history), record.id)
    }
    const expected = collectionRecords(history, record => collectionService(record, history))
    assert.deepEqual(collectionRecords(history, resolveService), expected)
    assert.deepEqual(collectionRecords(history), expected, 'Default call must build and share the same resolver')
    assert.deepEqual(history, before)
  }
})

test('rebuilding a journey resolver reflects cancellations and rescheduling while retaining one collection owner', async () => {
  const { collectionServiceResolver, collectionRecords } = await import('../src/domain/collections/collections.mjs')
  const owner = payment('job', '2026-10-14', { serviceJourney: { id: 'job', index: 1, total: 2 } })
  const second = payment('second', '2026-10-15', { serviceJourney: { id: 'job', index: 2, total: 2 } })
  const before = [owner, second]
  assert.equal(collectionServiceResolver(before)(owner), owner)
  const after = [{ ...owner, status: 'Cancelado' }, { ...second, date: '2026-11-03' }]
  const resolveService = collectionServiceResolver(after)
  assert.equal(resolveService(after[0]), after[1])
  assert.deepEqual(collectionRecords(after, resolveService), [after[0]])
})
