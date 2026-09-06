const VEHICLE_CONTROL_SERVICE = Object.freeze({
  id: 'vehicle-weekly-control',
  code: 'vehicle-weekly-control',
  category: 'vehicle-control',
  name: 'Control semanal de vehículo',
  description: 'Control interno de limpieza, fotografía y kilometraje de la flota.',
  estimatedMinutes: 15,
  status: 'Activo',
  system: true
})

const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

function ensureVehicleControlService(services = []) {
  let found = false
  const normalizedServices = (services || []).map(service => {
    const matches = service?.code === VEHICLE_CONTROL_SERVICE.code || normalized(service?.name) === normalized(VEHICLE_CONTROL_SERVICE.name)
    if (!matches) return service
    found = true
    return { ...service, ...VEHICLE_CONTROL_SERVICE }
  })
  return found ? normalizedServices : [...normalizedServices, { ...VEHICLE_CONTROL_SERVICE }]
}

module.exports = { ensureVehicleControlService, VEHICLE_CONTROL_SERVICE }
