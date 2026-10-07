const test = require('node:test')
const assert = require('node:assert/strict')

test('reinstalaciones no son altas, con catálogo o como registros históricos', async () => {
  const { isAlarmInstallationRecord: alarm, isInstallationRecord: installation } = await import('../src/domain/services/installation-metrics.mjs')
  for (const name of ['Reinstalación de alarma', 'REINSTALACION DE ALARMA']) {
    const record = { serviceId: 2, service: name }
    for (const catalog of [[], [{ id: 2, name, category: 'installation' }]]) {
      assert.equal(alarm(record, catalog), false)
      assert.equal(installation(record, catalog), false)
    }
  }
  assert.equal(alarm({ service: 'Instalación de alarma' }), true)
  assert.equal(alarm({ service: 'Instalación de cámaras' }), false)
  assert.equal(installation({ service: 'Instalación de cámaras' }), true)
  assert.equal(alarm({ service: 'Instalación de alarma', subscriberReservation: true }), false)
})

test('multiservicio y acumulado anual excluyen reinstalaciones sin perder trabajos', async () => {
  const { isAlarmInstallationRecord: alarm } = await import('../src/domain/services/installation-metrics.mjs')
  const { countYearToDateAlarmInstallations } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  const records = [
    { serviceTypes: [{ name: 'Reinstalación de alarma' }, { name: 'Service de cámaras' }] },
    { serviceTypes: [{ name: 'Reinstalación de alarma' }, { name: 'Instalación de alarma' }] }
  ].map(record => ({ ...record, date: '2026-10-07', status: 'Completado' }))
  assert.equal(records.filter(record => alarm(record)).length, 1)
  assert.equal(countYearToDateAlarmInstallations(records, { throughDate: '2026-10-07', zone: 'docta', zoneOf: () => 'docta', isAlarmRecord: record => alarm(record) }), 1)
  assert.equal(records.length, 2)
})
