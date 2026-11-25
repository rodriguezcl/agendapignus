const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const { parseDocument } = require('htmlparser2')
let components
const noop = () => {}
const roles = [{ id: 'tech', name: 'Técnico', code: 'technician' }, { id: 'user', name: 'Usuario', code: 'user' }]
test.before(() => {
  const root = path.resolve(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'src/features/employees/presentation/Employees.jsx'), 'utf8')
  const bundled = require('esbuild').buildSync({ stdin: { contents: `${source}\nexport { EmployeeForm, newEmployeeForm };`, loader: 'jsx', resolveDir: path.join(root, 'src/features/employees/presentation') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'employee-guard-ui-render.cjs'), module)
  compiled.paths = module.paths; compiled._compile(bundled.outputFiles[0].text, compiled.id); components = compiled.exports
})
function nodes(node, predicate) { return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))] }
function render(form, editing = null) {
  const html = renderToStaticMarkup(React.createElement(components.EmployeeForm, { form: { roleId: 'tech', ...form }, roles, editing, setForm: noop, save: noop, cancel: noop }))
  const document = parseDocument(html)
  const date = nodes(document, node => node.name === 'input' && node.attribs?.type === 'date')[0]
  assert.ok(date)
  return { html, date }
}
test('el alta propone la fecha local de ingreso y muestra la habilitación a los 60 días', () => {
  assert.equal(components.newEmployeeForm().employmentStartDate, new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const { html, date } = render({ employmentStartDate: '2026-11-25' })
  assert.equal(date.attribs.value, '2026-11-25')
  assert.ok(Object.hasOwn(date.attribs, 'required'))
  assert.equal(Object.hasOwn(date.attribs, 'disabled'), false)
  assert.match(html, /Guardias habilitadas desde el 24\/01\/2027/)
})
test('editar un colaborador anterior sin fecha no inventa un ingreso ni exige cargarlo', () => {
  const { html, date } = render({}, 'legacy')
  assert.equal(date.attribs.value, '')
  assert.equal(Object.hasOwn(date.attribs, 'required'), false)
  assert.match(html, /se conserva su habilitación actual de guardias/)
})
test('la fecha de ingreso se conserva para otros perfiles sin anunciar guardias', () => {
  const { html, date } = render({ roleId: 'user', employmentStartDate: '2026-11-25' }, 'user')
  assert.equal(date.attribs.value, '2026-11-25')
  assert.doesNotMatch(html, /Guardias habilitadas desde/)
})
