const test = require('node:test')
const assert = require('node:assert/strict')
const { preserveCustomerTrackingFlags } = require('../api/_lib/customer-import.cjs')
const { mapCustomer } = require('../api/_lib/subscriber-map-access.cjs')
const original = { customerId: 'coord-1', kind: 'subscriber', account: 'PIG-8000', name: 'PRUEBA', street: 'San Martín 100', locality: 'Córdoba', fields: { 'Ubicación de la cuenta': '-31.4,-64.2' } }

test('corrige con coma o punto decimal sin modificar los datos importados', async () => {
  const { applyCustomerCoordinateDraft, customerCoordinates } = await import('../src/domain/customers/customer-coordinates.mjs')
  const { customerMapLocation, customerLocationFields } = await import('../src/domain/customers/customer-location.mjs')
  const { subscriberMapLocation } = await import('../src/domain/customers/subscriber-map.mjs')
  const corrected = applyCustomerCoordinateDraft({ ...original, coordinateDraft: { latitude: '-31,4567', longitude: ' -64.2345 ' } })
  assert.deepEqual(corrected.locationOverride, [-31.4567, -64.2345])
  assert.equal(corrected.coordinateDraft, undefined)
  assert.deepEqual(corrected.fields, original.fields)
  assert.deepEqual(customerCoordinates(corrected), corrected.locationOverride)
  assert.deepEqual(subscriberMapLocation(corrected).coordinates, corrected.locationOverride)
  assert.equal(new URL(customerMapLocation(corrected).url).searchParams.get('query'), '-31.4567,-64.2345')
  assert.match(customerLocationFields(corrected)['Ubicación de la cuenta'], /-31.4567, -64.2345/)
  assert.deepEqual(customerCoordinates(mapCustomer(corrected)), corrected.locationOverride)
})

test('rechaza coordenadas incompletas, inválidas y fuera de rango', async () => {
  const { applyCustomerCoordinateDraft, customerCoordinates } = await import('../src/domain/customers/customer-coordinates.mjs')
  for (const [latitude, longitude] of [['', '-64'], ['-31', ''], ['85.1', '-64'], ['91', '-64'], ['-31', '181'], ['NaN', '4'], ['0', '0'], ['-31,4,5', '-64'], ['1e2', '-64'], ['Infinity', '2']]) {
    assert.throws(() => applyCustomerCoordinateDraft({ ...original, coordinateDraft: { latitude, longitude } }))
  }
  assert.deepEqual(applyCustomerCoordinateDraft(original), original)
  assert.deepEqual(customerCoordinates({ ...original, locationOverride: ['invalid', 8] }), [-31.4, -64.2])
})

test('la importación conserva la corrección actual aunque un cliente envíe datos desactualizados', async () => {
  const { mergeImportedCustomers } = await import('../src/domain/customers/customer-import.mjs')
  const current = { ...original, locationOverride: [-31.4567, -64.2345] }
  const imported = { ...original, fields: { 'Ubicación de la cuenta': '-31.5,-64.3' } }
  const merged = mergeImportedCustomers([current], [imported], () => 'unused').customers
  assert.deepEqual(merged[0].locationOverride, current.locationOverride)
  const saved = preserveCustomerTrackingFlags([current], [imported])
  assert.deepEqual(saved[0].locationOverride, current.locationOverride)
  assert.deepEqual(saved[0].fields, imported.fields)
  // A stale import must not resurrect a manual correction that was restored.
  assert.equal(preserveCustomerTrackingFlags([original], [current])[0].locationOverride, undefined)
})

test('Docta conserva su referencia por manzana incluso si existen correcciones antiguas', async () => {
  const { customerMapLocation } = await import('../src/domain/customers/customer-location.mjs')
  const { subscriberMapLocation } = await import('../src/domain/customers/subscriber-map.mjs')
  const docta = { ...original, street: 'Manzana 28 Lote 1', locality: 'Córdoba - Docta', locationOverride: [-31.5, -64.3] }
  assert.equal(subscriberMapLocation(docta).quality, 'block')
  assert.notDeepEqual(subscriberMapLocation(docta).coordinates, docta.locationOverride)
  assert.match(customerMapLocation(docta).label, /manzana 28/)
})
