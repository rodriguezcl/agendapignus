const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { buildSync } = require('esbuild')

test('supervisor abre detalle con mapa sin perder lectura restringida; admite clientes ausentes', () => {
  const root = path.resolve(__dirname, '..')
  let source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const start = source.indexOf('function HistoryReadOnly(')
  const end = source.indexOf('\nfunction ', start + 1)
  const component = source.slice(start, end)
  // Seed the state that clicking Ver detalle sets, keeping the real prop chain.
  assert.ok(component.includes("const [detail, setDetail] = useState(null)"))
  source = source.slice(0, start) + component.replace('const [detail, setDetail] = useState(null)', 'const [detail, setDetail] = useState(history[0] || null)') + source.slice(end)
  const bundle = buildSync({ stdin: { contents: source + '\nexport { History };', loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'test-supervisor-render.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, compiled.filename || path.join(root, 'test-supervisor-render.cjs'))
  const record = { id: 'test', customerId: 'customer', clientAccount: 'PIG-0100', client: 'PIG-0100 CCTV', date: '2026-10-07', time: '09:00', service: 'Service de cámaras', status: 'Completado', technicians: ['Técnico'], internalNote: 'NOTA PRIVADA DE PRUEBA' }
  const props = { history: [record], authUser: { roleCode: 'supervisor' }, canManage: false }
  const html = renderToStaticMarkup(React.createElement(compiled.exports.History, { ...props, customers: [{ customerId: 'customer', account: 'PIG-0100', address: 'San Martín 100, Córdoba' }] }))
  assert.match(html, /Seguimiento de CCTV/)
  assert.match(html, /<iframe/)
  assert.doesNotMatch(html, /NOTA PRIVADA DE PRUEBA/)
  assert.doesNotMatch(html, /Guardar cambios|Eliminar servicio/)
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(compiled.exports.History, props)))
})
