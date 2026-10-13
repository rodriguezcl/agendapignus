const test = require('node:test')
const assert = require('node:assert/strict')

async function helpers() {
  const model = await import('../src/domain/dashboard/annual-chart-model.mjs')
  const { isAlarmInstallationRecord } = await import('../src/domain/services/installation-metrics.mjs')
  const { isEquipmentRetirementRecord } = await import('../src/domain/services/equipment-retirement.mjs')
  return {
    ...model,
    options: {
      year: '2026', today: '2026-10-13',
      isAlarmRecord: record => isAlarmInstallationRecord(record),
      zoneOf: record => record.installationZone || 'residencial',
      isRetirementRecord: isEquipmentRetirementRecord
    }
  }
}

function alarm(id, date, extra = {}) {
  return { id, date, status: 'Completado', service: 'Instalación de alarma', installationZone: 'docta', ...extra }
}

test('monthly chart retains completed alarm and retirement rules with independent positive series', async () => {
  const { annualChartMonths, annualChartModel, options } = await helpers()
  const records = [
    alarm('docta-one', '2026-01-05'),
    alarm('docta-two', '2026-01-12'),
    alarm('nobu', '2026-01-13', { installationZone: 'nobu-town' }),
    alarm('home', '2026-01-14', { installationZone: 'residencial' }),
    alarm('unmonitored', '2026-01-15', { installationZone: 'no-monitoreada' }),
    alarm('pending', '2026-01-16', { status: 'Pendiente' }),
    alarm('cancelled', '2026-01-17', { status: 'Cancelado' }),
    alarm('review', '2026-01-18', { status: 'Requiere revisión', technicalStatus: 'Completado' }),
    alarm('partial', '2026-01-19', { status: 'Avance registrado' }),
    alarm('reservation', '2026-01-20', { subscriberReservation: true }),
    alarm('reinstallation', '2026-01-21', { service: 'Reinstalación de alarma' }),
    alarm('camera', '2026-01-22', { service: 'Instalación de cámaras' }),
    alarm('retirement', '2026-01-23', { service: 'Retiro de equipo' }),
    alarm('pickup', '2026-01-24', { service: 'Retiro de materiales en proveedor' }),
    alarm('pending-retirement', '2026-01-25', { service: 'Retiro de equipo', status: 'Pendiente' }),
    alarm('february', '2026-02-12', { installationZone: 'residencial' }),
    alarm('future-month', '2026-11-01'),
    alarm('prior-year', '2025-01-05')
  ]
  const before = structuredClone(records)
  const months = annualChartMonths(records, options)
  assert.equal(months.length, 10)
  assert.deepEqual(months[0], {key:'2026-01',label:'Ene',value:4,locations:{docta:2,'nobu-town':1,residencial:1},retirements:1})
  assert.equal(months[1].locations.residencial, 1)
  assert.equal(months[9].value, 0)
  const chart = annualChartModel(months)
  assert.deepEqual(chart.series.map(({key,values}) => [key, values[0]]), [['docta',2],['nobu-town',1],['residencial',1],['retirements',1]])
  assert.equal(chart.axis.max, 2, 'Axis measures individual series rather than the stacked total of four installations')
  assert.equal(chart.hasData, true)
  assert.deepEqual(records, before, 'Aggregation must not modify history')
})

test('elapsed months depend on year rather than the dashboard selected month, preserving older and future year behavior', async () => {
  const { annualChartMonths, options } = await helpers()
  assert.deepEqual(annualChartMonths([], {...options,today:'2026-01-01'}).map(item => item.label), ['Ene'])
  assert.equal(annualChartMonths([], {...options,today:'2026-12-31'}).length, 12)
  const previous = annualChartMonths([alarm('past', '2025-12-31')], {...options,year:'2025'})
  assert.equal(previous.length, 12)
  assert.equal(previous[11].locations.docta, 1)
  assert.deepEqual(annualChartMonths([alarm('future', '2027-01-01')], {...options,year:'2027'}), [])
  assert.deepEqual(annualChartMonths([], {...options,year:'not-a-year'}), [])
  assert.deepEqual(annualChartMonths([], {...options,today:''}), [])
})

test('each multi-service record counts once per applicable series and configured alarm codes are honored', async () => {
  const { annualChartMonths, options } = await helpers()
  const { isAlarmInstallationRecord } = await import('../src/domain/services/installation-metrics.mjs')
  const records = [
    alarm('multi', '2026-03-08', {serviceTypes:[{name:'Instalación de alarma'},{name:'Instalación de cámaras'}]}),
    alarm('renamed', '2026-03-09', {service:'Alta de monitoreo',serviceId:'alarm-type',serviceTypes:[{id:'alarm-type',name:'Alta de monitoreo'}],installationZone:'nobu-town'}),
    alarm('multiple-retirements', '2026-03-10', {serviceTypes:[{name:'Retiro de equipo'},{name:'Retiro de equipos'}]})
  ]
  const months = annualChartMonths(records, {...options,isAlarmRecord:record => isAlarmInstallationRecord(record,[{id:'alarm-type',name:'Alta de monitoreo',code:'alarm-installation'}])})
  assert.deepEqual(months[2].locations, {docta:1,'nobu-town':1,residencial:0})
  assert.equal(months[2].retirements, 1)
})

test('quantity axis is readable, integer, nonnegative and covers the largest independent value', async () => {
  const { annualChartAxis } = await helpers()
  assert.deepEqual(annualChartAxis(0), {min:0,max:1,step:1,ticks:[0,1]})
  assert.deepEqual(annualChartAxis(1), {min:0,max:1,step:1,ticks:[0,1]})
  assert.deepEqual(annualChartAxis(17), {min:0,max:20,step:5,ticks:[0,5,10,15,20]})
  assert.deepEqual(annualChartAxis(98), {min:0,max:100,step:50,ticks:[0,50,100]})
  for (const maximum of [1,2,3,7,11,17,31,89,301,1720,10000]) {
    const axis = annualChartAxis(maximum)
    assert(axis.max >= maximum)
    assert(axis.ticks.every(Number.isInteger))
    assert(axis.ticks.every(value => value >= 0))
    assert.equal(axis.ticks[0], 0)
    assert.equal(axis.ticks.at(-1), axis.max)
    assert(axis.ticks.length <= 5)
  }
})

test('empty or malformed values cannot create negative retirement areas or invalid SVG scales', async () => {
  const { annualChartModel } = await helpers()
  const months = [{key:'2026-01',label:'Ene',value:12,locations:{docta:0,'nobu-town':NaN,residencial:Infinity},retirements:-4}]
  const chart = annualChartModel(months)
  assert.equal(chart.hasData, false)
  assert.deepEqual(chart.series.map(item => item.values), [[0],[0],[0],[0]])
  assert.equal(chart.axis.max, 1)
  assert.equal(months[0].retirements, -4, 'Normalization returns new objects')
  const empty = annualChartModel([])
  assert.equal(empty.hasData, false)
  assert.equal(empty.months.length, 0)
  assert.equal(empty.series.length, 4)
  assert.equal(empty.axis.max, 1)
})
