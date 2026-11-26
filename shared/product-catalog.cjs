const dahuaModels = require('../src/features/cctv/domain/dahua-models.json')
const dahuaImages = require('../src/features/cctv/domain/dahua-product-images.json')
const alarmModels = require('../src/features/cctv/domain/alarm-models.json')
const alarmImages = require('../src/features/cctv/domain/alarm-product-images.json')
const perimeterModels = require('../src/features/cctv/domain/ir-perimeter-models.json')
const perimeterImages = require('../src/features/cctv/domain/perimeter-product-images.json')
const irCameras = require('../src/features/cctv/domain/ir-camera-models.json')

const normalized = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
const normalizedBrand = value => normalized(value).replace(/^dahua technology$/, 'dahua')
function catalogModelKey({ category, brand, model }) {
  const value = normalized(model)
  return category === 'cctv' && normalizedBrand(brand) === 'dahua' ? value.replace(/^dhi?-/, '') : value
}
const productKey = product => JSON.stringify([normalized(product.category), normalizedBrand(product.brand), catalogModelKey(product)])
const createBaseProductId = (category, brand, model) => ['base', normalized(category), normalizedBrand(brand), catalogModelKey({ category, brand, model })].map(encodeURIComponent).join(':')

const baseProductsById = new Map()
function addBase(category, kind, brand, model, reference, description = '') {
  const id = createBaseProductId(category, brand, model)
  baseProductsById.set(id, {
    id, category, kind, brand, model, description, image: reference.image,
    source: reference.source, caption: reference.caption || '', active: true, version: 0
  })
}
for (const [kind, models] of Object.entries(dahuaModels)) {
  for (const model of models) addBase('cctv', kind, 'Dahua', model, dahuaImages[model])
}
for (const [brand, families] of Object.entries(alarmModels)) {
  for (const [kind, models] of Object.entries(families)) {
    for (const model of models) addBase('alarm', kind, brand, model, alarmImages[brand][model])
  }
}
for (const [category, families] of Object.entries(perimeterModels)) {
  for (const [kind, items] of Object.entries(families)) {
    for (const item of items) addBase(category, kind, item.brand || '', item.model, perimeterImages[item.model], item.component)
  }
}
const irCameraIdsByKey = new Map()
for (const camera of irCameras) {
  const id = createBaseProductId('cctv', camera.brand, camera.model)
  if (baseProductsById.has(id)) continue
  addBase('cctv', camera.kind, camera.brand, camera.model, camera, camera.description)
  irCameraIdsByKey.set(productKey({ ...camera, category: 'cctv' }), id)
}
const baseProducts = Array.from(baseProductsById.values())
function mergeCatalog(overrides = []) {
  if (!overrides.length) return baseProducts
  const combined = new Map(baseProductsById)
  // An administrator may already have added (or retired) this supplier model
  // under a custom ID before it became part of the bundled catalog.
  for (const product of overrides) {
    const supplierId = irCameraIdsByKey.get(productKey(product))
    if (supplierId && supplierId !== product.id) combined.delete(supplierId)
  }
  for (const product of overrides) combined.set(product.id, product)
  return Array.from(combined.values())
}

module.exports = { baseProducts, baseProductsById, productKey, catalogModelKey, normalizedBrand, createBaseProductId, mergeCatalog }
