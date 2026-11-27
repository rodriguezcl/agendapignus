const test = require('node:test')
const assert = require('node:assert/strict')
const { baseProducts, baseProductsById, productKey, mergeCatalog } = require('../shared/product-catalog.cjs')
const dahuaModelAliases = require('../src/features/cctv/domain/ir-dahua-model-aliases.json')

test('el filtro ofrece las marcas de cada categoría y las reúne al seleccionar Todas', async () => {
  const { productBrands } = await import('../src/features/products/domain/product-search.mjs')
  const products = [
    { category: 'fence', brand: 'ALARI' },
    { category: 'cctv', brand: 'Hikvision' },
    { category: 'alarm', brand: 'Hikvision' },
    { category: 'alarm', brand: 'Ajax', active: false },
    { category: 'alarm', brand: 'Ajax' },
    { category: 'alarm', brand: '' }
  ]
  assert.deepEqual(productBrands(products, 'alarm'), ['Ajax', 'Hikvision'])
  assert.deepEqual(productBrands(products, 'cctv'), ['Hikvision'])
  assert.deepEqual(productBrands(products, 'fence'), ['ALARI'])
  assert.deepEqual(productBrands(products, 'barrier'), [])
  assert.deepEqual(productBrands(products, ''), ['Ajax', 'ALARI', 'Hikvision'])
})

test('the illustrated base catalog keeps a distinct identity for every model', () => {
  const models = new Set(baseProducts.map(productKey))
  assert.equal(models.size, baseProducts.length)
  for (const product of baseProducts) {
    assert.ok(product.image && product.source && product.active)
    assert.equal(baseProductsById.get(product.id), product)
  }
  const original = baseProducts[0]
  const archived = { ...original, model: 'Modelo corregido', active: false, version: 1 }
  const custom = { ...original, id: 'custom:test', model: 'Modelo nuevo', version: 1 }
  const effective = mergeCatalog([archived, custom])
  assert.equal(effective.length, baseProducts.length + 1)
  assert.equal(effective.filter(item => item.id === original.id).length, 1)
  assert.equal(effective.find(item => item.id === original.id), archived)
  assert.equal(original.active, true)
})

test('los códigos alternativos de IR conservan el equipo, la foto y la identidad original del fabricante', async () => {
  const { searchableModel } = require('../shared/product-catalog.cjs')
  const { equipmentCatalogFor } = await import('../src/features/cctv/domain/equipment-catalog.mjs')
  const catalog = equipmentCatalogFor(baseProducts)
  const alternateModels = Object.entries(dahuaModelAliases).map(([supplier, official]) => ['Dahua', supplier, official])
  for (const item of require('../src/features/cctv/domain/ir-camera-models.json')) {
    for (const alias of item.aliases || []) alternateModels.push([item.brand, alias, item.model])
  }
  for (const [brand, supplierModel, manufacturerModel] of alternateModels) {
    const original = catalog.find({ category: 'cctv', brand, model: manufacturerModel })
    assert.equal(original?.model, manufacturerModel)
    const alias = { ...original, model: supplierModel }
    assert.equal(productKey(alias), productKey(original))
    assert.equal(catalog.find(alias), original)
    assert.ok(searchableModel(original).toLowerCase().includes(supplierModel.toLowerCase()))
    const saved = { ...alias, id: 'custom:archived', active: false, version: 1 }
    const effective = mergeCatalog([saved])
    assert.deepEqual(effective.filter(item => productKey(item) === productKey(original)), [saved])
    assert.equal(equipmentCatalogFor(effective).find(original), saved)
    assert.notEqual(productKey({ ...alias, model: supplierModel + '-S2' }), productKey(original))
  }
})

test('a delayed catalog read cannot undo a saved change or replace its newer version', async () => {
  const { createCatalogStore } = await import('../src/features/products/application/catalog-store.mjs')
  const saved = { ...baseProducts[0], active: false, version: 1 }
  const reads = []
  const store = createCatalogStore(async (url, opts) => {
    if (opts.method === 'POST') return { product: saved }
    return new Promise(resolve => reads.push(resolve))
  })
  const first = store.refresh()
  assert.equal(store.refresh(), first)
  assert.equal(await store.saveProduct({}), saved)
  const latest = store.refresh()
  reads[1]({ overrides: [saved], canManage: true })
  await latest
  reads[0]({ overrides: [], canManage: false })
  await first
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.products.find(item => item.id === saved.id), saved)
  assert.equal(snapshot.canManage, true)
})

test('la selección cambia de estado en una sola solicitud y el catálogo comparte todos los cambios', async () => {
  const { createCatalogStore } = await import('../src/features/products/application/catalog-store.mjs')
  const originals = baseProducts.slice(0, 2)
  const items = originals.map(({ id, version }) => ({ id, expectedVersion: version }))
  const saved = originals.map(product => ({ ...product, active: false, version: product.version + 1 }))
  const writes = [], reads = []
  const store = createCatalogStore(async (url, options) => {
    assert.equal(url, '/api/products')
    if (options.method === 'POST') {
      writes.push(JSON.parse(options.body))
      return { products: saved }
    }
    return new Promise(resolve => reads.push(resolve))
  })
  const oldRead = store.refresh()
  await store.setProductsActive(items, false)
  assert.deepEqual(writes, [{ action: 'setActive', items, active: false }])
  reads[0]({ overrides: [], canManage: true })
  await oldRead
  const effective = store.getSnapshot().products
  for (const product of saved) assert.deepEqual(effective.find(entry => entry.id === product.id), product)
  assert.ok(effective.find(entry => entry.id === baseProducts[2].id).active)
  reads[1]({ overrides: saved, canManage: true })
  await store.refresh()
})

for (const [family, items] of [
  ['cámaras', require('../src/features/cctv/domain/ir-camera-models.json')],
  ['grabadores', require('../src/features/cctv/domain/ir-recorder-models.json')]
]) {
  test('se preservan la identidad, la foto y las bajas de ' + family + ' de IR ya administrados', () => {
    for (const brand of ['Dahua', 'Hikvision', 'IMOU']) {
      const { model } = items.find(item => item.brand === brand)
      const imported = baseProducts.find(item => item.category === 'cctv' && item.brand === brand && item.model === model)
      const savedModel = brand === 'Dahua' ? 'DHI-' + model.replace(/^dhi?-/i, '') : model
      const previous = { ...imported, id: 'custom:previous', model: savedModel, image: '/api/products/photo?id=previous', active: false, version: 2 }
      const effective = mergeCatalog([previous])
      assert.deepEqual(effective.filter(item => productKey(item) === productKey(imported)), [previous])
      assert.equal(effective.length, baseProducts.length)
      const correction = { ...imported, active: false, description: 'Baja administrativa', version: 1 }
      assert.deepEqual(mergeCatalog([correction]).filter(item => item.id === imported.id), [correction])
    }
  })
}

test('role preview includes the global catalog only for administrators', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  assert.ok(buildRolePreview({ code: 'administrator' }).navigation.some(item => item.id === 'products'))
  for (const code of ['supervisor', 'technician', 'coordinator']) {
    const preview = buildRolePreview({ code, permissions: { products: true, 'products.view': true } })
    assert.ok(!preview.navigation.some(item => item.id === 'products'))
  }
})
