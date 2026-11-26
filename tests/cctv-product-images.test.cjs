const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const origins = require('../shared/cctv-product-image-origins.json')
const dahua = require('../src/features/cctv/domain/dahua-models.json')
const alarms = require('../src/features/cctv/domain/alarm-models.json')
const perimeter = require('../src/features/cctv/domain/ir-perimeter-models.json')
const dahuaImages = require('../src/features/cctv/domain/dahua-product-images.json')
const alarmImages = require('../src/features/cctv/domain/alarm-product-images.json')
const perimeterImages = require('../src/features/cctv/domain/perimeter-product-images.json')

test('cada referencia visual pertenece al catálogo y tiene una fuente HTTPS y una imagen local válida o un origen permitido', async () => {
  const { findProductImage } = await import('../src/features/cctv/domain/product-images.mjs')
  function verify(images, models, category, brand) {
    assert.ok(models.size, brand || category)
    assert.deepEqual(new Set(Object.keys(images)), models, brand || category)
    for (const [model, reference] of Object.entries(images)) {
      if (reference.image.startsWith('/')) {
        assert.match(reference.image, /^\/cctv-product-photos\/[a-f0-9]{16}\.webp$/)
        const photo = readFileSync(join(__dirname, '../public', reference.image))
        assert.equal(photo.toString('ascii', 0, 4), 'RIFF', model)
        assert.equal(photo.toString('ascii', 8, 12), 'WEBP', model)
        assert.ok(reference.image.endsWith(createHash('sha256').update(photo).digest('hex').slice(0, 16) + '.webp'), model)
      } else {
        assert.ok(origins.includes(new URL(reference.image).origin), reference.image)
      }
      assert.equal(new URL(reference.source).protocol, 'https:', reference.source)
      assert.deepEqual(findProductImage({ category, brand, model }), reference, model)
    }
  }
  verify(dahuaImages, new Set(Object.values(dahua).flat()), 'cctv', 'Dahua')
  for (const [brand, families] of Object.entries(alarms)) {
    verify(alarmImages[brand], new Set(Object.values(families).flat()), 'alarm', brand)
  }
  const supplierProducts = Object.entries(perimeter).flatMap(([category, families]) =>
    Object.values(families).flat().map(item => ({ category, ...item })))
  assert.equal(Object.keys(perimeterImages).length, supplierProducts.length)
  for (const item of supplierProducts) {
    const reference = findProductImage(item)
    assert.equal(reference.source, item.url, item.model)
    assert.ok(origins.includes(new URL(reference.image).origin))
  }
})

test('la búsqueda de fotos conserva la distinción entre variantes, proveedores y tipos de equipo', async () => {
  const { findProductImage } = await import('../src/features/cctv/domain/product-images.mjs')
  const camera = { category: 'cctv', brand: '  Dahua Technology ', model: Object.keys(dahuaImages)[0] }
  assert.ok(findProductImage(camera))
  assert.equal(findProductImage({ ...camera, brand: 'Otra marca' }), null)
  assert.equal(findProductImage({ ...camera, model: camera.model + '-OTRO' }), null)
  assert.equal(findProductImage({ ...camera, model: '__proto__' }), null)
  const barrier = { category: 'barrier', brand: 'Dumont', model: 'B60' }
  assert.ok(findProductImage(barrier))
  assert.equal(findProductImage({ ...barrier, category: 'fence' }), null)
  assert.equal(findProductImage({ ...barrier, brand: 'Otra marca' }), null)
  assert.equal(findProductImage({ category: 'other', model: 'B60' }), null)
})

test('se distinguen las fotos compartidas por el proveedor en más de una ficha', async () => {
  const { isSharedProductImage } = await import('../src/features/cctv/domain/product-images.mjs')
  const counts = new Map()
  for (const catalog of [dahuaImages, perimeterImages, ...Object.values(alarmImages)]) {
    for (const { image } of Object.values(catalog)) counts.set(image, (counts.get(image) || 0) + 1)
  }
  for (const [image, count] of counts) assert.equal(isSharedProductImage(image), count > 1)
})
