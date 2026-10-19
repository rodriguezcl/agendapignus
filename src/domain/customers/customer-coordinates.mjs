// Keep manual corrections outside imported fields so refreshing the account
// register cannot replace a verified location with the old source coordinates.
export function validCoordinates(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180 && value.some(number => number !== 0)
}

export function customerCoordinates(customer = {}) {
  if (validCoordinates(customer.locationOverride)) return customer.locationOverride
  const match = String(customer.fields?.['Ubicación de la cuenta'] || '').trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  const coordinates = match?.slice(1).map(Number)
  return validCoordinates(coordinates) ? coordinates : null
}

export function coordinateDraftError(draft) {
  if (!draft) return ''
  const values = [draft.latitude, draft.longitude].map(value => String(value ?? '').trim())
  if (values.some(value => !/^[+-]?\d+(?:[.,]\d+)?$/.test(value))) return 'Ingresá latitud y longitud completas, usando punto o coma decimal.'
  const [latitude, longitude] = values.map(value => Number(value.replace(',', '.')))
  // The subscriber map uses Web Mercator and cannot display polar latitudes.
  if (Math.abs(latitude) > 85) return 'Para mostrar la ubicación en el mapa, la latitud debe estar entre −85 y 85.'
  if (Math.abs(longitude) > 180) return 'La longitud debe estar entre −180 y 180.'
  if (latitude === 0 && longitude === 0) return 'Ingresá la ubicación real del abonado; 0, 0 no es una ubicación válida.'
  return ''
}

export function applyCustomerCoordinateDraft(form) {
  const { coordinateDraft, ...customer } = form
  const error = coordinateDraftError(coordinateDraft)
  if (error) throw new Error(error)
  if (coordinateDraft) customer.locationOverride = [coordinateDraft.latitude, coordinateDraft.longitude].map(value => Number(String(value).trim().replace(',', '.')))
  return customer
}
