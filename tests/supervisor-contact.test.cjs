const test = require('node:test')
const assert = require('node:assert/strict')
const { setSupervisorContact } = require('../api/_lib/supervisor-contact.cjs')
const { preserveCustomerTrackingFlags } = require('../api/_lib/customer-import.cjs')
const user = { roleCode: 'supervisor' }
const state = {
  customers: [{ customerId: 'c1', account: 'PIG-1', cctvService: true, cctvRequirement: 'Requiere llave de ingreso' }, { customerId: 'c2', cctvService: false }],
  history: [{ id: 'h1', customerId: 'c1', status: 'Pendiente', internalNote: 'privado', amount: 300 }, { id: 'h2', customerId: 'c2' }, { id: 'h3', clientAccount: 'PIG-1' }]
}
test('contacto se tilda y destilda por servicio sin cambiar estado ni información privada', () => {
  const marked = setSupervisorContact(state, user, { recordId: 'h1', contactedOk: true })
  assert.deepEqual(marked.next, { ...state.history[0], contactedOk: true })
  assert.equal(marked.state.history[2].contactedOk, undefined)
  assert.equal(state.history[0].contactedOk, undefined)
  const cleared = setSupervisorContact(marked.state, user, { recordId: 'h1', contactedOk: false })
  assert.equal(cleared.next.contactedOk, false)
  assert.equal(setSupervisorContact(state, user, { recordId: 'h3', contactedOk: true }).next.contactedOk, true)
})
test('contacto rechaza cuentas fuera del alcance, roles ajenos y cambios adicionales', () => {
  for (const recordId of ['h2', 'missing']) assert.throws(() => setSupervisorContact(state, user, { recordId, contactedOk: true }), { statusCode: 403 })
  assert.throws(() => setSupervisorContact(state, { roleCode: 'operator' }, { recordId: 'h1', contactedOk: true }), { statusCode: 403 })
  for (const command of [{ recordId: 'h1', contactedOk: 'true' }, { recordId: 'h1', contactedOk: true, status: 'Completado' }]) assert.throws(() => setSupervisorContact(state, user, command), { statusCode: 400 })
  const untracked = { ...state, customers: state.customers.map(c => ({ ...c, cctvService: false })) }
  assert.throws(() => setSupervisorContact(untracked, user, { recordId: 'h1', contactedOk: true }), { statusCode: 403 })
})
test('importar conserva el requerimiento local y no acepta el de la planilla', () => {
  const result = preserveCustomerTrackingFlags(state.customers, [{ ...state.customers[0], cctvRequirement: 'Otro' }])
  assert.equal(result[0].cctvRequirement, 'Requiere llave de ingreso')
})
test('rol granular con alcance CCTV puede registrar contacto dentro de su lectura', () => {
  const granular = { roleCode: 'custom', permissions: { __catalogV2: true, 'history.view': true, 'records.read': true, 'scope.services.read.cctv': true } }
  assert.equal(setSupervisorContact(state, granular, { recordId: 'h1', contactedOk: true }).next.contactedOk, true)
  assert.throws(() => setSupervisorContact(state, { ...granular, permissions: { ...granular.permissions, 'records.read': false } }, { recordId: 'h1', contactedOk: true }), { statusCode: 403 })
})
