import catalog from '../../../../shared/product-catalog.cjs'
import schema from '../../../../shared/cctv-schema.cjs'
import { sortOptionsAlphabetically } from '../../../domain/shared/catalog-order.mjs'
import { normalizeSearchText } from '../../../domain/shared/normalization.mjs'
import { productName, productType } from './product-name.mjs'

export function productBrands(products, category = '') {
  const brands = new Set()
  for (const product of products) {
    if (product.brand && (!category || product.category === category)) brands.add(product.brand)
  }
  return sortOptionsAlphabetically([...brands])
}

export function indexProducts(products) {
  return sortOptionsAlphabetically(products, product => `${product.brand} ${product.model}`).map(product => {
    const name = productName(product)
    const searchable = normalizeSearchText([name, catalog.searchableModel(product), schema.EQUIPMENT_CATEGORIES[product.category], productType(product)].join(' '))
    return { product, name, searchable }
  })
}

export function productSearchWords(query) {
  return query.trim().split(/\s+/).map(normalizeSearchText).filter(Boolean)
}
