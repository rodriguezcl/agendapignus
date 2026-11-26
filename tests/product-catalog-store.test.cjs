const test = require('node:test')
const assert = require('node:assert/strict')
const { baseProducts, baseProductsById, productKey, mergeCatalog } = require('../shared/product-catalog.cjs')

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

test('role preview includes the global catalog only for administrators', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  assert.ok(buildRolePreview({ code: 'administrator' }).navigation.some(item => item.id === 'products'))
  for (const code of ['supervisor', 'technician', 'coordinator']) {
    const preview = buildRolePreview({ code, permissions: { products: true, 'products.view': true } })
    assert.ok(!preview.navigation.some(item => item.id === 'products'))
  }
})
