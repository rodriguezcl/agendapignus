const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')

test('equipos mensuales usa desplegable múltiple, no listado Ctrl, y conserva actualización existente', () => {
  const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const modal = source.split('{monthlySetup &&')[1].split('Guardar equipos del mes')[0]
  assert.match(modal, /<TeamTechniciansField/)
  assert.match(modal, /technicians=\{monthlyEligibleTechnicians\(activeTechs\)\}/)
  assert.match(modal, /onChange=\{memberIds => updateMonthlyTeam\(index, memberIds\)\}/)
  assert.doesNotMatch(modal, /<select multiple|tecla Ctrl/)
})

test('el selector tiene etiquetas clicables, teclado, orden alfabético y cierre seguro', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/TeamTechniciansField.jsx'), 'utf8')
  assert.match(source, /htmlFor=\{`\$\{id\}-tech-\$\{tech.id\}`\}/)
  assert.match(source, /id=\{`\$\{id\}-tech-\$\{tech.id\}`\} type="checkbox"/)
  assert.match(source, /localeCompare\(b.name, 'es'/)
  assert.match(source, /shouldDismissSelector\(root.current, event.target, event.type\)/)
  assert.match(source, /aria-expanded=\{open\}/)
  assert.match(source, /event.key === 'Escape'/)
  assert.match(source, /selected.filter\(memberId => memberId !== String\(tech.id\)\)/)
})

test('cerrado muestra resumen compacto y mantiene identificadores numéricos seleccionados', async () => {
  const esbuild = require('esbuild')
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const result = await esbuild.build({ entryPoints: [path.join(root, 'src/components/TeamTechniciansField.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], loader: { '.css': 'empty' } })
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, compiled, compiled.exports)
  const technicians = [{ id: 1, name: 'Santos Diaz' }, { id: '2', name: 'Leonardo Rivadero' }]
  const html = renderToStaticMarkup(React.createElement(compiled.exports.default, { label: 'Equipo 1', technicians, memberIds: [1, '2'], onChange: () => {} }))
  assert.match(html, /Santos Diaz \/ Leonardo Rivadero/)
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /type="checkbox"|<select/)
  const empty = renderToStaticMarkup(React.createElement(compiled.exports.default, { label: 'Equipo 2', technicians, onChange: () => {} }))
  assert.match(empty, /Seleccionar técnicos/)
})
