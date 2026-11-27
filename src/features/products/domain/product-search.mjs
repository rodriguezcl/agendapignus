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

export function productFilterOptions(products, { state, category, brand }) {
  // A catalog update can invalidate the selection. Keep the chosen status
  // and category whenever they still have products.
  let inState = state === 'all' ? products : products.filter(product => product.active === (state === 'active'))
  if (!inState.length) {
    state = 'all'
    inState = products
  }
  if (category && !inState.some(product => product.category === category)) category = ''
  const brands = productBrands(inState, category)
  if (brand && !brands.includes(brand)) brand = ''

  const categories = new Set()
  for (const product of inState) {
    if (!brand || product.brand === brand) categories.add(product.category)
  }
  const states = new Set()
  for (const product of products) {
    if ((!category || product.category === category) && (!brand || product.brand === brand)) {
      states.add(product.active ? 'active' : 'inactive')
    }
  }
  return { state, category, brand, categories, brands, states }
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
