const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleStateForUser, userCan } = require('../api/_lib/core.cjs')
const { mapCustomer } = require('../api/_lib/subscriber-map-access.cjs')
const subscriber = (id, extra = {}) => ({ customerId: id, account: `PIG-${id}`, kind: 'subscriber', name: `Abonado ${id}`, locality: 'Córdoba - B° CENTRO', fields: { 'Ubicación de la cuenta': '-31.416,-64.183' }, ...extra })

test('el padrón cartográfico excluye clientes y bajas, deduplica cuentas sin fusionar domicilios compartidos', async () => {
  const { subscriberMapRows, groupMapLocations } = await import('../src/domain/customers/subscriber-map.mjs')
  const customers = [subscriber('1'), subscriber('2'), subscriber('duplicate', { account: ' pig-1 ' }), subscriber('3', { kind: 'client' }), subscriber('4', { subscriptionEndedAt: '2026-10-01' }), subscriber('5', { status: 'Inactivo' }), { customerId: 'client', account: 'CLI-1' }]
  const before = structuredClone(customers), rows = subscriberMapRows(customers)
  assert.equal(rows.length, 2)
  assert.equal(groupMapLocations(rows).length, 1)
  assert.equal(groupMapLocations(rows)[0].rows.length, 2)
  assert.deepEqual(customers, before)
})

test('coordenadas válidas, direcciones sin coordenadas y referencias Docta nunca se presentan como puntos exactos', async () => {
  const { subscriberMapLocation } = await import('../src/domain/customers/subscriber-map.mjs')
  assert.equal(subscriberMapLocation(subscriber('1')).quality, 'coordinates')
  for (const raw of ['0,0', '91,-64', '-31,181', 'NaN,NaN', 'Av. Colón 1000', 'https://maps.google.com', '']) {
    const result = subscriberMapLocation(subscriber('2', { fields: { 'Ubicación de la cuenta': raw } }))
    assert.equal(result.quality, 'missing'); assert.equal(result.coordinates, undefined)
  }
  const docta = subscriberMapLocation(subscriber('3', { address: 'Manzana 28 Lote 1, Córdoba - Docta', street: 'Manzana 28 Lote 1' }))
  assert.equal(docta.quality, 'block'); assert.notDeepEqual(docta.coordinates, [-31.416, -64.183])
  assert.equal(subscriberMapLocation(subscriber('4', { address: 'Manzana 26 Lote 1, Córdoba - Docta' })).quality, 'approximate')
  assert.equal(subscriberMapLocation(subscriber('5', { address: 'Docta sin manzana' })).quality, 'missing')
})

test('filtra zona, ciudad, barrio, búsqueda sin tildes y calidad sin perder las cuentas pendientes', async () => {
  const { subscriberMapRows, filterSubscriberMap } = await import('../src/domain/customers/subscriber-map.mjs')
  const rows = subscriberMapRows([subscriber('1', { name: 'María' }), subscriber('2', { locality: 'Nobu Town', fields: {} }), subscriber('3', { address: 'Manzana 28 Lote 1 Córdoba Docta' })])
  assert.equal(filterSubscriberMap(rows, { search: 'maria', city: 'Córdoba', neighborhood: 'CENTRO' }).length, 1)
  assert.equal(filterSubscriberMap(rows, { zone: 'nobu-town', quality: 'generic' }).length, 1)
  assert.equal(filterSubscriberMap(rows, { quality: 'located' }).length, 3)
  assert.equal(filterSubscriberMap(rows, { zone: 'docta' })[0].quality, 'block')
})

test('Mapa es opt-in fuera de Administración; no habilita información sensible ni escritura', async () => {
  const { resolvedRolePermissions } = await import('../src/domain/access/permissions.mjs')
  assert.equal(resolvedRolePermissions({ name: 'Administrador' }).map, true)
  for (const name of ['Usuario', 'Técnico', 'Operador', 'Supervisor']) assert.equal(resolvedRolePermissions({ name }).map, false)
  assert.equal(resolvedRolePermissions({ name: 'Comercial', permissions: { map: true } }).map, true)
  const customer = subscriber('1', { phone: 'private', password: 'secret', fields: { 'Ubicación de la cuenta': '-31.416,-64.183', Clave: 'secret', IMEI: 'private' } })
  const state = { revision: 1, roles: [], employees: [], vehicles: [], services: [], history: [], customers: [customer], agenda: {}, preferences: {} }
  const user = { roleCode: 'user', permissions: { map: true } }
  const visible = visibleStateForUser(state, user)
  assert.deepEqual(visible.customers, [mapCustomer(customer)])
  assert.equal(JSON.stringify(visible).includes('secret'), false)
  assert.equal(JSON.stringify(visible).includes('private'), false)
  assert.equal(userCan(user, 'accountsEdit'), false)
  assert.deepEqual(visibleStateForUser(state, { roleCode: 'user', permissions: {} }).customers, [])
})
