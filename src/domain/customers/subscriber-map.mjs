import { doctaLocation, customerMapAddress } from './customer-location.mjs'

export const mapText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
export const MAP_ZONES = { docta: 'Docta', 'nobu-town': 'Nobu Town', residencial: 'Residenciales / otras zonas' }
export const MAP_QUALITY = { coordinates: 'Coordenadas informadas', block: 'Referencia de manzana', approximate: 'Referencia aproximada', missing: 'Pendiente de ubicar' }

export function subscriberMapLocation(customer) {
  const docta = doctaLocation(customer)
  if (docta) return docta.unresolved
    ? { quality: 'missing', reason: docta.label }
    : { coordinates: docta.coordinates, quality: docta.approximate ? 'approximate' : 'block', reason: docta.label }
  const raw = String(customer.fields?.['Ubicación de la cuenta'] || '').trim()
  const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  const coordinates = match?.slice(1).map(Number)
  if (coordinates && Math.abs(coordinates[0]) <= 85 && Math.abs(coordinates[1]) <= 180 && coordinates.some(value => value !== 0)) {
    return { coordinates, quality: 'coordinates', reason: 'Coordenadas informadas en la cuenta; precisión no verificada.' }
  }
  return { quality: 'missing', reason: raw ? 'La ubicación guardada no contiene coordenadas válidas.' : 'La dirección todavía no tiene coordenadas guardadas.' }
}

export function subscriberMapRows(customers = []) {
  const rows = [], seenAccounts = new Set(), seenIds = new Set()
  for (const customer of customers) {
    const account = mapText(customer.account).replace(/\s/g, '')
    const id = String(customer.customerId || '')
    const active = customer.kind !== 'client' && (customer.kind === 'subscriber' || account.startsWith('pig-')) && !customer.subscriptionEndedAt && !['inactivo', 'baja', 'cancelado'].includes(mapText(customer.status))
    if (!active || (!account && !id) || (account && seenAccounts.has(account)) || (id && seenIds.has(id))) continue
    if (account) seenAccounts.add(account)
    if (id) seenIds.add(id)
    const context = mapText([customer.address, customer.street, customer.locality, customer.name, customer.fields?.Localidad].join(' '))
    const zone = context.includes('docta') ? 'docta' : /nobu\s*town/.test(context) ? 'nobu-town' : 'residencial'
    const locality = String(customer.locality || customer.fields?.Localidad || '').trim()
    const [city, neighborhood = ''] = locality.split(/\s+-\s+(?:B[°º.]\s*|BARRIO\s+)/i)
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
