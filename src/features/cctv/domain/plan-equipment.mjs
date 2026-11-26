import schema from '../../../../shared/cctv-schema.cjs'

export function reconcilePlanEquipment(drawing, equipment) {
  if (!drawing?.elements?.some(element => element.equipmentId)) return { drawing, notice: '' }

  const byId = new Map((equipment ?? []).map(item => [item.id, item]))
  const used = new Map()
  let updated = 0, detached = 0
  const elements = drawing.elements.map(element => {
    if (!element.equipmentId) return element
    const item = byId.get(element.equipmentId)
    const placed = used.get(element.equipmentId) || 0
    if (!item || placed >= (item.quantity ?? 1)) {
      const { equipmentId, ...symbol } = element
      detached++
      return symbol
    }
    used.set(item.id, placed + 1)
    const fields = schema.equipmentSymbolFields(item)
    if (element.type === fields.type && element.brand === fields.brand && element.model === fields.model) return element
    const { brand, model, ...symbol } = element
    updated++
    return { ...symbol, ...fields }
  })

  const notices = []
  if (updated) notices.push('El borrador muestra los datos actuales de los equipos vinculados.')
  if (detached) notices.push(detached === 1
    ? 'Un equipo que quedó fuera del inventario disponible se conserva en el borrador como símbolo independiente.'
    : `${detached} equipos que quedaron fuera del inventario disponible se conservan en el borrador como símbolos independientes.`)
  return { drawing: updated || detached ? { ...drawing, elements } : drawing, notice: notices.join(' ') }
}
