const test = require('node:test')
const assert = require('node:assert/strict')
test('mapa respeta Docta por encima de coordenadas del Excel', async () => {
  const { customerMapLocation } = await import('../src/domain/customers/customer-location.mjs')
  const result = customerMapLocation({ address: 'Manzana 20 Lote 27, Malagueño - Docta', fields: { 'Ubicación de la cuenta': '40,50' } })
  assert.ok(result.label.includes('Malagueño'))
  assert.ok(!result.embedUrl.includes('40%2C50'))
  assert.ok(result.embedUrl.includes('output=embed'))
  assert.equal(customerMapLocation({ address: 'Docta', fields: { 'Ubicación de la cuenta': '40,50' } }).unresolved, true)
})
test('otras cuentas usan coordenadas válidas o dirección, sin interpretar URL importada', async () => {
  const { customerMapLocation } = await import('../src/domain/customers/customer-location.mjs')
  assert.ok(customerMapLocation({ fields: { 'Ubicación de la cuenta': '-31.4,-64.2' } }).embedUrl.includes('-31.4%2C-64.2'))
  for (const raw of ['95,200', '0,0', 'https://example.com', 'javascript:alert(1)']) {
    const result = customerMapLocation({ address: 'San Martín 100, Córdoba', fields: { 'Ubicación de la cuenta': raw } })
    assert.ok(result.label.includes('dirección'))
    assert.ok(result.embedUrl.startsWith('https://www.google.com/maps?q=San'))
  }
  assert.equal(customerMapLocation({ address: '-' }).unresolved, true)
  assert.ok(customerMapLocation({ street: 'San Martín 100', locality: 'Córdoba' }).url)
})

test('mapa prioriza calle y altura sobre una dirección general de barrio', async () => {
  const { customerMapLocation } = await import('../src/domain/customers/customer-location.mjs')
  const customer = { street: 'Mariano Larra 4386', locality: 'Córdoba - B° Cerro De Las Rosas', province: 'Córdoba', address: 'Córdoba - B° Cerro De Las Rosas' }
  const result = customerMapLocation(customer)
  assert.equal(result.address, 'Mariano Larra 4386, Córdoba, Argentina')
  assert.equal(new URL(result.embedUrl).searchParams.get('q'), result.address)
  assert.equal(new URL(result.url).searchParams.get('query'), result.address)
  assert.equal(customer.address, 'Córdoba - B° Cerro De Las Rosas')
})

test('mapa recupera campos importados cuando los campos principales tienen guiones', async () => {
  const { customerMapLocation } = await import('../src/domain/customers/customer-location.mjs')
  const result = customerMapLocation({ street: '-', locality: '-', fields: { Calle: 'San Martín 100', Localidad: 'Villa Allende', 'Provincia/Estado': 'Córdoba' } })
  assert.equal(result.address, 'San Martín 100, Villa Allende, Córdoba, Argentina')
  assert.equal(customerMapLocation({ address: '123' }).unresolved, true)
  assert.equal(customerMapLocation({ locality: 'Córdoba' }).unresolved, true)
})
