const test = require('node:test')
const assert = require('node:assert/strict')
const { locateSalesAddress, photonResults, salesAddress } = require('../api/_lib/sales-geocoding.cjs')
const house = (properties = {}, coordinates = [-64.1833, -31.4167]) => ({ geometry: { type: 'Point', coordinates }, properties: { countrycode: 'AR', state: 'Córdoba', city: 'Córdoba', street: 'San Martín', housenumber: '200', type: 'house', ...properties } })
test('lookup preserves local neighborhood references without external requests', async () => {
  const fetcher = () => { throw new Error('Unexpected external request') }
  const nobu = await locateSalesAddress({ address: 'Manzana 127 lote 1', installationZone: 'nobu-town' }, { fetcher })
  assert.equal(nobu.items[0].approximate, true)
  assert.deepEqual(nobu.items[0].coordinates, [-31.4612923, -64.3059628])
  const docta = await locateSalesAddress({ address: 'Manzana 15 lote 30, Docta Córdoba', installationZone: 'docta' }, { fetcher })
  assert.equal(docta.items.length, 1); assert.equal(docta.items[0].source, 'neighborhood')
  const unknown = await locateSalesAddress({ address: 'Sin manzana, Docta', installationZone: 'docta' }, { fetcher })
  assert.equal(unknown.items.length, 0)
})
test('external matches are bounded, deduplicated and exclude city centroids', () => {
  const items = photonResults({ features: [house(), house(), house({ housenumber: '', type: 'street' }, [-64.18, -31.41]), house({ countrycode: 'ES' }), house({ state: 'Santa Fe' }), house({}, [0, 0]), house({ street: '', type: 'city' })] })
  assert.equal(items.length, 2)
  assert.deepEqual(items[0].coordinates, [-31.4167, -64.1833])
  assert.equal(items[0].approximate, false); assert.equal(items[1].approximate, true)
})
test('lookup sends only address, caches results and provides recoverable errors', async () => {
  let calls = 0
  const fetcher = async url => {
    calls++; assert.equal(url.hostname, 'photon.komoot.io'); assert.ok(url.searchParams.get('q').includes('Córdoba'))
    assert.equal(url.href.includes('private@example.com'), false)
    return { ok: true, json: async () => ({ features: [house()] }) }
  }
  const input = { address: 'San Martín 200, Córdoba', installationZone: 'residencial', email: 'private@example.com' }
  const result = await locateSalesAddress(input, { fetcher })
  result.items[0].coordinates[0] = 0
  assert.equal((await locateSalesAddress(input, { fetcher })).items[0].coordinates[0], -31.4167)
  assert.equal(calls, 1)
  await assert.rejects(locateSalesAddress({ address: 'Otra dirección 800', installationZone: 'residencial' }, { fetcher: async () => { throw new Error('offline') } }), e => e.statusCode === 503)
  assert.equal((await locateSalesAddress({ address: 'Dirección inexistente 901' }, { fetcher: async () => ({ ok: true, json: async () => ({ features: [] }) }) })).items.length, 0)
})
test('map-only reservations retain a usable location; missing or invalid coordinates reject', () => {
  assert.match(salesAddress({ address: '', coordinates: [-31.4, -64.2], locationConfirmed: true }), /-31.400000, -64.200000/)
  for (const coordinates of [null, [null, -64], [100, -64], ['-31', '-64']]) assert.throws(() => salesAddress({ coordinates, locationConfirmed: true }))
  assert.equal(salesAddress({ address: 'Calle 123' }), 'Calle 123')
})
test('lookup endpoint checks sales permission before attempting geocoding', async () => {
  const { handle } = require('../api/_lib/sales-booking.cjs')
  const input = { action: 'locate', address: 'Manzana 127 lote 1', installationZone: 'nobu-town' }
  await assert.rejects(handle({ user: { roleCode: 'operator' }, method: 'POST', input }), e => e.statusCode === 403)
  const result = await handle({ user: { permissions: { __catalogV2: true, 'sales.view': true, 'sales.reserve': true } }, method: 'POST', input })
  assert.equal(result.items.length, 1)
})
