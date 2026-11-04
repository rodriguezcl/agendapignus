const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleTechnicianStateForUser } = require('../api/_lib/core.cjs')
const { recordBaseMatches } = require('../api/_lib/endpoint-policy.cjs')
const { restoreHidden } = require('../api/_lib/granular-write-policy.cjs')
const state = {
  revision: 1, roles: [], employees: [], services: [], vehicles: [], agenda: null, preferences: {},
  customers: [
    { customerId: 'c1', account: 'PIG-1', cctvService: true, cctvRequirement: 'Requiere llave de ingreso', privateData: 'privado' },
    { customerId: 'c2', account: 'CLI-2', cctvService: false, cctvRequirement: 'Otro' }
  ],
  history: [
    { id: 'h1', customerId: 'c1', technicianIds: ['tech'], status: 'Pendiente' },
    { id: 'h2', clientAccount: 'PIG-1', technicianIds: ['tech'], status: 'Pendiente' },
    { id: 'h3', customerId: 'c2', technicianIds: ['tech'], customerCctvRequirement: 'valor viejo', status: 'Pendiente' },
    { id: 'h4', customerId: 'c1', technicianIds: ['other'], status: 'Pendiente' }
  ]
}
const legacy = { id: 'tech', roleCode: 'technician' }
const granular = { ...legacy, permissions: { __catalogV2: true, 'technical.view': true, 'records.read': true, 'scope.services.read.assigned': true } }
for (const [name, user] of [['legacy', legacy], ['granular', granular]]) {
  test(name + ': el técnico recibe el requerimiento vigente sólo para sus servicios visibles', () => {
    const visible = visibleTechnicianStateForUser(state, user)
    assert.deepEqual(visible.history.map(r => r.id), ['h1', 'h2', 'h3'])
    assert.equal(visible.history[0].customerCctvRequirement, 'Requiere llave de ingreso')
    assert.equal(visible.history[1].customerCctvRequirement, 'Requiere llave de ingreso')
    assert.equal(visible.history[2].customerCctvRequirement, '')
    assert.deepEqual(visible.customers, [])
    assert.equal(state.history[0].customerCctvRequirement, undefined)
    const changed = { ...state, customers: state.customers.map(c => ({ ...c, cctvRequirement: 'Otro' })) }
    assert.equal(visibleTechnicianStateForUser(changed, user).history[0].customerCctvRequirement, 'Otro')
    const disabled = { ...state, customers: state.customers.map(c => ({ ...c, cctvService: false })) }
    assert.equal(visibleTechnicianStateForUser(disabled, user).history[0].customerCctvRequirement, '')
  })
}
test('el campo derivado no genera conflictos ni se persiste desde la proyección técnica', () => {
  const current = { id: 'h1', status: 'Pendiente' }
  const visible = { ...current, customerCctvRequirement: 'Requiere llave de ingreso' }
  assert.equal(recordBaseMatches(current, visible, granular), true)
  assert.deepEqual(restoreHidden(visible, current, current), current)
})
test('el aviso se renderiza destacado y se omite sin requerimiento', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const { buildSync } = require('esbuild'), Module = require('node:module'), path = require('node:path')
  const result = buildSync({ entryPoints: [path.resolve(__dirname, '../src/components/CctvRequirement.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], loader: { '.css': 'empty' } })
  const compiled = new Module(__filename, module); compiled.paths = module.paths; compiled._compile(result.outputFiles[0].text, __filename)
  const component = compiled.exports.default
  const html = renderToStaticMarkup(React.createElement(component, { record: { customerCctvRequirement: 'Requiere llave de ingreso' } }))
  assert.match(html, /Requerimiento de CCTV/)
  assert.match(html, /Requiere llave de ingreso/)
  assert.match(html, /<aside/)
  assert.equal(renderToStaticMarkup(React.createElement(component, { record: {} })), '')
})
