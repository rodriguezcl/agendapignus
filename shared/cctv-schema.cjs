const DRAWING_WIDTH = 1000
const DRAWING_HEIGHT = 650
const MAX_DRAWING_ELEMENTS = 200
const MAX_EQUIPMENT_ITEMS = 100
const DRAWING_TYPES = Object.freeze({ camera: 'Cámara', recorder: 'Grabador', alarm: 'Alarma', barrier: 'Barrera infrarroja', fence: 'Cerco eléctrico', line: 'Línea', text: 'Texto' })
const EQUIPMENT_CATEGORIES = Object.freeze({ cctv: 'Cámaras / CCTV', alarm: 'Alarma', barrier: 'Barrera infrarroja', fence: 'Cerco eléctrico', other: 'Otro equipo' })
const EQUIPMENT_KINDS = Object.freeze({
  cctv: { dvr: 'Grabador DVR', xvr: 'Grabador XVR', nvr: 'Grabador NVR', analog_camera: 'Cámara analógica', ip_camera: 'Cámara IP', switch: 'Switch', other: 'Otro equipo de CCTV' },
  alarm: { panel: 'Central de alarma', communicator: 'Comunicador', sensor: 'Sensor', siren: 'Sirena', other: 'Otro equipo de alarma' },
  barrier: { infrared: 'Barrera infrarroja' }, fence: { energizer: 'Energizador', fence: 'Tendido de cerco' }, other: { other: 'Otro equipo' },
})
const FIELD_DEFINITIONS = Object.freeze({
  channels: { label: 'Canales', type: 'number', min: 1, max: 1024, integer: true },
  diskCount: { label: 'Cantidad de discos', type: 'number', min: 0, max: 64, integer: true },
  diskCapacityTb: { label: 'Capacidad por disco (TB)', type: 'number', min: 0, max: 1000 },
  technology: { label: 'Tecnología', type: 'select', options: ['Analógica', 'IP', 'Híbrida'] },
  resolution: { label: 'Resolución', type: 'text', maxLength: 80 },
  zones: { label: 'Cantidad de zonas', type: 'number', min: 0, max: 1024, integer: true },
  communication: { label: 'Comunicación', type: 'text', maxLength: 120 },
  battery: { label: 'Batería (tipo / capacidad)', type: 'text', maxLength: 120 },
  rangeMeters: { label: 'Alcance (m)', type: 'number', min: 0, max: 10000 },
  beams: { label: 'Cantidad de haces', type: 'number', min: 1, max: 100, integer: true },
  pairs: { label: 'Cantidad de pares', type: 'number', min: 1, max: 1000, integer: true },
  zone: { label: 'Zona asociada', type: 'text', maxLength: 80 },
  perimeterMeters: { label: 'Longitud del perímetro (m)', type: 'number', min: 0, max: 100000 },
  wireLines: { label: 'Líneas de alambre', type: 'number', min: 1, max: 100, integer: true },
})
const DETAILS_BY_KIND = Object.freeze({
  dvr: ['channels', 'diskCount', 'diskCapacityTb', 'technology'], xvr: ['channels', 'diskCount', 'diskCapacityTb', 'technology'], nvr: ['channels', 'diskCount', 'diskCapacityTb'],
  analog_camera: ['resolution'], ip_camera: ['resolution'], switch: ['channels'],
  panel: ['zones', 'communication', 'battery'], communicator: ['communication', 'battery'], sensor: ['zone', 'battery'], siren: ['battery'],
  infrared: ['rangeMeters', 'beams', 'pairs', 'zone', 'communication'], energizer: ['perimeterMeters', 'wireLines', 'zones', 'battery'], fence: ['perimeterMeters', 'wireLines', 'zones'], other: [],
})
const defaultDrawing = () => ({ width: DRAWING_WIDTH, height: DRAWING_HEIGHT, elements: [] })
function invalid(message) { throw Object.assign(new TypeError(message), { statusCode: 400, code: 'CCTV_VALIDATION' }) }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label}: formato inválido.`)
}
function keys(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${label}: el campo ${key} no está permitido.`) }
function text(value, label, limit = 160) {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`${label}: texto inválido o demasiado largo (máximo ${limit}).`)
  return value.trim()
}
function id(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) invalid(`${label}: identificador inválido.`)
  return value
}
function number(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) invalid(`${label}: indicá un número ${integer ? 'entero ' : ''}entre ${min} y ${max}.`)
  return value
}
function unique(items, label) { if (new Set(items.map(item => item.id)).size !== items.length) invalid(`${label}: hay identificadores repetidos.`) }
function validateDrawing(value) {
  if (value == null) return defaultDrawing()
  object(value, 'Plano'); keys(value, ['width', 'height', 'elements'], 'Plano')
  if (value.width !== DRAWING_WIDTH || value.height !== DRAWING_HEIGHT) invalid('El plano debe tener un tamaño de 1000 × 650.')
  if (!Array.isArray(value.elements) || value.elements.length > MAX_DRAWING_ELEMENTS) invalid(`El plano admite hasta ${MAX_DRAWING_ELEMENTS} elementos.`)
  const elements = value.elements.map(element => {
    object(element, 'Elemento'); keys(element, ['id', 'type', 'x', 'y', 'x2', 'y2', 'label', 'rotation'], 'Elemento')
    if (!Object.hasOwn(DRAWING_TYPES, element.type)) invalid('El tipo de elemento del plano no es válido.')
    const item = { id: id(element.id, 'Elemento'), type: element.type, x: number(element.x, 'Posición horizontal', 0, DRAWING_WIDTH), y: number(element.y, 'Posición vertical', 0, DRAWING_HEIGHT), label: text(element.label, 'Etiqueta', element.type === 'text' ? 1000 : 160) }
    if (element.type === 'line') { item.x2 = number(element.x2, 'Final horizontal', 0, DRAWING_WIDTH); item.y2 = number(element.y2, 'Final vertical', 0, DRAWING_HEIGHT) }
    else if (element.x2 != null || element.y2 != null) invalid('Sólo las líneas tienen un segundo punto.')
    if (element.rotation != null) item.rotation = number(element.rotation, 'Orientación', 0, 360)
    return item
  })
  unique(elements, 'Plano'); return { width: DRAWING_WIDTH, height: DRAWING_HEIGHT, elements }
}
function validateEquipmentItems(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_EQUIPMENT_ITEMS) invalid(`La ficha admite hasta ${MAX_EQUIPMENT_ITEMS} equipos.`)
  const items = value.map(item => {
    object(item, 'Equipo'); keys(item, ['id', 'category', 'kind', 'label', 'brand', 'model', 'quantity', 'location', 'details', 'notes'], 'Equipo')
    if (!Object.hasOwn(EQUIPMENT_CATEGORIES, item.category) || !Object.hasOwn(EQUIPMENT_KINDS[item.category], item.kind)) invalid('La categoría o el tipo de equipo no es válido.')
    const details = item.details ?? {}; object(details, 'Detalles del equipo'); keys(details, DETAILS_BY_KIND[item.kind], 'Detalles del equipo')
    const normalized = {}
    for (const [key, value] of Object.entries(details)) {
      if (value === '' || value == null) continue
      const field = FIELD_DEFINITIONS[key]
      if (field.type === 'number') normalized[key] = number(value, field.label, field.min, field.max, field.integer)
      else if (field.type === 'select') { if (!field.options.includes(value)) invalid(`${field.label}: opción inválida.`); normalized[key] = value }
      else normalized[key] = text(value, field.label, field.maxLength)
    }
    return { id: id(item.id, 'Equipo'), category: item.category, kind: item.kind, label: text(item.label, 'Nombre del equipo'), brand: text(item.brand, 'Marca', 100), model: text(item.model, 'Modelo', 100), quantity: number(item.quantity ?? 1, 'Cantidad', 1, 10000, true), location: text(item.location, 'Ubicación', 250), details: normalized, notes: text(item.notes, 'Observaciones', 3000) }
  })
  unique(items, 'Ficha técnica'); return items
}
module.exports = { DRAWING_WIDTH, DRAWING_HEIGHT, MAX_DRAWING_ELEMENTS, MAX_EQUIPMENT_ITEMS, DRAWING_TYPES, EQUIPMENT_CATEGORIES, EQUIPMENT_KINDS, FIELD_DEFINITIONS, DETAILS_BY_KIND, defaultDrawing, validateDrawing, validateEquipmentItems }
