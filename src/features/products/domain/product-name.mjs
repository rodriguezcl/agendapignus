import names from '../../../../shared/product-name.cjs'

export const { productType, productName } = names

export function productOptionLabel(product, code = product.model) {
  return [code, productName(product)].filter(Boolean).join(' · ')
}
