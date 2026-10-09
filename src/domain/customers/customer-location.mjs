import { doctaMap } from './docta-map.mjs'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
export function doctaLocation(record = {}) {
  const account = normalize(record.account || record.clientAccount || String(record.client || '').split(/\s+/)[0]).trim()
  if (account === 'PIG-6248') return null
  const address = normalize(record.street || record.address || record.fields?.Calle)
  const context = normalize([record.address, record.street, record.locality, record.name, record.client, record.fields?.Localidad].join(' '))
  if (!context.includes('DOCTA') && record.installationZone !== 'docta' && account !== 'PIG-6962') return null
  const matches = [...address.matchAll(/\b(?:MANZANA|MZA?\.?)\s*(\d+)(?!\d|[A-Z])/g)]
  // A locality such as Malagueño 2 is a sector, not block 2.
  const shorthand = matches.length ? [] : [...address.matchAll(/^\s*MAL\.?\s*(\d+)\b/g)]
  const numbers = [...new Set([...matches, ...shorthand].map(m => Number(m[1])))]
  const sector = account === 'PIG-6962' || context.includes('DOCTA PARQUE') ? 'P'
    : /MALAGUENO|\bMAL\.?\s*\d/.test(context) ? 'M' : /CORDOBA/.test(context) ? 'C' : null
  if (numbers.length !== 1 || !sector) return { unresolved: true, label: 'Docta: ubicación pendiente de revisión' }
  const block = numbers[0]
  const nearest = Object.keys(doctaMap).filter(key => key.startsWith(sector)).map(key => Number(key.slice(1)))
    .sort((a, b) => Math.abs(a - block) - Math.abs(b - block) || a - b)[0]
  const reference = doctaMap[`${sector}${block}`] ? block : nearest
  const coordinates = doctaMap[`${sector}${reference}`]
  const approximate = reference !== block
  const zone = { C: 'Córdoba', M: 'Malagueño', P: 'Parque' }[sector]
  return { coordinates, approximate, block, reference, sector,
    label: `Docta ${zone} · manzana ${block}${approximate ? ` · referencia aproximada: manzana ${reference} (por número cercano)` : ' · referencia de manzana, no del lote'}`,
    url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates.join(','))}` }
}

export function customerLocationFields(customer) {
  const location = doctaLocation(customer)
  if (!location) return customer.fields || {}
  return { ...customer.fields, 'Ubicación de la cuenta': location.unresolved ? location.label : `${location.coordinates.join(', ')} — ${location.label}` }
}

export function serviceDirections(record) {
  const location = doctaLocation(record)
  if (location) return location // Docta never falls back to imported coordinates or text geocoding.
  return record.address ? { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(record.address)}`, label: 'Cómo llegar' } : null
}

const addressPart = value => {
  const text = String(value || '').trim()
  return text === '-' ? '' : text
}

export function customerMapAddress(customer = {}) {
  const street = addressPart(customer.street) || addressPart(customer.fields?.Calle)
  const locality = addressPart(customer.locality) || addressPart(customer.fields?.Localidad)
  const province = addressPart(customer.province) || addressPart(customer.fields?.['Provincia/Estado'])
  // Neighborhood descriptions are useful on the card, but can turn a street
  // lookup into an area lookup. Keep the city and the actual street address.
  const city = locality.split(/\s+-\s+(?:B[°º.]|BARRIO\b)/i)[0].trim()
  const parts = street ? [street, city, province] : [addressPart(customer.address)]
  const unique = parts.filter(Boolean).filter((part, index, all) => all.findIndex(other => normalize(other) === normalize(part)) === index)
  if (!unique.length || !/\p{L}/u.test(unique.join(' '))) return ''
  if (!/\bARGENTINA\b/i.test(unique.join(', '))) unique.push('Argentina')
  return unique.join(', ')
}

export function customerMapLocation(customer = {}) {
  const docta = doctaLocation(customer)
  if (docta?.unresolved) return docta
  const raw = String(customer.fields?.['Ubicación de la cuenta'] || '').trim()
  const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  const imported = match ? [Number(match[1]), Number(match[2])] : null
  const valid = imported && Math.abs(imported[0]) <= 90 && Math.abs(imported[1]) <= 180 && imported.some(value => value !== 0)
  const coordinates = docta?.coordinates || (valid ? imported : null)
  const address = customerMapAddress(customer)
  const query = coordinates?.join(',') || address
  if (!query || !coordinates && !/\p{L}/u.test(query)) return { unresolved: true, label: 'No hay una dirección o coordenadas válidas para mostrar el mapa.' }
  return {
    label: docta?.label || (coordinates ? 'Ubicación informada en la cuenta.' : 'Referencia por dirección. Verificá el resultado antes de viajar.'),
    address: coordinates ? null : address,
    embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`,
    url: docta?.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }
}
