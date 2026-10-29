const data = require('./permission-catalog-data.json')

const MODULES = data.modules
const PERMISSION_GROUPS = [...MODULES.filter(([id]) => id !== 'followups'), ['operationalPlanning', 'Planificación operativa'], ['notifications', 'Notificaciones']]
const CATALOG = data.catalog
const VERSION_KEY = '__catalogV2'
const SNAPSHOT = Symbol('resolved-permissions')
const BY_ID = Object.fromEntries(CATALOG.map(item => [item.id, item]))
const NOTIFICATION_IDS = CATALOG.filter(item => !item.hidden && item.id.startsWith('notifications.')).map(item => item.id)
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)
const SCOPE_KEYS = [
  'scope.services.read.assigned', 'scope.services.read.cctv',
  'scope.services.write.assigned', 'scope.services.write.cctv',
  'scope.customers.read.related', 'scope.customers.read.cctv'
]
const ALIASES = {
  ...Object.fromEntries(MODULES.map(([id]) => [id, [`${id}.view`]])),
  weeklyTeams: ['weekly.monthlyTeams.manage'],
  weeklyHours: ['weekly.monthlyHours.manage'],
  weeklyVehicles: ['weekly.monthlyVehicles.assign', 'weekly.controls.schedule'],
  weeklyGuards: ['weekly.guards.manage'],
  collectionsManage: ['collections.confirm', 'collections.amount', 'collections.method'],
  historyManage: ['history.edit', 'history.complete', 'history.reopen', 'history.cancel', 'history.delete', 'history.category', 'planning.reschedule'],
  accountsEdit: ['customers.create', 'customers.edit', 'customers.coordinates', 'customers.cctv', 'subscriptions.correct'],
  accountsDelete: ['customers.delete'],
  accountsImport: ['customers.import']
}
const rawPermissions = subject => subject?.permissions || subject || {}
const isGranular = subject => rawPermissions(subject)[VERSION_KEY] === true
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
function roleCode(subject) {
  const name = normalized(subject?.role || subject?.name)
  const explicit = subject?.roleCode || subject?.code
  if (!isGranular(subject) && ['operador', 'supervisor'].includes(name)) return name === 'operador' ? 'operator' : 'supervisor'
  return explicit || ({ administrador: 'administrator', tecnico: 'technician', coordinador: 'coordinator', usuario: 'user', supervisor: 'supervisor', operador: 'operator' }[name]) || `role-${subject?.roleId || subject?.id || 'unknown'}`
}
function legacySelection(subject) {
  const source = rawPermissions(subject), code = roleCode(subject)
  const admin = code === 'administrator', operator = code === 'operator', supervisor = code === 'supervisor', technician = code === 'technician'
  const technical = !operator && !supervisor && (technician || subject?.technicalEnabled === true)
  const moduleOn = id => admin || (operator ? id === 'weekly' : supervisor ? ['history', 'accounts'].includes(id) : technician ? id === 'technical' : id === 'dashboard' || source[id] === true)
  const feature = (key, parent) => admin || (!operator && !supervisor && !technician && source[parent] === true && source[key] === true)
  const plan = !operator && !supervisor && !technician && (moduleOn('weekly') || moduleOn('agenda'))
  const history = feature('historyManage', 'history')
  const accounts = feature('accountsEdit', 'accounts')
  const employee = !operator && !supervisor && !technician && moduleOn('employees')
  const service = !operator && !supervisor && !technician && moduleOn('services')
  const vehicle = !operator && !supervisor && !technician && moduleOn('vehicles')
  const documents = technical || operator || supervisor || plan || moduleOn('history')
  const documentsWrite = technical || plan || (!supervisor && !operator && moduleOn('history'))
  const financial = technical || !technician && !supervisor && (plan || operator || moduleOn('history') || moduleOn('collections') || moduleOn('accounts'))
  const result = Object.fromEntries(CATALOG.map(item => [item.id, admin]))
  const grant = (keys, enabled) => keys.split(' ').filter(Boolean).forEach(key => { if (BY_ID[key]) result[key] = admin || Boolean(enabled) })
  MODULES.forEach(([id]) => { result[`${id}.view`] = id === 'technical' ? admin || technical : moduleOn(id) })
  grant('sales.reserve', moduleOn('sales') && !technician && !operator && !supervisor)
  grant('followups.view followups.create', technical)
  grant('tickets.view tickets.create tickets.comment', operator || supervisor || technical || moduleOn('followups'))
  grant('tickets.customers.all', supervisor)
  grant('tickets.fromService', technical)
  grant('tickets.scope.assigned', operator || supervisor || technical || moduleOn('followups'))
  grant('records.read records.contact', operator || supervisor || technical || plan || moduleOn('history') || moduleOn('accounts') || moduleOn('collections'))
  grant('records.financial', financial)
  grant('records.export', technical || (!operator && !supervisor && moduleOn('history')))
  grant('customer.history', technical || moduleOn('accounts'))
  grant('dashboard.detail', result['records.read'] && moduleOn('dashboard'))
  grant('planning.create planning.edit planning.remove planning.ready planning.teams.create planning.teams.delete planning.technicians planning.reservation.create planning.freeze planning.journeys planning.copy', plan)
  grant('planning.notes planning.checklist planning.linkAccount planning.commercial planning.confirm planning.reservation.link planning.reschedule', plan || history)
  grant('weekly.daily', plan && moduleOn('weekly') && moduleOn('agenda'))
  grant('weekly.reorder weekly.advanceGuard', plan && moduleOn('weekly'))
  grant('weekly.monthlyTeams.read weekly.monthlyTeams.manage', feature('weeklyTeams', 'weekly'))
  grant('weekly.monthlyHours.read weekly.monthlyHours.manage', feature('weeklyHours', 'weekly'))
  grant('weekly.monthlyVehicles.read weekly.monthlyVehicles.assign weekly.controls.schedule', feature('weeklyVehicles', 'weekly'))
  grant('weekly.guards.read weekly.guards.manage', feature('weeklyGuards', 'weekly'))
  grant('agenda.clear', plan && moduleOn('agenda'))
  grant('history.edit history.complete history.reopen history.cancel history.delete history.bulk', history)
  grant('collections.timeline', moduleOn('collections') && financial)
  grant('collections.confirm collections.amount collections.method', feature('collectionsManage', 'collections'))
  grant('customers.create', accounts || plan)
  grant('customers.edit customers.coordinates customers.cctv subscriptions.correct customers.softguard.resolve', accounts)
  grant('customers.delete', feature('accountsDelete', 'accounts'))
  grant('customers.import', feature('accountsImport', 'accounts'))
  grant('subscriptions.read', moduleOn('accounts') && financial)
  grant('map.customer', moduleOn('map') && moduleOn('accounts'))
  grant('employees.create employees.edit employees.status employees.delete employees.password', employee)
  grant('services.create services.edit services.duration services.status services.delete', service)
  grant('vehicles.create vehicles.edit vehicles.mileage.edit vehicles.mileage.read vehicles.delete', vehicle)
  grant('vehicle.controls.read', operator || technical || vehicle || (!supervisor && moduleOn('history')) || plan)
  grant('vehicle.insurance.read vehicle.documents.read', technical || vehicle)
  grant('technical.start technical.history technical.advance technical.progress technical.complete technical.cancel technical.reschedule technical.vehicleControl', technical)
  grant('service.documents.read', documents)
  grant('service.documents.upload service.documents.deleteOwn', documentsWrite)
  grant('service.documents.deleteAny', !technician && !supervisor && !operator && (plan || moduleOn('history')))
  grant('settings.roles.read', moduleOn('settings'))
  grant('registration.read registration.manage', !technician && !operator && !supervisor && (plan || accounts || history))
  grant('settings.workday.read', moduleOn('settings') && feature('weeklyHours', 'weekly'))
  // Existing roles inherit notices from their effective task capabilities,
  // while a saved notification preference must remain explicit.
  if(!hasOwn(source,'notifications.followups'))delete result['notifications.followups']
  NOTIFICATION_IDS.forEach(id => {
    if (hasOwn(source, id)) result[id] = source[id] === true
    else delete result[id]
  })
  return result
}
function dependenciesMet(item, permissions) {
  return item.all.every(key => permissions[key] === true) && (!item.any.length || item.any.some(key => permissions[key] === true))
}
function normalizePermissions(selection) {
  selection = { ...selection }
  const ticketAliases = { 'tickets.view': 'followups.view', 'tickets.fromService': 'followups.create', 'tickets.assign': 'followups.assign', 'tickets.comment': 'followups.assign', 'tickets.internal': 'followups.assign', 'tickets.resolve': 'followups.resolve', 'notifications.tickets': 'notifications.followups' }
  for (const [next, previous] of Object.entries(ticketAliases)) if (!hasOwn(selection, next) && hasOwn(selection, previous)) selection[next] = selection[previous] === true

  const result = Object.fromEntries(CATALOG.map(item => [
    item.id,
    selection?.[item.id] === true || (NOTIFICATION_IDS.includes(item.id) && !hasOwn(selection, item.id))
  ]))
  let changed = true
  while (changed) {
    changed = false
    for (const item of CATALOG) {
      if (result[item.id] && !dependenciesMet(item, result)) { result[item.id] = false; changed = true }
    }
  }
  return result
}
function resolvePermissions(subject) {
  if (subject?.[SNAPSHOT]) return subject[SNAPSHOT]
  if (roleCode(subject) === 'administrator') return Object.fromEntries(CATALOG.map(item => [item.id, true]))
  return normalizePermissions(isGranular(subject) ? rawPermissions(subject) : legacySelection(subject))
}
// Explicit immutable request snapshots avoid resolving the catalogue for every
// record while ordinary mutable callers still observe revocations immediately.
function permissionSnapshot(subject) {
  if (subject?.[SNAPSHOT]) return subject
  const snapshot = { ...subject, permissions: Object.freeze({ ...rawPermissions(subject) }) }
  Object.defineProperty(snapshot, SNAPSHOT, { value: Object.freeze(resolvePermissions(snapshot)) })
  return Object.freeze(snapshot)
}
function can(subject, key) {
  const resolved = resolvePermissions(subject)
  return BY_ID[key] ? resolved[key] === true : Boolean(ALIASES[key]?.some(id => resolved[id] === true))
}
function permissionsWithAliases(subject) {
  const permissions = resolvePermissions(subject)
  return { ...permissions, ...Object.fromEntries(Object.entries(ALIASES).map(([key, ids]) => [key, ids.some(id => permissions[id])])) }
}
function scopeValue(subject, prefix, alternatives, fallback) {
  if (!isGranular(subject)) return fallback
  const selected = alternatives.filter(value => rawPermissions(subject)[`${prefix}.${value}`] === true)
  return selected.length > 1 ? 'none' : selected[0] || 'all'
}
function readScope(subject, resource = 'services') {
  const code = roleCode(subject)
  return resource === 'customers'
    ? scopeValue(subject, 'scope.customers.read', ['related', 'cctv'], code === 'supervisor' ? 'cctv' : code === 'technician' ? 'related' : 'all')
    : scopeValue(subject, 'scope.services.read', ['assigned', 'cctv'], code === 'supervisor' ? 'cctv' : code === 'technician' ? 'assigned' : 'all')
}
function writeScope(subject, resource = 'services') {
  return scopeValue(subject, `scope.${resource}.write`, ['assigned', 'cctv'], roleCode(subject) === 'technician' ? 'assigned' : roleCode(subject) === 'supervisor' ? 'cctv' : 'all')
}
function toGranularPermissions(subject) {
  const result = { [VERSION_KEY]: true, ...resolvePermissions(subject) }
  if (isGranular(subject)) SCOPE_KEYS.forEach(key => { if (rawPermissions(subject)[key] === true) result[key] = true })
  else {
    const serviceRead = readScope(subject), serviceWrite = writeScope(subject), customerRead = readScope(subject, 'customers')
    if (serviceRead !== 'all') result[`scope.services.read.${serviceRead}`] = true
    if (serviceWrite !== 'all') result[`scope.services.write.${serviceWrite}`] = true
    if (customerRead !== 'all') result[`scope.customers.read.${customerRead}`] = true
  }
  return result
}
function dependencyReason(key, selection) {
  const item = BY_ID[key]
  if (!item) return 'Permiso desconocido.'
  const effective = normalizePermissions(selection)
  const missing = item.all.filter(id => !effective[id]).map(id => BY_ID[id].label)
  if (item.any.length && !item.any.some(id => effective[id])) missing.push(`una de estas opciones: ${item.any.map(id => BY_ID[id].label).join(' / ')}`)
  return missing.length ? `Requiere ${missing.join(' y ')}.` : ''
}
function togglePermission(subject, key, enabled) {
  if (!BY_ID[key]) throw new Error('Permiso desconocido.')
  const before = toGranularPermissions(subject)
  if (enabled && dependencyReason(key, before)) return { permissions: before, removed: [], reason: dependencyReason(key, before) }
  const selected = { ...before, [key]: enabled === true }
  const permissions = { ...selected, ...normalizePermissions(selected) }
  return { permissions, removed: CATALOG.filter(item => item.id !== key && before[item.id] && !permissions[item.id]).map(item => item.id), reason: '' }
}
const READ_ONLY_IDS = new Set([
  ...NOTIFICATION_IDS,
  ...MODULES.map(([id]) => `${id}.view`), 'records.read', 'records.contact', 'records.financial', 'records.export', 'customer.history', 'dashboard.detail',
  'planning.copy', 'weekly.daily', 'weekly.monthlyTeams.read', 'weekly.monthlyHours.read', 'weekly.monthlyVehicles.read', 'weekly.guards.read',
  'collections.timeline', 'customers.backup', 'subscriptions.read', 'map.customer', 'employees.requests.read', 'vehicles.mileage.read',
  'vehicle.controls.read', 'vehicle.insurance.read', 'vehicle.documents.read', 'technical.history', 'service.documents.read', 'settings.roles.read',
  'settings.workday.read', 'audit.detail', 'registration.read', 'registration.sensitive'
])
function hasAnyWrite(subject) {
  const permissions = resolvePermissions(subject)
  return CATALOG.some(item => !READ_ONLY_IDS.has(item.id) && permissions[item.id])
}
function validateCatalog() {
  if (new Set(CATALOG.map(item => item.id)).size !== CATALOG.length) throw new Error('Hay permisos duplicados.')
  const visited = new Set()
  const visit = (id, pending) => {
    if (!BY_ID[id]) throw new Error(`Dependencia desconocida: ${id}`)
    if (pending.has(id)) throw new Error(`Dependencia circular: ${id}`)
    if (visited.has(id)) return
    for (const dependency of [...BY_ID[id].all, ...BY_ID[id].any]) visit(dependency, new Set([...pending, id]))
    visited.add(id)
  }
  CATALOG.forEach(item => visit(item.id, new Set()))
  return true
}
validateCatalog()

module.exports = { MODULES, PERMISSION_GROUPS, CATALOG, BY_ID, NOTIFICATION_IDS, VERSION_KEY, SCOPE_KEYS, ALIASES, isGranular, roleCode, resolvePermissions, permissionSnapshot, permissionsWithAliases, can, toGranularPermissions, readScope, writeScope, hasAnyWrite, dependenciesMet, dependencyReason, normalizePermissions, togglePermission, validateCatalog }
