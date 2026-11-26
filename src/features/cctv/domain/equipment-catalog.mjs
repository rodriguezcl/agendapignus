const cached = new WeakMap()
const normalizeBrand = value => String(value || '').trim().toLowerCase().replace(/^dahua technology$/, 'dahua')
export const isPerimeter = category => category === 'barrier' || category === 'fence'
export const isIrSource = url => /^https?:\/\/(?:www\.)?irseguridad\.com\.ar\//i.test(url || '')

export function equipmentCatalogFor(products) {
  if (cached.has(products)) return cached.get(products)
  const activeByCategory = new Map(), byModel = new Map(), images = new Set(), sharedImages = new Set()
  for (const item of products) {
    if (!byModel.has(item.model)) byModel.set(item.model, [])
    byModel.get(item.model).push(item)
    if (item.active) {
      if (!activeByCategory.has(item.category)) activeByCategory.set(item.category, [])
      activeByCategory.get(item.category).push(item)
    }
    if (item.image) {
      if (images.has(item.image)) sharedImages.add(item.image)
      images.add(item.image)
    }
  }
  for (const entries of activeByCategory.values()) entries.sort((a, b) => a.model.localeCompare(b.model, 'es') || a.brand.localeCompare(b.brand, 'es'))
  const catalog = {
    choices(category, kinds, brand = '') {
      const key = normalizeBrand(brand)
      return (activeByCategory.get(category) || []).filter(item => (!kinds || kinds.includes(item.kind)) && (!key || normalizeBrand(item.brand) === key))
    },
    brands(category, kinds) {
      return [...new Set(this.choices(category, kinds).map(item => item.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
    },
    find({ category, kind, brand, model }) {
      const candidates = (byModel.get(model?.trim()) || []).filter(item => item.category === category)
      const key = normalizeBrand(brand)
      const branded = candidates.filter(item => normalizeBrand(item.brand) === key)
      // Historical perimeter equipment sometimes saved only the supplier's SKU.
      const useSupplierSku = isPerimeter(category) && !branded.length && (!key || (candidates.length === 1 && !candidates[0].brand))
      const matching = useSupplierSku ? candidates : branded
      const byKind = matching.filter(item => item.kind === kind)
      if (byKind.length === 1) return byKind[0]
      return matching.length === 1 ? matching[0] : null
    },
    isSharedProductImage(image) { return sharedImages.has(image) }
  }
  cached.set(products, catalog)
  return catalog
}
