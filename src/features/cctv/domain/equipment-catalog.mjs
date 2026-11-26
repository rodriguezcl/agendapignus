import alarmModels from './alarm-models.json'
import dahuaModels from './dahua-models.json'
import perimeterModels from './ir-perimeter-models.json'

export const alarmBrands = Object.keys(alarmModels)
export const alarmGroups = brand => alarmModels[alarmBrands.find(name => name.toLowerCase() === String(brand || '').trim().toLowerCase())] || {}
export const dahuaGroups = kinds => Object.fromEntries(kinds.filter(kind => dahuaModels[kind]?.length).map(kind => [kind, dahuaModels[kind]]))
export const hasPerimeterCatalog = category => Object.hasOwn(perimeterModels, category)

export function perimeterCatalog(category, kind) {
  const families = hasPerimeterCatalog(category) ? perimeterModels[category] : {}
  const entries = kind ? (families[kind] ? [[kind, families[kind]]] : []) : Object.entries(families)
  return {
    groups: Object.fromEntries(entries.map(([family, products]) => [family, products.map(product => product.model)])),
    products: Object.fromEntries(entries.flatMap(([, products]) => products.map(product => [product.model, product])))
  }
}

export function equipmentModelGroups(category, kind, brand) {
  const catalog = category === 'alarm' ? alarmGroups(brand)
    : category === 'cctv' && /^(?:dahua|dahua technology)$/i.test(brand?.trim() || '') ? dahuaGroups([kind]) : {}
  if (category === 'alarm' && kind === 'other') return catalog
  return catalog[kind]?.length ? { [kind]: catalog[kind] } : {}
}
