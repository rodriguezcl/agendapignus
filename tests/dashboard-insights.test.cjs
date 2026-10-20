const test = require('node:test')
const assert = require('node:assert/strict')

async function helpers() {
  const model = await import('../src/domain/dashboard/dashboard-insights.mjs')
  const { isAlarmInstallationRecord } = await import('../src/domain/services/installation-metrics.mjs')
  const { isEquipmentRetirementRecord } = await import('../src/domain/services/equipment-retirement.mjs')
  return {
    ...model,
    options: {
      month: '2026-10', today: '2026-10-20',
      isAlarmRecord: record => isAlarmInstallationRecord(record),
      zoneOf: record => record.installationZone || 'residencial',
      isRetirementRecord: isEquipmentRetirementRecord
    }
  }
}

const alarm = (date, extra = {}) => ({ date, status: 'Completado', service: 'Instalación de alarma', ...extra })
const retirement = (date, extra = {}) => alarm(date, { service: 'Retiro de equipo', ...extra })

test('net projection shares completed alarm and retirement rules, counts multi-service work once, and ignores future work', async () => {
  const { dashboardNetProjection, options } = await helpers()
  const records = [
    alarm('2026-10-01'),
    alarm('2026-10-05', { serviceTypes: [{ name: 'Instalación de alarma' }, { name: 'Instalación de cámaras' }] }),
    retirement('2026-10-07', { serviceTypes: [{ name: 'Retiro de equipo' }, { name: 'Retiro de equipos' }] }),
    alarm('2026-10-08', { installationZone: 'no-monitoreada' }),
    alarm('2026-10-09', { subscriberReservation: true }),
    alarm('2026-10-10', { status: 'Pendiente' }),
    alarm('2026-10-11', { status: 'Requiere revisión', technicalStatus: 'Completado' }),
    alarm('2026-10-12', { status: 'Avance registrado' }),
    alarm('2026-10-13', { service: 'Reinstalación de alarma' }),
    alarm('2026-10-14', { service: 'Instalación de cámaras' }),
    retirement('2026-10-15', { service: 'Retiro de materiales en proveedor' }),
    alarm('2026-10-21'),
    alarm('2026-09-04'), alarm('2026-09-05'), retirement('2026-09-08')
  ]
  const before = structuredClone(records)
  const model = dashboardNetProjection(records, options)
  assert.equal(model.installations, 2)
  assert.equal(model.retirements, 1)
  assert.equal(model.netGrowth, 1)
  assert.equal(model.businessDays, 22)
  assert.equal(model.elapsedBusinessDays, 14)
  assert.equal(model.projectedNetGrowth, 2)
  assert.equal(model.previousMonth, '2026-09')
  assert.equal(model.previousNetGrowth, 1)
  assert.equal(model.variation, 100)
  assert.equal(model.actual.length, 21)
  assert.deepEqual(model.actual[0], { date: '2026-09-30', day: 0, value: 0 })
  assert.deepEqual(model.actual.at(-1), { date: '2026-10-20', day: 20, value: 1 })
  assert.deepEqual(model.projected[0], model.actual.at(-1))
  assert.equal(model.projected.at(-1).value, 2)
  assert.equal(model.hasData, true)
  assert.deepEqual(records, before)
})

test('estimated series follows weekdays, includes observed weekend work, and agrees with the rounded closing estimate', async () => {
  const { dashboardNetProjection, options } = await helpers()
  const records = Array.from({ length: 5 }, () => alarm('2026-10-01')).concat(alarm('2026-10-03'))
  const model = dashboardNetProjection(records, { ...options, today: '2026-10-04' })
  assert.equal(model.elapsedBusinessDays, 2)
  assert.equal(model.dailyAverage, 3)
  assert.equal(model.projectedNetGrowth, 66)
  assert.equal(model.actual.at(-1).value, 6)
  assert.equal(model.projected.find(point => point.day === 5).value, 9)
  assert.equal(model.projected.find(point => point.day === 9).value, 21)
  assert.equal(model.projected.find(point => point.day === 10).value, 21)
  assert.equal(model.projected.find(point => point.day === 11).value, 21)
  assert.equal(model.projected.at(-1).value, model.projectedNetGrowth)
})

test('past periods show final results while future periods cannot present an estimate or an observed curve', async () => {
  const { dashboardNetProjection, options } = await helpers()
  const past = dashboardNetProjection([alarm('2026-09-30'), retirement('2026-09-06'), retirement('2026-09-07')], { ...options, month: '2026-09' })
  assert.equal(past.period, 'past')
  assert.equal(past.elapsedDays, 30)
  assert.equal(past.elapsedBusinessDays, past.businessDays)
  assert.equal(past.projectedNetGrowth, -1)
  assert.equal(past.actual.at(-1).value, -1)
  assert.deepEqual(past.projected, [])
  const future = dashboardNetProjection([alarm('2026-11-05')], { ...options, month: '2026-11' })
  assert.equal(future.period, 'future')
  assert.equal(future.elapsedDays, 0)
  assert.equal(future.netGrowth, 0)
  assert.equal(future.projectedNetGrowth, null)
  assert.equal(future.variation, null)
  assert.deepEqual(future.actual, [])
  assert.deepEqual(future.projected, [])
})

test('no elapsed business days, empty work, leap years and month boundaries remain explicit and finite', async () => {
  const { dashboardNetProjection, options } = await helpers()
  const weekendStart = dashboardNetProjection([alarm('2026-08-01')], { ...options, month: '2026-08', today: '2026-08-02' })
  assert.equal(weekendStart.netGrowth, 1)
  assert.equal(weekendStart.elapsedBusinessDays, 0)
  assert.equal(weekendStart.projectedNetGrowth, null)
  assert.equal(weekendStart.dailyAverage, null)
  assert.deepEqual(weekendStart.projected, [])
  const empty = dashboardNetProjection([], options)
  assert.equal(empty.netGrowth, 0)
  assert.equal(empty.projectedNetGrowth, 0)
  assert.equal(empty.hasData, false)
  assert(empty.actual.concat(empty.projected).every(point => point.value === 0))
  assert.deepEqual(empty.axis, { min: 0, max: 1, step: 1, ticks: [0, 1] })
  const leap = dashboardNetProjection([alarm('2024-02-29')], { ...options, month: '2024-02' })
  assert.equal(leap.daysInMonth, 29)
  assert.equal(leap.netGrowth, 1)
  const january = dashboardNetProjection([alarm('2025-12-31')], { ...options, month: '2026-01' })
  assert.equal(january.previousMonth, '2025-12')
  assert.equal(january.previousNetGrowth, 1)
})

test('negative and zero balances retain their sign, a zero axis and meaningful comparisons', async () => {
  const { dashboardNetProjection, netProjectionAxis, options } = await helpers()
  const model = dashboardNetProjection([retirement('2026-10-01'), retirement('2026-10-02'), retirement('2026-09-02')], options)
  assert.equal(model.netGrowth, -2)
  assert.equal(model.projectedNetGrowth, -3)
  assert.equal(model.variation, -200)
  assert.equal(model.axis.max, 0)
  assert(model.axis.min <= -3)
  assert(model.axis.ticks.includes(0))
  const offset = dashboardNetProjection([alarm('2026-10-01'), retirement('2026-10-02')], options)
  assert.equal(offset.netGrowth, 0)
  assert.equal(offset.hasData, true)
  assert.equal(offset.actual.find(point => point.day === 1).value, 1)
  assert.equal(offset.actual.find(point => point.day === 2).value, 0)
  for (const values of [[-13, 7], [-1], [1], [NaN, Infinity], [-2500, 400]]) {
    const axis = netProjectionAxis(values)
    assert(axis.ticks.includes(0))
    assert(axis.ticks.every(Number.isInteger))
    assert(axis.min < axis.max)
    for (const value of values.filter(Number.isFinite)) assert(value >= axis.min && value <= axis.max)
  }
})

test('invalid dates and periods cannot contaminate the chart or count impossible completion dates', async () => {
  const { dashboardNetProjection, options } = await helpers()
  const model = dashboardNetProjection([alarm('2026-10-99'), alarm('2026-10-1'), alarm('2026-10-01T12:00:00Z'), alarm('2026-02-30')], options)
  assert.equal(model.hasData, false)
  for (const patch of [{ month: '' }, { month: '2026-13' }, { today: '2026-02-30' }, { today: 'invalid' }]) {
    const invalid = dashboardNetProjection([alarm('2026-10-01')], { ...options, ...patch })
    assert.equal(invalid.period, 'invalid')
    assert.equal(invalid.projectedNetGrowth, null)
    assert.deepEqual(invalid.actual, [])
    assert.deepEqual(invalid.projected, [])
  }
})

test('composition distinguishes completed works from their service occurrences and keeps donut shares complete', async () => {
  const { buildWorkComposition } = await helpers()
  const records = [
    alarm('2026-10-01', { serviceTypes: [{ name: 'Instalación de alarma' }, { name: 'Instalación de cámaras' }] }),
    alarm('2026-10-02'),
    alarm('2026-10-03', { service: '' }),
    alarm('2026-10-04', { status: 'Pendiente' }),
    alarm('2026-10-05', { status: 'Requiere revisión', technicalStatus: 'Completado' }),
    alarm('2026-10-06', { status: 'Avance registrado' })
  ]
  const before = structuredClone(records)
  const model = buildWorkComposition(records)
  assert.equal(model.workCount, 3)
  assert.equal(model.serviceCount, 4)
  assert.equal(model.hasMultipleServices, true)
  assert.deepEqual(model.items.map(({ name, count, percentage }) => [name, count, percentage]), [
    ['Instalación de alarma', 2, 50],
    ['Instalación de cámaras', 1, 25],
    ['Sin especificar', 1, 25]
  ])
  assert.equal(model.items.reduce((sum, item) => sum + item.share, 0), 1)
  assert.deepEqual(records, before)
})

test('composition handles unknown labels safely and empty completed work without invalid percentages', async () => {
  const { buildWorkComposition } = await helpers()
  assert.deepEqual(buildWorkComposition([]), { workCount: 0, serviceCount: 0, items: [], hasMultipleServices: false })
  const model = buildWorkComposition([
    alarm('2026-10-01', { serviceTypes: [{ name: '   ' }] }),
    alarm('2026-10-02', { service: '__proto__' }),
    alarm('2026-10-03', { service: 'constructor' })
  ])
  assert.equal(model.workCount, 3)
  assert.equal(model.serviceCount, 3)
  assert.equal(model.hasMultipleServices, false)
  assert.equal(model.items.find(item => item.name === '__proto__').count, 1)
  assert(model.items.every(item => Number.isFinite(item.percentage)))
})
