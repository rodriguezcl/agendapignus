const dahuaModels = require('../src/features/cctv/domain/dahua-models.json')
const dahuaImages = require('../src/features/cctv/domain/dahua-product-images.json')
const alarmModels = require('../src/features/cctv/domain/alarm-models.json')
const alarmImages = require('../src/features/cctv/domain/alarm-product-images.json')
const perimeterModels = require('../src/features/cctv/domain/ir-perimeter-models.json')
const perimeterImages = require('../src/features/cctv/domain/perimeter-product-images.json')

const normalized = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
const productKey = ({ category, brand, model }) => JSON.stringify([category, brand, model].map(normalized))
const createBaseProductId = (category, brand, model) => ['base', category, brand, model].map(value => encodeURIComponent(normalized(value))).join(':')

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
const baseProducts = Array.from(baseProductsById.values())
function mergeCatalog(overrides = []) {
  if (!overrides.length) return baseProducts
  const combined = new Map(baseProductsById)
  for (const product of overrides) combined.set(product.id, product)
  return Array.from(combined.values())
}

module.exports = { baseProducts, baseProductsById, productKey, createBaseProductId, mergeCatalog }
