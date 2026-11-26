const test = require('node:test')
const assert = require('node:assert/strict')

test('las características publicadas identifican el producto histórico al que pertenecen', () => {
  const details = require('../src/features/cctv/domain/product-characteristics.json')
  const { baseProductsById, createBaseProductId } = require('../shared/product-catalog.cjs')
  for (const [brand, models] of Object.entries(details)) {
    const category = brand === 'Dahua' ? 'cctv' : 'alarm'
    for (const [model, description] of Object.entries(models)) {
      const product = baseProductsById.get(createBaseProductId(category, brand, model))
      assert.ok(description.trim() && product, model)
      assert.equal(product.description, description, model)
    }
  }
})

test('el nombre del catálogo presenta marca, tipo y características, con el SKU separado', async () => {
  const { productName } = await import('../src/features/products/domain/product-name.mjs')
  const base = { category: 'cctv', kind: 'ip_camera', brand: 'Hikvision', model: 'DS-TEST' }
  assert.equal(productName({ ...base, description: '4 MP · lente de 2,8 mm' }), 'Hikvision · Cámara IP · 4 MP · lente de 2,8 mm')
  assert.equal(productName({ ...base, description: 'Domo IP · 4 MP' }), 'Hikvision · Cámara domo IP · 4 MP')
  assert.equal(productName({ ...base, description: 'Torreta IP panorámica · 4 MP' }), 'Hikvision · Cámara torreta IP panorámica · 4 MP')
  assert.equal(productName({ ...base, description: 'Hikvision · Cámara IP · 4 MP' }), 'Hikvision · Cámara IP · 4 MP')
  assert.equal(productName({ ...base, kind: 'nvr', description: 'Grabador NVR de 16 canales IP' }), 'Hikvision · Grabador NVR de 16 canales IP')
  assert.equal(productName(base), 'Hikvision · Cámara IP')
})

test('el nombre admite equipos históricos sin marca, componentes de alarma y productos personalizados', async () => {
  const { productName } = await import('../src/features/products/domain/product-name.mjs')
  assert.equal(productName({category: 'barrier', kind: 'infrared', description: 'Barrera infrarroja · 2 haces'}), 'Barrera infrarroja · 2 haces')
  assert.equal(productName({category: 'alarm', kind: 'sensor', brand: 'Ajax', description: 'Detector de apertura · DoorProtect Jeweller'}), 'Ajax · Detector de apertura · DoorProtect Jeweller')
  const mount = { id: 'base:bracket', category: 'alarm', kind: 'sensor', brand: 'Hikvision', description: 'Soporte empotrable' }
  assert.equal(productName(mount), 'Hikvision · Soporte empotrable')
  assert.equal(productName({ ...mount, id: 'custom:test', description: 'Soporte para dos zonas' }), 'Hikvision · Sensor / detector · Soporte para dos zonas')
  assert.equal(productName({category: 'fence', kind: 'energizer', brand: 'JFL', description: 'Electrificador'}), 'JFL · Electrificador')
  assert.equal(productName({category: 'cctv', kind: 'nvr', brand: 'AR', description: 'Armadura metálica'}), 'AR · Grabador NVR · Armadura metálica')
})
