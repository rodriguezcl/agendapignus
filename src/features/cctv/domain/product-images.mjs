import dahua from './dahua-product-images.json' with { type: 'json' }
import alarms from './alarm-product-images.json' with { type: 'json' }
import perimeter from './perimeter-product-images.json' with { type: 'json' }
import perimeterModels from './ir-perimeter-models.json' with { type: 'json' }

const brandKey = value => String(value ?? '').trim().toLowerCase()
const alarmBrands = new Map(Object.keys(alarms).map(brand => [brandKey(brand), alarms[brand]]))
const seenImages = new Set(), sharedImages = new Set()
for (const images of [dahua, perimeter, ...alarmBrands.values()]) {
  for (const { image } of Object.values(images)) {
    if (seenImages.has(image)) sharedImages.add(image)
    seenImages.add(image)
  }
}
export const isSharedProductImage = image => sharedImages.has(image)
const perimeterBrands = new Map()
for (const [category, families] of Object.entries(perimeterModels)) {
  perimeterBrands.set(category, new Map(Object.values(families).flat().map(item => [item.model, brandKey(item.brand)])))
}

export function findProductImage({ category, brand, model } = {}) {
  const code = model?.trim()
  if (!code) return null
  const manufacturer = brandKey(brand)
  let images
  if (category === 'cctv' && ['dahua', 'dahua technology'].includes(manufacturer)) images = dahua
  if (category === 'alarm') images = alarmBrands.get(manufacturer)
  if (perimeterBrands.has(category)) {
    const listedBrand = perimeterBrands.get(category).get(code)
    if (listedBrand === undefined || listedBrand && manufacturer && listedBrand !== manufacturer) return null
    images = perimeter
  }
  return images && Object.hasOwn(images, code) ? images[code] : null
}
