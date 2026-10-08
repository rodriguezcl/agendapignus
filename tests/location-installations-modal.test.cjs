const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
let Component
test.before(async () => {
  const result = await require('esbuild').build({ entryPoints: [path.join(__dirname, '../src/components/LocationInstallationsModal.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], loader: { '.css': 'empty' } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  Component = module.exports.default
})
const records = [
  { id: 'r', date: '2026-10-08', client: 'RESIDENCIAL PRUEBA', installationZone: 'residencial', monthlyFee: '80000.50', freezeMonthlyFee: true, frozenMonths: 4 },
  { id: 'd', date: '2026-10-01', client: 'DOCTA PRUEBA', installationZone: 'docta', monthlyFee: '99999' },
  { id: 'n', date: '2026-10-02', client: 'NOBU PRUEBA', installationZone: 'nobu-town' }
]
const render = (category, data = records) => renderToStaticMarkup(React.createElement(Component, { records: data, category, label: category, month: '2026-10', zoneOf: record => record.installationZone, close() {} }))
test('general incluye tres instalaciones ordenadas y datos comerciales sólo donde aplican', () => {
  const html = render('all')
  assert.match(html, /3 instalación/)
  assert.ok(html.indexOf('DOCTA PRUEBA') < html.indexOf('NOBU PRUEBA'))
  assert.ok(html.indexOf('NOBU PRUEBA') < html.indexOf('RESIDENCIAL PRUEBA'))
  assert.match(html, /\$ 80\.000,50/)
  assert.match(html, /No aplica/)
  assert.doesNotMatch(html, /99999/)
  assert.match(html, /role="dialog"/)
})
test('Docta y Nobu omiten columnas comerciales y otros clientes', () => {
  for (const category of ['docta', 'nobu-town']) {
    const html = render(category)
    assert.match(html, /1 instalación/)
    assert.doesNotMatch(html, /Abono mensual|Meses congelados|RESIDENCIAL PRUEBA/)
  }
})
test('residenciales y período vacío se pueden consultar sin descargar', () => {
  assert.match(render('residencial'), /Abono mensual/)
  assert.doesNotMatch(render('residencial'), /DOCTA PRUEBA|NOBU PRUEBA/)
  assert.match(render('all', []), /No hay instalaciones completadas/)
})
test('dashboard abre el modal desde todas las categorías con el mismo listado y período del indicador', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8').split('function DashboardStatusView(')[1]
  assert.match(source, /setLocationDetail\('all'\)/)
  assert.match(source, /setLocationDetail\(key\)/)
  assert.match(source, /LocationInstallationsModal records=\{alarms\}/)
  assert.match(source, /month=\{month\} zoneOf=\{zoneOf\}/)
})
