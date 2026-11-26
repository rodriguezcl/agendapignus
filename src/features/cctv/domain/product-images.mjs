import productCatalog from '../../../../shared/product-catalog.cjs'
import { equipmentCatalogFor } from './equipment-catalog.mjs'

const catalog = equipmentCatalogFor(productCatalog.baseProducts)
export const isSharedProductImage = catalog.isSharedProductImage
export function findProductImage(equipment = {}) {
  const item = catalog.find(equipment)
  if (!item?.image) return null
  return { image: item.image, source: item.source, ...(item.caption && { caption: item.caption }) }
}
