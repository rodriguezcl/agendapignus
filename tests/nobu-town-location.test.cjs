const test = require('node:test')
const assert = require('node:assert/strict')
const coordinates = [-31.4612923, -64.3059628]

test('reconoce Nobu Town y Nou Town en las ubicaciones y la zona registrada', async () => {
  const { isNobuTown, nobuTownLocation } = await import('../src/domain/customers/nobu-town-location.mjs')
  for (const record of [
    { locality: 'Córdoba - NOBU TOWN' }, { address: 'Nou Town lote 10' },
    { fields: { Localidad: 'Nobu Town' } }, { fields: { Calle: 'Nobu-Town lote 3' } },
    { installationZone: 'nobu-town' }, { client: 'Reserva Nobu Town' }
  ]) {
    assert.equal(isNobuTown(record), true)
    assert.deepEqual(nobuTownLocation(record).coordinates, coordinates)
    assert.match(nobuTownLocation(record).label, /genérica/)
  }
  for (const record of [{}, { locality: 'Córdoba - Centro' }, { name: 'Nobunaga' }, { street: 'Nobu Townhouse 10' }]) assert.equal(isNobuTown(record), false)
})

test('todas las cuentas del barrio usan la referencia genérica sin sobrescribir datos originales', async () => {
  const { customerLocationFields, customerMapLocation, serviceDirections } = await import('../src/domain/customers/customer-location.mjs')
  const { subscriberMapRows, groupMapLocations, filterSubscriberMap } = await import('../src/domain/customers/subscriber-map.mjs')
  const customers = [
    { customerId: 'nobu-1', account: 'PIG-1', locality: 'Nobu Town', fields: { 'Ubicación de la cuenta': '-31.3,-64.1' }, locationOverride: [-31.4, -64.2] },
    { customerId: 'nobu-2', account: 'PIG-2', locality: 'Nou Town', fields: {} },
    { customerId: 'nobu-3', account: 'PIG-3', installationZone: 'nobu-town', fields: { 'Ubicación de la cuenta': 'inválida' } }
  ]
  const before = structuredClone(customers)
  const rows = subscriberMapRows(customers)
  assert.equal(rows.length, 3)
  for (const row of rows) {
    assert.equal(row.quality, 'generic')
    assert.equal(row.zone, 'nobu-town')
    assert.deepEqual(row.coordinates, coordinates)
    assert.match(row.reason, /exacta.*no determinada/)
    assert.equal(new URL(customerMapLocation(row.customer).embedUrl).searchParams.get('q'), coordinates.join(','))
    assert.equal(new URL(serviceDirections(row.customer).url).searchParams.get('destination'), coordinates.join(','))
    assert.match(customerLocationFields(row.customer)['Ubicación de la cuenta'], /genérica/)
  }
  assert.equal(groupMapLocations(rows).length, 1)
  assert.equal(groupMapLocations(rows)[0].rows.length, 3)
  assert.equal(filterSubscriberMap(rows, { zone: 'nobu-town', quality: 'generic' }).length, 3)
  assert.deepEqual(customers, before)
})

test('las correcciones residenciales y las referencias Docta mantienen su comportamiento', async () => {
  const { subscriberMapLocation } = await import('../src/domain/customers/subscriber-map.mjs')
  const residential = subscriberMapLocation({ locality: 'Córdoba', locationOverride: [-31.4, -64.2] })
  assert.equal(residential.quality, 'coordinates')
  assert.deepEqual(residential.coordinates, [-31.4, -64.2])
  assert.equal(subscriberMapLocation({ street: 'Manzana 28 lote 1', locality: 'Córdoba - Docta' }).quality, 'block')
})
