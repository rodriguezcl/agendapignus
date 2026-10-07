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
