import schema from '../../../../shared/cctv-schema.cjs'
export function newEquipmentItem(category = 'cctv', id = `equipment-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`) {
  return { id, category, kind: Object.keys(schema.EQUIPMENT_KINDS[category])[0], label: '', brand: '', model: '', quantity: 1, location: '', details: {}, notes: '' }
}
export function changeEquipmentKind(item, category, kind = Object.keys(schema.EQUIPMENT_KINDS[category])[0]) {
  const allowed = schema.equipmentFields(category, kind)
  return { ...item, category, kind, details: Object.fromEntries(Object.entries(item.details || {}).filter(([key]) => allowed.includes(key))) }
}
export function reorderEquipment(items, id, direction) {
  const index = items.findIndex(item => item.id === id), next = index + direction
  if (index < 0 || ![-1, 1].includes(direction) || next < 0 || next >= items.length) return items
  const result = [...items]; [result[index], result[next]] = [result[next], result[index]]; return result
}
export const removeEquipment = (items, id) => items.filter(item => item.id !== id)
