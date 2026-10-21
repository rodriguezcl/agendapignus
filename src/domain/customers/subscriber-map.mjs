import { activeSubscribers, subscriberZone } from './subscriber-policy.mjs'
import { doctaLocation, customerMapAddress } from './customer-location.mjs'
import { customerCoordinates, validCoordinates } from './customer-coordinates.mjs'
import { nobuTownLocation } from './nobu-town-location.mjs'

export const mapText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
export const MAP_ZONES = { docta: 'Docta', 'nobu-town': 'Nobu Town', residencial: 'Residenciales / otras zonas' }
export const MAP_QUALITY = { coordinates: 'Coordenadas informadas', block: 'Referencia de manzana', approximate: 'Referencia aproximada', generic: 'UbicaciÃ³n genÃ©rica del barrio', missing: 'Pendiente de ubicar' }

export function subscriberMapLocation(customer) {
  const nobu = nobuTownLocation(customer)
  if (nobu) return { coordinates: nobu.coordinates, quality: 'generic', reason: nobu.label }
  const docta = doctaLocation(customer)
  if (docta) return docta.unresolved
    ? { quality: 'missing', reason: docta.label }
    : { coordinates: docta.coordinates, quality: docta.approximate ? 'approximate' : 'block', reason: docta.label }
  const raw = String(customer.fields?.['UbicaciÃ³n de la cuenta'] || '').trim()
  const coordinates = customerCoordinates(customer)
  if (coordinates && Math.abs(coordinates[0]) <= 85 && Math.abs(coordinates[1]) <= 180 && coordinates.some(value => value !== 0)) {
    return { coordinates, quality: 'coordinates', reason: validCoordinates(customer.locationOverride) ? 'Coordenadas corregidas manualmente en la ficha del abonado.' : 'Coordenadas informadas en la cuenta; precisiÃ³n no verificada.' }
  }
  return { quality: 'missing', reason: raw ? 'La ubicaciÃ³n guardada no contiene coordenadas vÃ¡lidas.' : 'La direcciÃ³n todavÃ­a no tiene coordenadas guardadas.' }
}

export function subscriberMapRows(customers = []) {
  const rows = []
  for (const customer of activeSubscribers(customers)) {
    const account = mapText(customer.account).replace(/\s/g, '')
    const id = String(customer.customerId || '')
    const zone = subscriberZone(customer)
    const locality = String(customer.locality || customer.fields?.Localidad || '').trim()
    const [city, neighborhood = ''] = locality.split(/\s+-\s+(?:B[Â°Âº.]\s*|BARRIO\s+)/i)
    rows.push({ key: id || account, customer, zone, city: city || 'Sin localidad', neighborhood: neighborhood || 'Sin barrio informado', address: customerMapAddress(customer), ...subscriberMapLocation(customer) })
  }
  return rows.sort((a, b) => String(a.customer.name).localeCompare(String(b.customer.name), 'es'))
}

export function filterSubscriberMap(rows, { search = '', zone = '', city = '', neighborhood = '', quality = '' } = {}) {
  const query = mapText(search)
  return rows.filter(row => (!zone || row.zone === zone) && (!city || row.city === city) && (!neighborhood || row.neighborhood === neighborhood) &&
    (!quality || (quality === 'located' ? Boolean(row.coordinates) : row.quality === quality)) &&
    (!query || mapText([row.customer.account, row.customer.name, row.address, row.city, row.neighborhood].join(' ')).includes(query)))
}

export function groupMapLocations(rows) {
  const groups = new Map()
  for (const row of rows.filter(row => row.coordinates)) {
    const key = row.coordinates.join(',')
    if (!groups.has(key)) groups.set(key, { coordinates: row.coordinates, rows: [] })
    groups.get(key).rows.push(row)
  }
  return [...groups.values()]
}
