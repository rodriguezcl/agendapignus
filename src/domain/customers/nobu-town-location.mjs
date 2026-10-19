// Shared reference requested by the user: https://maps.app.goo.gl/5EQKRqUvUgz8aUe58
// Use the place coordinates (!3d/!4d), not the camera center (@lat,lng).
export const NOBU_TOWN_COORDINATES = Object.freeze([-31.4612923, -64.3059628])

export function isNobuTown(record = {}) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (normalize(record.installationZone) === 'nobu-town') return true
  return [record.address, record.street, record.locality, record.name, record.client, record.fields?.Calle, record.fields?.Localidad]
    .some(value => /\bno(?:bu|u)[\s-]*town\b/.test(normalize(value)))
}

export function nobuTownLocation(record) {
  if (!isNobuTown(record)) return null
  return {
    coordinates: NOBU_TOWN_COORDINATES,
    generic: true,
    label: 'Nobu Town · ubicación genérica del barrio; ubicación exacta del abonado no determinada',
    url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(NOBU_TOWN_COORDINATES.join(','))}`
  }
}
