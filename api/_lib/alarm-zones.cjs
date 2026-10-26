// Shared domain model: no browser or database dependencies.
const ATTRIBUTES = ['Instantánea', 'Demorada', 'Seguidora', 'Interior', 'Interior seguidora', '24 horas']
const SENSORS = ['PIR cableado', 'PIR inalámbrico', 'Magnético cableado', 'Magnético inalámbrico', 'Sirena', 'Botón de pánico', 'Tamper', 'Detector de humo', 'Detector de rotura de vidrio', 'Barrera infrarroja', 'Otro']
const HELP = {
  'Instantánea': 'Genera alarma inmediata cuando la zona está activa.',
  Demorada: 'Permite un tiempo de entrada o salida programado.',
  Seguidora: 'Genera alarma inmediata, salvo que esté vigente el tiempo de entrada iniciado por una zona demorada.',
  Interior: 'Normalmente se activa en modo total y puede excluirse en modo parcial.',
  'Interior seguidora': 'Combina el comportamiento interior con el de una zona seguidora.',
  '24 horas': 'Permanece activa con el sistema armado o desarmado, según su configuración.'
}
const MAX_ZONES = 128
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const installation = record => !record?.vehicleControl && [record?.service, ...(record?.serviceTypes || []).map(s => s.name || s.label)].some(value => normalized(value).split(/\s*[·|+]\s*/).some(name => name === 'instalacion de alarma'))
const emptyZone = number => ({ number, name: '', attribute: '', sensor: '', sensorOther: '' })
const zoneHasData = zone => ['name', 'attribute', 'sensor', 'sensorOther'].some(key => String(zone?.[key] || '').trim())
const zoneComplete = zone => Boolean(zone?.name?.trim() && ATTRIBUTES.includes(zone.attribute) && SENSORS.includes(zone.sensor) && (zone.sensor !== 'Otro' || zone.sensorOther?.trim()))
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
function validateZones(input, complete = true) {
  if (!Array.isArray(input) || input.length > MAX_ZONES || complete && !input.length) fail('Cargá al menos una zona para completar la instalación.')
  const numbers = new Set()
  const validated = input.map(row => {
    if (!row || !Number.isInteger(row.number) || row.number < 1 || row.number > 999 || numbers.has(row.number)) fail('Cada zona debe tener un número único entre 1 y 999.')
    numbers.add(row.number)
    const zone = { number: row.number }
    for (const key of ['name', 'attribute', 'sensor', 'sensorOther']) {
      if (typeof row[key] !== 'string' || row[key].length > 120) fail(`Revisá los datos de la zona ${row.number}.`)
      zone[key] = row[key].trim()
    }
    if (zone.attribute && !ATTRIBUTES.includes(zone.attribute) || zone.sensor && !SENSORS.includes(zone.sensor)) fail(`Seleccioná un atributo y un sensor válidos en la zona ${row.number}.`)
    if (complete && (zone.number === 1 || zoneHasData(zone)) && !zoneComplete(zone)) fail(`Completá el nombre, atributo y sensor de la zona ${row.number}.`)
    if (zone.sensor !== 'Otro') zone.sensorOther = ''
    return zone
  }).sort((a, b) => a.number - b.number)
  if (complete && !validated.some(zone => zone.number === 1)) fail('La zona 1 es obligatoria para completar la instalación.')
  return complete ? validated.filter(zoneHasData) : validated
}
function reportZones(record, type, input, user, now) {
  if (!installation(record) || !['Completado', 'Avance registrado'].includes(type)) {
    if (input != null) fail('Las zonas se informan al completar o registrar un avance de una instalación de alarma.')
    return {}
  }
  const complete = type === 'Completado'
  const zones = validateZones(input ?? (complete ? null : []), complete)
  return { alarmZones: { version: 1, zones, complete, reportedAt: now, reportedById: user.id, reportedByName: user.name || user.email || 'Técnico' } }
}
const reportAvailable = record => record?.alarmZones?.version === 1 && record.alarmZones.complete === true && record.alarmZones.zones?.length > 0 && (record.status === 'Completado' || record.technicalStatus === 'Completado') && record.status !== 'Cancelado'
const pendingReport = record => reportAvailable(record) && !record.alarmZones.softguard?.completedAt
function initialZones(record, history = []) {
  const prior = record?.alarmZones || (record?.serviceJourney && history.filter(item => item.serviceJourney?.id === record.serviceJourney.id && item.serviceJourney.index < record.serviceJourney.index && item.alarmZones?.zones?.length).sort((a,b) => b.serviceJourney.index - a.serviceJourney.index)[0]?.alarmZones)
  return prior?.zones?.length ? prior.zones.map(row => ({ ...row })) : [1,2,3].map(emptyZone)
}
module.exports = { ATTRIBUTES, SENSORS, HELP, MAX_ZONES, emptyZone, zoneHasData, zoneComplete, installation, validateZones, reportZones, reportAvailable, pendingReport, initialZones }
