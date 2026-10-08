const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

for (const file of ['api/index.js', 'server.cjs']) {
  test(`${file}: exportación mensual excluye instalaciones pendientes y otros estados no completados`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    const start = file === 'api/index.js' ? 'const records = state.history.filter(record => {' : "const records = rows('work_history').filter(record => {"
    const body = source.split(start)[1].split('}).sort(compareReportRecords)')[0]
    const filter = new Function('record', 'month', 'user', 'technicianId', 'isRetirement', 'isRetirementExport', 'alarmCategory', 'alarmService', 'normalizedServiceName', 'category', 'isAllCategories', body)
    const matches = record => filter(record, '2026-10', { roleCode: 'administrator' }, null, false, false, () => 'residencial', { id: 'alarm' }, value => String(value).toLowerCase(), 'all', true)
    const base = { serviceId: 'alarm', date: '2026-10-09', client: 'PIG-6308 FRANCO GAITAN' }
    for (const status of ['Pendiente', 'En proceso', 'Cancelado', 'Reprogramado', 'Reprogramación pendiente', 'Avance registrado', undefined]) {
      assert.equal(matches({ ...base, status }), false, status)
    }
    assert.equal(matches({ ...base, status: 'Completado' }), true)
    assert.equal(matches({ ...base, status: 'Pendiente', technicalStatus: 'Completado' }), false)
    assert.equal(matches({ ...base, status: 'Completado', date: '2026-09-30' }), false)
    assert.equal(matches({ ...base, status: 'Completado', subscriberReservation: true }), false)
  })
}
