function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

const equivalent = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const serviceIdentity = service => String(service?.id ?? '').trim()

function serviceIsReferenced(serviceId, state = {}) {
  const matches = record => String(record?.serviceId ?? '') === String(serviceId)
  if ((state.history || []).some(matches)) return true
  const agenda = state.agenda || {}
  const teams = [
    ...(agenda.teams || []),
    ...Object.entries(agenda.weekly || {}).flatMap(([key, value]) => key === '_monthlyTeams'
      ? Object.values(value || {}).flatMap(config => config?.teams || [])
      : key.startsWith('_') ? [] : value?.teams || [])
  ]
  return teams.some(team => (team.tasks || []).some(matches))
}

function operationError(message, statusCode = 400, code = '') {
  const error = new Error(message)
  error.statusCode = statusCode
  if (code) error.code = code
  return error
}

function assertUnchanged(current, base) {
  if (!base || !equivalent(current, base)) {
    throw operationError('Este tipo de servicio cambió en otra sesión. Recargá la información antes de volver a guardar.', 409, 'SERVICE_WRITE_CONFLICT')
  }
}

function editableService(current, incoming) {
  return {
    ...current,
    name: String(incoming?.name || '').trim(),
    description: String(incoming?.description || '').trim(),
    estimatedMinutes: Number(incoming?.estimatedMinutes),
    status: incoming?.status === 'Inactivo' ? 'Inactivo' : 'Activo',
    id: current.id,
    code: current.code,
    category: current.category || incoming?.category || 'service'
  }
}

function applyServiceCatalogOperation(state = {}, { operation, service, base, serviceId } = {}) {
  const services = Array.isArray(state.services) ? state.services : []
  if (operation === 'create') {
    const id = serviceIdentity(service)
    if (!id) throw operationError('El tipo de servicio no tiene un identificador válido.')
    if (services.some(item => serviceIdentity(item) === id)) throw operationError('Ya existe un tipo de servicio con ese identificador.', 409, 'SERVICE_WRITE_CONFLICT')
    const created = { ...service, id, system: false }
    return { services: [...services, created], service: created, outcome: 'created' }
  }

  const id = String(serviceId ?? service?.id ?? base?.id ?? '').trim()
  const index = services.findIndex(item => serviceIdentity(item) === id)
  if (index < 0) throw operationError('El tipo de servicio ya no existe.', 404)
  const current = services[index]
  if (current.system) throw operationError('El servicio interno es administrado exclusivamente por el sistema.', 403)
  assertUnchanged(current, base)

  if (operation === 'delete') {
    if (serviceIsReferenced(id, state)) {
      const inactive = { ...current, status: 'Inactivo' }
      return { services: services.map((item, itemIndex) => itemIndex === index ? inactive : item), service: inactive, outcome: 'deactivated' }
    }
    return { services: services.filter((_, itemIndex) => itemIndex !== index), service: null, outcome: 'deleted' }
  }

  const updated = operation === 'toggle-status'
    ? { ...current, status: current.status === 'Activo' ? 'Inactivo' : 'Activo' }
    : operation === 'update'
      ? editableService(current, service)
      : null
  if (!updated) throw operationError('La operación solicitada no es válida.')
  return { services: services.map((item, itemIndex) => itemIndex === index ? updated : item), service: updated, outcome: 'updated' }
}

module.exports = { applyServiceCatalogOperation, serviceIsReferenced }
