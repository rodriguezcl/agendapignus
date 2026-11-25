const test = require('node:test')
const assert = require('node:assert/strict')
const access = require('../api/_lib/cctv-access.cjs')
const policy = require('../api/_lib/permission-catalog.cjs')
const endpoint = require('../api/_lib/endpoint-policy.cjs')
const actor = (roleCode, permissions) => ({ id: roleCode, name: roleCode, roleCode, ...(permissions ? { permissions: { __catalogV2: true, ...permissions } } : {}) })
const state = () => ({
  employees: [], agenda: { weekly: {} },
  customers: [
    { customerId: 'assigned', account: 'CLI-1', name: 'Asignada', cctvService: true, address: 'Dirección 123', phone: '3510000', monthlyFee: 100, fields: { 'Abono': 100 } },
    { customerId: 'other', account: 'PIG-2', name: 'Otra', cctvService: true },
    { customerId: 'off', account: 'CLI-3', name: 'Sin CCTV', cctvService: false }
  ],
  history: [{ id: 'a', customerId: 'assigned', technicianIds: ['technician'], status: 'Completado', date: '2026-01-02' }, { id: 'b', customerId: 'other', technicianIds: ['else'], status: 'Completado', date: '2026-01-02' }]
})

test('Administración y Supervisión consultan y gestionan sólo cuentas con CCTV', () => {
  for (const user of [actor('administrator'), actor('supervisor')]) {
    const current = state()
    assert.deepEqual(access.listCctvCustomers(user, current).map(c => c.customerId), ['assigned', 'other'])
    assert.equal(access.assertCctvAccess(user, current, 'assigned', { write: true }).customerId, 'assigned')
    assert.equal(access.assertCctvAccess(user, current, 'other', { download: true }).customerId, 'other')
    assert.throws(() => access.assertCctvAccess(user, current, 'off'), { statusCode: 404 })
    assert.throws(() => access.assertCctvAccess(user, current, 'unknown'), { statusCode: 404 })
  }
})

test('técnicos consultan y descargan únicamente cuentas de sus servicios visibles, nunca editan', () => {
  const user = actor('technician'), current = state()
  assert.deepEqual(access.listCctvCustomers(user, current).map(c => c.customerId), ['assigned'])
  assert.doesNotThrow(() => access.assertCctvAccess(user, current, 'assigned', { download: true }))
  assert.throws(() => access.assertCctvAccess(user, current, 'assigned', { write: true }), { statusCode: 403 })
  assert.throws(() => access.assertCctvAccess(user, current, 'other', { download: true }), { statusCode: 404 })
  current.history[0].technicianIds = ['else']
  assert.deepEqual(access.listCctvCustomers(user, current), [])
})

test('la ficha no permite saltar la agenda bloqueada ni consultar una reserva sin confirmar', () => {
  const user = actor('technician'), current = state()
  current.history = [
    { id: 'old', customerId: 'assigned', technicianIds: [user.id], date: '2020-01-02', status: 'Pendiente' },
    { id: 'future', customerId: 'other', technicianIds: [user.id], date: '2099-01-02', status: 'Pendiente' }
  ]
  assert.deepEqual(access.listCctvCustomers(user, current).map(c => c.customerId), ['assigned'])
  current.history = [{ ...current.history[1], awaitingConfirmation: true }]
  assert.deepEqual(access.listCctvCustomers(user, current), [])
})

test('desactivar cuenta o destildar CCTV revoca consulta y descarga sin importar el identificador conocido', () => {
  const current = state(), user = actor('supervisor')
  current.customers[0].cctvService = false
  assert.throws(() => access.assertCctvAccess(user, current, 'assigned', { download: true }), { statusCode: 404 })
  current.employees = [{ id: user.id, status: 'Inactivo' }]
  assert.throws(() => access.listCctvCustomers(user, current), { statusCode: 403 })
  assert.throws(() => access.assertCctvAccess(user, current, 'other'), { statusCode: 404 })
})

test('un técnico con acceso adicional a agenda tampoco consulta reservas sin confirmar', () => {
  const user = actor('technician', { 'weekly.view': true, 'records.read': true, 'technical.view': true, 'cctv.view': true, 'cctv.download': true, 'scope.services.read.assigned': true, 'scope.customers.read.all': true })
  const current = state()
  current.history = [{ id: 'reservation', customerId: 'assigned', technicianIds: [user.id], status: 'Pendiente', date: '2099-01-02', awaitingConfirmation: true }]
  assert.deepEqual(access.listCctvCustomers(user, current), [])
  current.history[0].awaitingConfirmation = false
  assert.deepEqual(access.listCctvCustomers(user, current).map(customer => customer.customerId), ['assigned'])
})

test('permisos granulares conservan las denegaciones explícitas y el alcance de cuentas', () => {
  const inherited = actor('supervisor', { 'accounts.view': true })
  assert.equal(policy.can(inherited, 'cctv.view'), true)
  const denied = actor('supervisor', { 'accounts.view': true, 'cctv.view': false })
  assert.equal(policy.can(denied, 'cctv.edit'), false)
  assert.throws(() => access.listCctvCustomers(denied, state()), { statusCode: 403 })
  const scoped = actor('custom', { 'cctv.view': true, 'cctv.download': true, 'scope.customers.read.related': true })
  const current = state(); current.history[0].technicianIds = [scoped.id]
  assert.deepEqual(access.listCctvCustomers(scoped, current).map(c => c.customerId), ['assigned'])
  assert.throws(() => access.assertCctvAccess(scoped, current, 'assigned', { write: true }), { statusCode: 403 })
  assert.doesNotThrow(() => endpoint.assertEndpointPermission(scoped, 'GET', '/cctv'))
  assert.doesNotThrow(() => endpoint.assertEndpointPermission(scoped, 'GET', '/cctv/attachments'))
  assert.throws(() => endpoint.assertEndpointPermission(scoped, 'POST', '/cctv'), { statusCode: 403 })
  assert.equal(policy.hasAnyWrite(scoped), false)
})

test('datos principales no filtran importes ni campos privados y respetan permiso de contacto', () => {
  const customer = state().customers[0]
  const adminView = access.presentCctvCustomer(customer, actor('administrator'))
  assert.equal(adminView.phone, customer.phone)
  assert.equal(adminView.monthlyFee, undefined)
  assert.equal(adminView.fields, undefined)
  const readOnly = actor('custom', { 'cctv.view': true })
  const redacted = access.presentCctvCustomer(customer, readOnly)
  assert.equal(redacted.phone, undefined)
  assert.equal(redacted.address, undefined)
  assert.equal(redacted.name, customer.name)
})

test('navegación ubica Servicios de CCTV inmediatamente debajo de Abonados y clientes', async () => {
  const { NAVIGATION_ITEMS } = await import('../src/domain/access/navigation.mjs')
  const position = NAVIGATION_ITEMS.findIndex(item => item.id === 'accounts')
  assert.equal(NAVIGATION_ITEMS[position + 1].id, 'cctv')
  assert.equal(NAVIGATION_ITEMS[position + 1].label, 'Servicios de CCTV')
})
