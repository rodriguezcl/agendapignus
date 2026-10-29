// Address lookup only: travel continues to use the existing straight-line estimate.
// Photon public API: https://github.com/komoot/photon/blob/master/docs/api-v1.md
const cache = new Map(), pending = new Map()
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function photonResults(payload) {
  const seen = new Set()
  return (Array.isArray(payload?.features) ? payload.features : []).flatMap(feature => {
    const p = feature.properties || {}, [lon, lat] = feature.geometry?.coordinates || []
    if (feature.geometry?.type !== 'Point' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -35.2 || lat > -29.4 || lon < -65.9 || lon > -61.7 ||
      normalize(p.countrycode) !== 'ar' || !normalize(p.state).includes('cordoba')) return []
    // A city/region centroid is not a usable installation address.
    if (!p.street && !['house', 'street'].includes(p.type)) return []
    const coordinates = [lat, lon], key = coordinates.join(',')
    if (seen.has(key)) return []
    seen.add(key)
    const label = [...new Set([p.name, [p.street, p.housenumber].filter(Boolean).join(' '), p.district, p.city, p.state].filter(Boolean))].join(', ')
    return [{ coordinates, label, approximate: !p.housenumber, source: 'photon' }]
  }).slice(0, 5)
}
async function locateSalesAddress(input, { fetcher = globalThis.fetch, now = Date.now() } = {}) {
  const address = String(input.address || '').trim()
  if (address.length < 5 || address.length > 300) throw Object.assign(new Error('Ingresá una dirección con calle, altura y localidad, o marcá el lugar en el mapa.'), { statusCode: 400 })
  const { doctaLocation } = await import('../../src/domain/customers/customer-location.mjs')
  const { nobuTownLocation } = await import('../../src/domain/customers/nobu-town-location.mjs')
  const record = { address, installationZone: input.installationZone }
  const reference = nobuTownLocation(record) || doctaLocation(record)
  if (reference) return reference.unresolved
    ? { items: [], message: 'Para Docta indicá manzana y sector (Córdoba, Malagueño o Parque), o marcá el lugar en el mapa.' }
    : { items: [{ coordinates: reference.coordinates, label: reference.label, approximate: true, source: 'neighborhood' }] }
  const key = normalize(address)
  if (cache.get(key)?.expires > now) return structuredClone(cache.get(key).value)
  if (pending.has(key)) return structuredClone(await pending.get(key))
  const lookup = (async () => {
    const query = /cordoba/.test(key) ? `${address}, Argentina` : `${address}, Córdoba, Argentina`
    const url = new URL('https://photon.komoot.io/api/')
    url.search = new URLSearchParams({ q: query, limit: '5', lat: '-31.4167', lon: '-64.1833', bbox: '-65.9,-35.2,-61.7,-29.4' }).toString()
    let response
    try { response = await fetcher(url, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'PignusAgenda/2.0 (+https://agenda.pignusarg.com)', 'Accept': 'application/json' } }) }
    catch { throw Object.assign(new Error('No pudimos buscar la dirección. Podés reintentar o marcar el lugar en el mapa.'), { statusCode: 503 }) }
    if (!response.ok) throw Object.assign(new Error('La búsqueda de direcciones no está disponible. Marcá el lugar en el mapa o reintentá.'), { statusCode: 503 })
    let payload
    try { payload = await response.json() } catch { throw Object.assign(new Error('No pudimos interpretar la ubicación. Marcá el lugar en el mapa.'), { statusCode: 503 }) }
    const items = photonResults(payload), value = { items, ...(!items.length ? { message: 'No encontramos esa dirección. Agregá la localidad o marcá el lugar en el mapa.' } : {}) }
    if (cache.size >= 256) cache.delete(cache.keys().next().value)
    cache.set(key, { value, expires: now + 3600000 })
    return value
  })()
  pending.set(key, lookup)
  try { return structuredClone(await lookup) } finally { pending.delete(key) }
}
function salesAddress(input) {
  const address = String(input.address || '').trim()
  if (address.length > 300) throw Object.assign(new Error('La dirección no puede superar los 300 caracteres.'), { statusCode: 400 })
  if (address) return address
  const point = input.coordinates
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 85 || Math.abs(point[1]) > 180 || input.locationConfirmed !== true) {
    throw Object.assign(new Error('Ingresá la dirección o marcá el lugar de la instalación en el mapa.'), { statusCode: 400 })
  }
  return `Ubicación indicada en el mapa (${point.map(value => value.toFixed(6)).join(', ')})`
}
module.exports = { locateSalesAddress, photonResults, salesAddress }
