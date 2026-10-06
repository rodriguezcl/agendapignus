import { serviceTypesFor } from './multi-service.mjs'

export function isEquipmentRetirementName(name) {
  const normalized = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  return /\bretiro de equipos?\b/.test(normalized)
}

// Supply pickups from a vendor are operational work, not subscriber losses.
export function isEquipmentRetirementRecord(record) {
  return serviceTypesFor(record).some(type => isEquipmentRetirementName(type.name))
}
