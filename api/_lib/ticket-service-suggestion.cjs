const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')

const internalCodes = new Set(['vehicle-weekly-control', 'vehicle-control', 'weekly-vehicle-control', 'training', 'monthly-meeting', 'meeting'])
const internalNames = new Set(['control semanal de vehiculo', 'control vehicular', 'capacitacion', 'reunion mensual', 'reunion'])
function eligibleService(service) {
  return Boolean(service && service.id != null && String(service.id).trim() && normalized(service.status) === 'activo' && !service.system && !service.vehicleControl &&
    !internalCodes.has(normalized(service.code)) && !internalCodes.has(normalized(service.category)) && !internalNames.has(normalized(service.name)))
}
function serviceOptions(state = {}) {
  return (state.services || []).filter(eligibleService).map(service => ({ id: String(service.id), name: String(service.name || ''), code: String(service.code || '') }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}
function suggestedServiceId(ticket, config, state = {}) {
  const category = (config?.categories || []).find(item => item.id === ticket?.categoryId && item.active !== false)
  if (!category) return ''
  const subcategory = ticket.subcategoryId ? (category.subcategories || []).find(item => item.id === ticket.subcategoryId && item.active !== false) : null
  if (ticket.subcategoryId && !subcategory) return ''
  const value = subcategory?.defaultServiceId ?? category.defaultServiceId ?? ''
  return value && (state.services || []).some(service => String(service.id) === String(value) && eligibleService(service)) ? String(value) : ''
}

const families = [
  { id: 'alarm', names: ['alarmas', 'alarma'], codes: ['alarm-service'], services: ['service de alarma', 'service de alarmas', 'servicio de alarma', 'servicio de alarmas'] },
  { id: 'cameras', names: ['camaras / cctv', 'camaras/cctv', 'camaras', 'camara', 'cctv'], codes: ['camera-service', 'cameras-service', 'cctv-service'], services: ['service de camara', 'service de camaras', 'servicio de camara', 'servicio de camaras', 'service de cctv', 'servicio de cctv'] },
  { id: 'electric-fence', names: ['cerco electrico', 'cercos electricos'], codes: ['electric-fence-service', 'fence-service'], services: ['service de cerco electrico', 'servicio de cerco electrico', 'service de cercos electricos', 'servicio de cercos electricos'] },
  { id: 'totems', names: ['totem', 'totems'], codes: ['totem-service', 'totems-service'], services: ['service de totem', 'service de totems', 'servicio de totem', 'servicio de totems'] }
]

function initializeServiceDefaults(config, state, defaults) {
  const result = JSON.parse(JSON.stringify(config))
  const eligible = (state.services || []).filter(eligibleService)
  for (const family of families) {
    const equivalent = result.categories.find(category => family.names.includes(normalized(category.name)))
    let category = equivalent || result.categories.find(category => category.id === family.id)
    if (!category && family.id !== 'alarm' && result.categories.length < 100) {
      category = JSON.parse(JSON.stringify(defaults.categories.find(item => item.id === family.id)))
      if (!result.areas.some(area => area.id === category.areaId && area.active !== false)) category.areaId = ''
      result.categories.push(category)
    }
    // Una familia renombrada o desactivada es una decisión de configuración.
    if (!category || category.active === false || !family.names.includes(normalized(category.name)) || Object.hasOwn(category, 'defaultServiceId')) continue
    const byCode = eligible.filter(service => family.codes.includes(normalized(service.code)))
    const byName = eligible.filter(service => family.services.includes(normalized(service.name)))
    const candidates = byCode.length ? byCode : byName
    category.defaultServiceId = candidates.length === 1 ? String(candidates[0].id) : ''
  }
  return result
}

module.exports = { eligibleService, serviceOptions, suggestedServiceId, initializeServiceDefaults }
