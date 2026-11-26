const dahuaModels = require('../src/features/cctv/domain/dahua-models.json')
const dahuaImages = require('../src/features/cctv/domain/dahua-product-images.json')
const alarmModels = require('../src/features/cctv/domain/alarm-models.json')
const alarmImages = require('../src/features/cctv/domain/alarm-product-images.json')
const perimeterModels = require('../src/features/cctv/domain/ir-perimeter-models.json')
const perimeterImages = require('../src/features/cctv/domain/perimeter-product-images.json')
const irCameras = require('../src/features/cctv/domain/ir-camera-models.json')
const irRecorders = require('../src/features/cctv/domain/ir-recorder-models.json')
const dahuaModelAliases = require('../src/features/cctv/domain/ir-dahua-model-aliases.json')

const normalized = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
const normalizedBrand = value => normalized(value).replace(/^dahua technology$/, 'dahua')
const isDahuaCctv = ({ category, brand }) => category === 'cctv' && normalizedBrand(brand) === 'dahua'
const dahuaCode = model => normalized(model).replace(/^dhi?-/, '')
const equivalentDahuaCodes = new Map()
for (const [supplier, manufacturer] of Object.entries(dahuaModelAliases)) {
  const canonical = dahuaCode(manufacturer), alias = dahuaCode(supplier)
  const codes = equivalentDahuaCodes.get(canonical) || [canonical]
  codes.push(alias)
  equivalentDahuaCodes.set(canonical, codes)
  equivalentDahuaCodes.set(alias, codes)
}
function catalogModelKey({ category, brand, model }) {
  if (!isDahuaCctv({ category, brand })) return normalized(model)
  const code = dahuaCode(model)
  return equivalentDahuaCodes.get(code)?.[0] || code
}
function searchableModel(product) {
  if (!isDahuaCctv(product)) return product.model
  const code = dahuaCode(product.model)
  const codes = equivalentDahuaCodes.get(code) || [code]
  return [product.model, ...codes.flatMap(value => ['DH-' + value, 'DHI-' + value])].join(' ')
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
const irCctvIds = new Set(Object.values(dahuaModelAliases).map(model => createBaseProductId('cctv', 'Dahua', model)))
for (const equipment of [...irCameras, ...irRecorders]) {
  const id = createBaseProductId('cctv', equipment.brand, equipment.model)
  if (baseProductsById.has(id)) continue
  addBase('cctv', equipment.kind, equipment.brand, equipment.model, equipment, equipment.description)
  irCctvIds.add(id)
}
const baseProducts = Array.from(baseProductsById.values())
function mergeCatalog(overrides = []) {
  if (!overrides.length) return baseProducts
  const combined = new Map(baseProductsById)
  // An administrator may already have added (or retired) this supplier model
  // under a custom ID before it became part of the bundled catalog.
  for (const product of overrides) {
    const supplierId = createBaseProductId(product.category, product.brand, product.model)
    if (irCctvIds.has(supplierId) && supplierId !== product.id) combined.delete(supplierId)
  }
  for (const product of overrides) combined.set(product.id, product)
  return Array.from(combined.values())
}

module.exports = { baseProducts, baseProductsById, productKey, catalogModelKey, searchableModel, normalizedBrand, createBaseProductId, mergeCatalog }
