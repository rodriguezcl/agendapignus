function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

const equivalent = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const identity = vehicle => String(vehicle?.id ?? '').trim()

function operationError(message, statusCode = 400, code = '') {
  const error = new Error(message)
  error.statusCode = statusCode
  if (code) error.code = code
  return error
}

function normalizedVehicle(vehicle = {}) {
  return {
    ...vehicle,
    id: identity(vehicle),
    brand: String(vehicle.brand || '').trim(),
    model: String(vehicle.model || '').trim(),
    year: Number(vehicle.year),
    mileage: Number(vehicle.mileage),
    plate: String(vehicle.plate || '').trim().toLocaleUpperCase('es-AR'),
    insuranceExpiresOn: String(vehicle.insuranceExpiresOn || '')
  }
}

function assertUniquePlate(vehicles, candidate, ignoredId = '') {
  if (vehicles.some(vehicle => identity(vehicle) !== String(ignoredId) && String(vehicle.plate || '').trim().toLocaleUpperCase('es-AR') === candidate.plate)) {
    throw operationError('Ya existe un vehículo con esa matrícula.', 409, 'VEHICLE_PLATE_CONFLICT')
  }
}

function applyVehicleOperation(state = {}, { operation, vehicle, base, vehicleId } = {}) {
  const vehicles = Array.isArray(state.vehicles) ? state.vehicles : []
  if (operation === 'create') {
    const created = normalizedVehicle(vehicle)
    if (!created.id) throw operationError('El vehículo no tiene un identificador válido.')
    if (vehicles.some(item => identity(item) === created.id)) throw operationError('Ya existe un vehículo con ese identificador.', 409, 'VEHICLE_WRITE_CONFLICT')
    assertUniquePlate(vehicles, created)
    return { vehicles: [...vehicles, created], vehicle: created, outcome: 'created' }
  }

  const id = String(vehicleId ?? vehicle?.id ?? base?.id ?? '').trim()
  const index = vehicles.findIndex(item => identity(item) === id)
  if (index < 0) throw operationError('El vehículo ya no existe.', 404)
  const current = vehicles[index]
  if (!base || !equivalent(current, base)) throw operationError('Este vehículo cambió en otra sesión. Recargá la información antes de volver a guardar.', 409, 'VEHICLE_WRITE_CONFLICT')
  if (operation === 'delete') return { vehicles: vehicles.filter((_, itemIndex) => itemIndex !== index), vehicle: null, outcome: 'deleted' }
  if (operation !== 'update') throw operationError('La operación solicitada no es válida.')
  const updated = normalizedVehicle({ ...current, ...vehicle, id: current.id })
  assertUniquePlate(vehicles, updated, id)
  return { vehicles: vehicles.map((item, itemIndex) => itemIndex === index ? updated : item), vehicle: updated, outcome: 'updated' }
}

module.exports = { applyVehicleOperation }
