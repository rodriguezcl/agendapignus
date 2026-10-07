const test = require('node:test')
const assert = require('node:assert/strict')

test('Docta usa coordenadas del mapa y no las importadas', async () => {
  const { doctaLocation, customerLocationFields, serviceDirections } = await import('../src/domain/customers/customer-location.mjs')
  const c = { account: 'PIG-6014', street: 'Manzana 28 Lote 31 C3', address: 'Manzana 28 Lote 31 C3, Córdoba 1 - Docta Urbanización', fields: { 'Ubicación de la cuenta': '-31.34,-64.16' } }
  const before = structuredClone(c)
  assert.equal(doctaLocation(c).reference, 28)
  assert.ok(serviceDirections(c).url.includes('/maps/dir/'))
  assert.ok(!customerLocationFields(c)['Ubicación de la cuenta'].includes('-31.34,'))
  assert.deepEqual(c, before)
  c.fields['Ubicación de la cuenta'] = 'otra importación'
  assert.deepEqual(doctaLocation(c).coordinates, doctaLocation(before).coordinates)
})
test('separa sectores, reconoce abreviaturas y aplica excepciones aprobadas', async () => {
  const { doctaLocation } = await import('../src/domain/customers/customer-location.mjs')
  const cordoba = doctaLocation({ address: 'MZ 20 Lote 1, Córdoba - Docta' })
  const mal = doctaLocation({ address: 'Manzana 20 Lote 1, Malagueño 2 - Docta' })
  assert.notDeepEqual(cordoba.coordinates, mal.coordinates)
  assert.deepEqual(doctaLocation({ address: 'Mal. 20 Lote 1 Docta' }).coordinates, mal.coordinates)
  assert.equal(doctaLocation({ client: 'PIG-6962 CLIENTE', address: 'Manzana 8 Lote 8, Córdoba - Docta' }).sector, 'P')
  assert.equal(doctaLocation({ account: 'PIG-6248', address: 'Córdoba - Docta' }), null)
  assert.equal(doctaLocation({ address: 'Manzana 10 Docta Parque, Córdoba' }).sector, 'P')
})
test('aproximaciones numéricas explícitas y casos sin identificar no geocodificados', async () => {
  const { doctaLocation, serviceDirections } = await import('../src/domain/customers/customer-location.mjs')
  for (const [block, reference] of [[26,25],[43,44],[64,63],[159,158]]) {
    const value = doctaLocation({ address: `Manzana ${block} Lote 5, Córdoba - Docta` })
    assert.equal(value.reference, reference)
    assert.equal(value.approximate, true)
  }
  assert.equal(serviceDirections({ address: 'Docta Córdoba sin manzana' }).url, undefined)
  assert.equal(serviceDirections({ address: 'Manzana 20 Docta' }).unresolved, true)
  assert.ok(serviceDirections({ address: 'Manzana 20 Costa Verde' }).url.includes('/maps/search/'))
})
