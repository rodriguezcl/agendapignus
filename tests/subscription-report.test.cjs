const test = require('node:test')
const assert = require('node:assert/strict')
const { subscriptionHeaders, subscriptionColumns } = require('../api/_lib/subscription-report.cjs')
test('exporta monto, decisión y meses guardados, no el catálogo actual', () => {
  assert.equal(subscriptionHeaders.length, 3)
  assert.deepEqual(subscriptionColumns({ monthlyFee: '45000', freezeMonthlyFee: true, frozenMonths: 4 }), ['$ 45.000', 'Sí', '4'])
  assert.deepEqual(subscriptionColumns({ monthlyFee: 0, freezeMonthlyFee: false, frozenMonths: 6 }), ['$ 0', 'No', ''])
  assert.deepEqual(subscriptionColumns({}), ['', 'Sin registrar', ''])
  assert.deepEqual(subscriptionColumns({ monthlyFee: '25000' }), ['$ 25.000', 'Sin registrar', ''])
  assert.deepEqual(subscriptionColumns({ monthlyFee: '45000', freezeMonthlyFee: true, frozenMonths: 6 }, 'technician'), ['', '', ''])
})

test('moneda argentina con miles, centavos y valores ausentes', () => {
  const { formatReportCurrency } = require('../api/_lib/subscription-report.cjs')
  for (const value of [80000, '80000', '80.000', '$ 80.000']) assert.equal(formatReportCurrency(value), '$ 80.000')
  for (const value of [80000.5, '80000.50', '80.000,50']) assert.equal(formatReportCurrency(value), '$ 80.000,50')
  assert.equal(formatReportCurrency('1234567.89'), '$ 1.234.567,89')
  assert.equal(formatReportCurrency('0.01'), '$ 0,01')
  for (const value of ['', null, undefined, 'incorrecto']) assert.equal(formatReportCurrency(value), '')
})
test('ambos servidores usan las mismas columnas y ocho anchos en Excel y PDF', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  for (const file of ['api/index.js', 'server.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.ok(source.includes('includeSubscription ? subscriptionHeaders : []'))
    assert.ok(source.includes('includeSubscription ? subscriptionColumns(record,'))
    assert.ok(source.includes("const includeSubscription = !['docta', 'nobu-town'].includes(category)"))
    assert.ok(source.includes('[60, 175, 235, 110, 189]'))
    assert.ok(source.includes('[55, 125, 160, 85, 100, 95, 80, 69]'))
  }
})

test('Docta y Nobu no aplican abono ni meses congelados sin modificar el histórico', () => {
  for (const installationZone of ['docta', 'nobu-town']) {
    const record = { installationZone, monthlyFee: '45000', freezeMonthlyFee: true, frozenMonths: 6 }
    const original = { ...record }
    assert.deepEqual(subscriptionColumns(record), ['No aplica', 'No aplica', 'No aplica'])
    assert.deepEqual(subscriptionColumns({}, 'administrator', installationZone), ['No aplica', 'No aplica', 'No aplica'])
    assert.deepEqual(record, original)
  }
  assert.deepEqual(subscriptionColumns({ installationZone: 'residencial', monthlyFee: '45000', freezeMonthlyFee: true, frozenMonths: 4 }), ['$ 45.000', 'Sí', '4'])
})

test('el formulario limita abono y congelamiento a instalaciones residenciales', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/App.jsx'), 'utf8')
  assert.ok(source.includes('freezeMonthlyFee: residentialAlarm'))
  assert.ok(source.includes("(key === 'amount' || key === 'monthlyFee') && !enabled"))
})
