const catalog = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')
const write = require('./granular-write-policy.cjs')
const { projectLegacyCollectionReceipts, restoreLegacyCollectionReceipts } = require('./legacy-collection-receipts.cjs')
const id = value => String(value ?? '')

function assertEndpointPermission(user, method, route) {
  if (!catalog.isGranular(user)) return
  const require = permission => write.requirePermission(user, permission)
  if (route.startsWith('/auth/') && !route.includes('password-reset-requests')) return
  if (route === '/auth/password-reset-requests') return require(method === 'GET' ? 'employees.requests.read' : 'employees.requests.resolve')
  if (['/state', '/state/revision', '/weather', '/holidays'].includes(route) && method === 'GET') return
  if (route === '/state' && ['PATCH', 'PUT'].includes(method)) {
    if (!catalog.hasAnyWrite(user)) write.fail('state.write')
    return
  }
  if (route === '/tickets/config' || route === '/tickets/mail') return require('tickets.configure')
  if (route === '/tickets' || route.startsWith('/tickets/')) return write.requireAny(user, ['tickets.view', 'tickets.configure'])
  if (route === '/followups') return write.requireAny(user, ['followups.view', 'tickets.view'])
  if (route === '/technician/state') return require('technical.view')
  if (route === '/technician/start') return require('technical.start')
  if (route === '/technician/status') return write.requireAny(user, ['technical.complete', 'technical.progress', 'technical.cancel', 'technical.reschedule', 'technical.vehicleControl'])
  if (route === '/technician/advance-request') return require('technical.advance')
  if (route.startsWith('/admin/advance-request/')) {
    if (catalog.roleCode(user) !== 'administrator') write.fail('administrator')
    return
  }
  if (route === '/history/export') return require('records.export')
  if (route === '/history/category-correction') return require('history.category')
  if (route === '/history/bulk') return require('history.bulk')
  if (route === '/history/work-completion') return write.requirePermission(user, 'history.edit')
  if (route.startsWith('/history/')) return method === 'DELETE' ? require('history.delete') : write.requireAny(user, ['history.edit', 'history.complete', 'history.reopen', 'history.cancel', 'planning.reschedule', 'planning.confirm', 'planning.reservation.link', 'planning.notes', 'planning.checklist'])
  if (route === '/collections/manage') return write.requireAny(user, ['collections.confirm', 'collections.amount', 'collections.method'])
  if (/^\/collections\/[^/]+\/receipts\/[^/]+$/.test(route)) {
    if (method !== 'GET') return write.fail('collections.confirm', 'Los comprobantes guardados se conservan en el historial.')
    require('collections.view')
    return require('records.financial')
  }
  if (route === '/customers/subscription-correction') return require('subscriptions.correct')
  if (route === '/customers/experience-mail') {
    require('accounts.view');require('records.contact')
    if(method==='GET')return
    if(method==='POST')return require('customers.experience.manage')
    return write.fail('customers.experience.manage')
  }
  if (route === '/customers/alarm-zones') {
    require('service.documents.read')
    if (method === 'GET') return
    if (method === 'POST') return require('customers.softguard.resolve')
    return write.fail('customers.softguard.resolve')
  }
  if (route === '/customers/softguard-retirement') return method === 'POST' ? require('customers.softguard.resolve') : write.fail('customers.softguard.resolve')
  if (route === '/customers/sync' || route === '/customers/sync/token') return require('customers.import')
  if (route === '/customers/import') return require(method === 'GET' ? 'customers.backup' : method === 'DELETE' ? 'customers.undo' : 'customers.import')
  if (route === '/audit' || route.startsWith('/audit/')) return require(route === '/audit' ? 'audit.view' : 'audit.detail')
  if (route === '/agenda/daily/clear') return require('agenda.clear')
  if (route.startsWith('/attachments/')) {
    const scope = route.split('/')[2]
    return scope === 'vehicle' ? require(`vehicle.documents.${method === 'GET' ? 'read' : method === 'POST' ? 'upload' : 'delete'}`)
      : method === 'GET' ? write.requireAny(user, ['service.documents.read', 'vehicle.controls.read']) : method === 'POST' ? require('service.documents.upload') : write.requireAny(user, ['service.documents.deleteOwn', 'service.documents.deleteAny'])
  }
  if (route.startsWith('/service-photo/')) return method === 'GET' ? require('service.documents.read') : method === 'POST' ? require('service.documents.upload') : write.requireAny(user, ['service.documents.deleteOwn', 'service.documents.deleteAny'])
  if (route.startsWith('/vehicle-control/photo/')) return require('vehicle.controls.read')
  if (route.startsWith('/vehicle-insurance/')) return require(method === 'GET' ? 'vehicle.insurance.read' : 'vehicle.insurance.write')
  if (route === '/services') return require('services.create')
  if (route.startsWith('/services/')) return method === 'DELETE' ? require('services.delete') : method === 'PATCH' ? require('services.status') : write.requireAny(user, ['services.edit', 'services.duration', 'services.status'])
  if (route === '/vehicles') return require('vehicles.create')
  if (route.startsWith('/vehicles/')) return method === 'DELETE' ? require('vehicles.delete') : write.requireAny(user, ['vehicles.edit', 'vehicles.mileage.edit', 'vehicle.insurance.write'])
  write.fail('endpoint', 'Esta ruta no está habilitada para el rol.')
}

function assertServiceAccess(user, record, state, { write: writing = false, permission } = {}) {
  if (!catalog.isGranular(user)) return
  if (permission) write.requirePermission(user, permission)
  if (!(writing ? read.serviceWritable(record, user, state) : read.serviceReadable(record, user, state))) write.fail(writing ? 'scope.services.write' : 'scope.services.read')
}

function assertTechnicalAction(user, record, state, type) {
  if (!catalog.isGranular(user)) return
  const key = record?.vehicleControl ? 'technical.vehicleControl' : ({
    'Completado': 'technical.complete', 'Avance registrado': 'technical.progress',
    'Cancelado': 'technical.cancel', 'Reprogramación solicitada': 'technical.reschedule',
    start: 'technical.start', advance: 'technical.advance'
  })[type]
  if (!key) write.fail('technical.action')
  assertServiceAccess(user, record, state, { write: true, permission: key })
  if (!require('./technical-capability.cjs').canPerformTechnicalServices(user) || !(record?.technicianIds || []).some(value => id(value) === id(user.id))) write.fail(key)
}

function assertCollectionAction(user, state, input) {
  if (!catalog.isGranular(user)) return
  const record = (state.history || []).find(row => id(row.id) === id(input.recordId))
  assertServiceAccess(user, record, state, { write: true })
  if (record?.collectionReview && input.action === 'correct') write.requirePermission(user, 'collections.amount')
  if (input.action === 'void') { write.requirePermission(user, 'collections.amount'); write.requirePermission(user, 'collections.method') }
  if (input.action === 'confirm' || input.action === 'receipt' || input.receipt != null) write.requirePermission(user, 'collections.confirm')
  if (Number(input.amount) !== Number(record?.amount)) write.requirePermission(user, 'collections.amount')
  if (input.paymentMethod !== record?.paymentMethod) write.requirePermission(user, 'collections.method')
}
function collectionInput(state, input, user, baseFor) {
  if (!catalog.isGranular(user)) return input
  const record = (state.history || []).find(row => id(row.id) === id(input.recordId))
  assertServiceAccess(user, record, state, { write: true })
  const visible = read.sanitizeService(record, user, state)
  if (!record || !write.same(baseFor(visible), input.base)) throw Object.assign(new Error('La cobranza cambió en otra sesión. Cerrá la ficha, actualizá y revisá los datos antes de guardar.'), { statusCode: 409 })
  return { ...input, base: baseFor(record) }
}
function assertLegacyPhoto(user, record, state, method, uploadedBy) {
  if (!catalog.isGranular(user)) return
  assertServiceAccess(user, record, state, { write: method !== 'GET', permission: method === 'GET' ? 'service.documents.read' : method === 'POST' ? 'service.documents.upload' : undefined })
  if (method === 'DELETE' && !catalog.can(user, 'service.documents.deleteAny') &&
      !(catalog.can(user, 'service.documents.deleteOwn') && id(uploadedBy) === id(user.id))) write.fail('service.documents.deleteOwn')
}

function serviceResponse(record, user) {
  return catalog.isGranular(user) ? read.sanitizeService(record, user) : projectLegacyCollectionReceipts(record, user)
}
function recordBaseMatches(current, base, user) {
  if (!catalog.isGranular(user)) return JSON.stringify(projectLegacyCollectionReceipts(current, user)) === JSON.stringify(projectLegacyCollectionReceipts(base, user))
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).filter(key => key !== 'supervisorVisible').sort().map(key => [key, normalize(value[key])]))
  }
  return JSON.stringify(normalize(read.sanitizeService(current, user))) === JSON.stringify(normalize(base))
}
function restoreServiceProposal(current, proposed, user, state) {
  if (!catalog.isGranular(user)) return restoreLegacyCollectionReceipts(proposed, current, user)
  const restored = write.restoreHidden(proposed, current, read.sanitizeService(current, user))
  return state ? write.prepareServiceProposal(current, restored, user, state) : restored
}
function catalogInput(kind, current, input, operation, user) {
  if (!catalog.isGranular(user) || operation.operation === 'create') return input
  const key = kind === 'vehicles' ? 'vehicle' : 'service'
  const record = (current[kind] || []).find(row => id(row.id) === id(operation[`${key}Id`]))
  if (!record) return input
  const visible = kind === 'vehicles' ? read.sanitizeVehicle(record, user) : record
  if (!write.same(visible, input.base)) throw Object.assign(new Error('Los datos cambiaron en otra sesión. Recargá y revisá antes de guardar.'), { statusCode: 409, code: 'CATALOG_WRITE_CONFLICT' })
  return { ...input, base: record, [key]: input[key] ? write.restoreHidden(input[key], record, visible) : input[key] }
}
function assertImportScope(user, current, nextCustomers) {
  if (!catalog.isGranular(user)) return
  for (const row of current.customers || []) {
    const next = nextCustomers.find(item => id(item.customerId) === id(row.customerId))
    if (!write.same(row, next) && !read.customerReadable(row, user, current)) write.fail('scope.customers.read')
  }
  for (const row of nextCustomers) if (!read.customerReadable(row, user, { ...current, customers: nextCustomers }) &&
    !(current.customers || []).some(old => id(old.customerId) === id(row.customerId) && write.same(old, row))) write.fail('scope.customers.read')
}
function subscriptionInput(state, input, user, baseFor) {
  if (!catalog.isGranular(user)) return input
  const record = (state.history || []).find(row => id(row.id) === id(input.recordId))
  const customer = (state.customers || []).find(row => id(row.customerId) === id(input.customerId))
  assertServiceAccess(user, record, state, { write: true, permission: 'subscriptions.correct' })
  if (!read.customerReadable(customer, user, state)) write.fail('scope.customers.read')
  const visible = read.granularVisibleState(state, user).history.find(row => id(row.id) === id(input.recordId))
  if (!visible || !write.same(baseFor(visible), input.base)) throw Object.assign(new Error('Los datos de la instalación cambiaron en otra sesión. Volvé a abrir el detalle.'), { statusCode: 409 })
  return { ...input, base: baseFor(record) }
}
module.exports = { assertEndpointPermission, assertServiceAccess, assertTechnicalAction, assertCollectionAction, collectionInput, assertLegacyPhoto, serviceResponse, recordBaseMatches, restoreServiceProposal, catalogInput, assertImportScope, subscriptionInput }
