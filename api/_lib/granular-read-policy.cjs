const permissions = require('./permission-catalog.cjs')
const { sanitizeTechnicianFollowup } = require('./technician-followup-access.cjs')
const id = value => String(value ?? '')
const any = (user, keys) => keys.some(key => permissions.can(user, key))
const FINANCIAL_FIELDS = new Set(['serviceCharges', 'collectionReview', 'collectionCancellation', 'originalCharges', 'amount', 'paymentMethod', 'monthlyFee', 'monthlyFeeEffectiveFrom', 'freezeMonthlyFee', 'frozenMonths', 'collection', 'subscriptionCorrectedAt', 'subscriptionCorrectedBy', 'form', 'formEmail'])
const CONTACT_FIELDS = new Set(['newAddress', 'softguardAddress', 'address', 'phone', 'email', 'contact', 'contactName', 'contactPhone', 'location', 'coordinates', 'latitude', 'longitude', 'lat', 'lng', 'mapsUrl', 'googleMapsUrl', 'formEmail', 'visitLocation'])
const DOCUMENT_FIELDS = new Set(['technicalObservation', 'alarmZones', 'technicalReport', 'servicePhotoUrl', 'servicePhotoUploadedBy', 'servicePhotoCanDelete', 'attachments', 'documents', 'photos'])
const omitFields = (value, fields) => Array.isArray(value) ? value.map(item => omitFields(item, fields)) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key)).map(([key, item]) => [key, omitFields(item, fields)])) : value
const account = value => String(value || '').trim().toUpperCase()
const normalizedKey = key => String(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function scrubFields(value, financial, contact) {
  if (Array.isArray(value)) return value.map(item => scrubFields(item, financial, contact))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    (financial || !FINANCIAL_FIELDS.has(key) && !/(abono|importe|monto|pago|factur|saldo|cobran|tarifa|precio|payment|monthlyfee|amount)/.test(normalizedKey(key))) &&
    (contact || !CONTACT_FIELDS.has(key) && !/(direccion|telefono|celular|correo|domicilio|contact|address|phone|email|coordinates|latitude|longitude)/.test(normalizedKey(key)))
  ).map(([key, item]) => [key, scrubFields(item, financial, contact)]))
}
const assigned = (record, user) => (record?.technicianIds || []).some(value => id(value) === id(user.id))
const unresolved = record => !record.technicalStatus && !['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado'].includes(record.status)
const customerIndexes = new WeakMap()
function customerForRecord(record, state) {
  const customers = state?.customers || []
  let index = customerIndexes.get(customers)
  if (!index) {
    index = { ids: new Map(customers.map(customer => [id(customer.customerId), customer])), accounts: new Map(customers.map(customer => [account(customer.account), customer])) }
    customerIndexes.set(customers, index)
  }
  return record?.customerId && index.ids.get(id(record.customerId)) || index.accounts.get(account(record?.clientAccount || String(record?.client || '').trim().split(/\s+/)[0]))
}

function matchesScope(scope, record, user, state, kind) {
  const scopes = Array.isArray(scope) ? scope : [scope]
  return scopes.every(value => !value || value === 'all' ||
    value === 'assigned' && assigned(record, user) ||
    value === 'cctv' && (kind === 'customers' ? record?.cctvService === true : customerForRecord(record, state)?.cctvService === true) ||
    value === 'related' && (state?.history || []).some(service => assigned(service, user) && customerForRecord(service, state) === record))
}

function serviceInReadScope(record, user, state) {
  return Boolean(record && matchesScope(permissions.readScope(user, 'services'), record, user, state, 'services'))
}

function serviceReadable(record, user, state) {
  if (!serviceInReadScope(record, user, state)) return false
  if (record.vehicleControl && permissions.can(user, 'vehicle.controls.read')) return true
  if (permissions.can(user, 'collections.view') && permissions.can(user, 'records.financial')) return true
  if (record.followup && permissions.can(user, 'followups.view')) return true
  if (!permissions.can(user, 'records.read')) return false
  if (any(user, ['weekly.view', 'agenda.view', 'history.view', 'dashboard.detail'])) return true
  const customer = customerForRecord(record, state)
  if (permissions.can(user, 'accounts.view') && permissions.can(user, 'customer.history') && customerReadable(customer, user, state)) return true
  if (!permissions.can(user, 'technical.view') || record.awaitingConfirmation === true) return false
  if (assigned(record, user) && (unresolved(record) || permissions.can(user, 'technical.history'))) return true
  if (!permissions.can(user, 'customer.history') || !customer) return false
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  return (state?.history || []).some(active => assigned(active, user) && active.awaitingConfirmation !== true && unresolved(active) && String(active.date || '') >= today && customerForRecord(active, state) === customer)
}

function serviceWritable(record, user, state) {
  return serviceInReadScope(record, user, state) && matchesScope(permissions.writeScope(user, 'services'), record, user, state, 'services')
}
function serviceExportable(record, user, state) {
  return serviceInReadScope(record, user, state) && permissions.can(user, 'records.export') &&
    (any(user, ['dashboard.view', 'history.view']) || permissions.can(user, 'technical.view') && assigned(record, user))
}

function customerReadable(customer, user, state) {
  return Boolean(customer && matchesScope(permissions.readScope(user, 'customers'), customer, user, state, 'customers'))
}

function sanitizeService(record, user, state) {
  if (!record) return record
  let result = scrubFields(record, permissions.can(user, 'records.financial'), permissions.can(user, 'records.contact'))
  if (!permissions.can(user, 'followups.view') && !permissions.can(user, 'tickets.view')) delete result.followup
  if (state) result.supervisorVisible = customerForRecord(record, state)?.cctvService === true
  if (!permissions.can(user, 'records.financial')) for (const key of FINANCIAL_FIELDS) delete result[key]
  if (!permissions.can(user, 'records.contact')) for (const key of CONTACT_FIELDS) delete result[key]
  if (!permissions.can(user, 'service.documents.read')) {
    result = omitFields(result, DOCUMENT_FIELDS)
  }
  if (!permissions.can(user, 'collections.view') && result.collection) {
    result.collection = omitFields(result.collection, new Set(['receipt', 'receipts']))
  }
  if (!permissions.can(user, 'collections.timeline') && result.collection) {
    result.collection = { ...result.collection }
    delete result.collection.events
    delete result.collection.original
    delete result.collection.receipts
  }
  if (!any(user, ['weekly.view', 'agenda.view', 'history.view'])) {
    delete result.internalNote
    delete result.internalChecklist
    delete result.servicePreparation
  }
  return sanitizeTechnicianFollowup(result, user)
}

function sanitizeCustomer(customer, user, auxiliary = false) {
  if (!customer) return customer
  const result = scrubFields(customer, permissions.can(user, 'subscriptions.read'), !auxiliary || permissions.can(user, 'records.contact'))
  if (!permissions.can(user, 'subscriptions.read')) for (const key of FINANCIAL_FIELDS) delete result[key]
  if (auxiliary && !permissions.can(user, 'records.contact')) for (const key of CONTACT_FIELDS) delete result[key]
  return result
}

function vehicleReadable(vehicle, user, state) {
  if (!vehicle) return false
  if (any(user, ['vehicles.view', 'weekly.monthlyVehicles.read'])) return true
  if (!any(user, ['vehicle.insurance.read', 'vehicle.documents.read', 'technical.vehicleControl'])) return false
  return (state?.history || []).some(record => id(record.vehicleId) === id(vehicle.id) && assigned(record, user) && serviceInReadScope(record, user, state))
}

function sanitizeVehicle(vehicle, user) {
  const result = { ...vehicle }
  if (!permissions.can(user, 'vehicles.mileage.read') && !permissions.can(user, 'vehicles.mileage.edit') && !permissions.can(user, 'technical.vehicleControl')) {
    for (const key of Object.keys(result)) if (key.startsWith('mileage')) delete result[key]
  }
  if (!permissions.can(user, 'vehicle.insurance.read')) {
    for (const key of Object.keys(result)) if (key.startsWith('insurance')) delete result[key]
  }
  return result
}

function granularVisibleState(state, user) {
  user = permissions.permissionSnapshot(user)
  const can = key => permissions.can(user, key)
  const history = (state.history || []).filter(record => serviceReadable(record, user, state))
  const visibleHistory = history
  const visibleIds = new Set(visibleHistory.map(record => id(record.id)))
  const visibleTasks = new Set(visibleHistory.map(record => id(record.sourceTaskId)).filter(Boolean))
  const taskAllowed = task => {
    if (task.historyId || task.sourceHistoryId) return visibleIds.has(id(task.historyId || task.sourceHistoryId))
    if (task.taskId || task.sourceTaskId) {
      const linked = (state.history || []).find(record => id(record.sourceTaskId) === id(task.taskId || task.sourceTaskId))
      if (linked) return visibleTasks.has(id(task.taskId || task.sourceTaskId))
    }
    return serviceReadable(task, user, state)
  }
  const teams = values => (values || []).map(team => ({ ...team, tasks: (team.tasks || []).filter(taskAllowed).map(task => sanitizeService(task, user, state)) }))
  const weekly = {}
  if (can('weekly.view')) for (const [key, value] of Object.entries(state.agenda?.weekly || {})) {
    if (!key.startsWith('_')) weekly[key] = { ...value, teams: teams(value?.teams) }
    else if (key === '_monthlyTeams') {
      weekly[key] = Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, {
        ...(can('weekly.monthlyTeams.read') ? { teams: teams(config.teams) } : { teams: (config.teams || []).map(({ teamId, label, memberIds, members }) => ({ teamId, label, memberIds, members })) }),
        ...(can('weekly.monthlyHours.read') ? { defaultTimes: config.defaultTimes, defaultTimePeriods: config.defaultTimePeriods } : {}),
        ...(can('weekly.monthlyVehicles.read') ? { vehicleAssignments: config.vehicleAssignments } : {}),
        ...(any(user, ['weekly.monthlyTeams.read', 'weekly.monthlyHours.read', 'weekly.monthlyVehicles.read']) ? { configurationHistory: config.configurationHistory } : {})
      }]))
    } else if (key === '_annualGuards') weekly[key] = can('weekly.guards.read') ? value : Object.fromEntries(Object.entries(value || {}).map(([year, config]) => [year, { startDate: config.startDate, rotation: config.rotation }]))
    else if (key === '_holidayOverrides') weekly[key] = value
  }
  // Planning needs the applicable workday to validate a proposed appointment.
  if (any(user, ['weekly.view', 'agenda.view', 'settings.workday.read']) && state.agenda?.weekly?._workday) weekly._workday = state.agenda.weekly._workday
  if (any(user, ['planning.freeze', 'settings.frozenMonths']) && state.agenda?.weekly?._frozenMonthOptions) weekly._frozenMonthOptions = state.agenda.weekly._frozenMonthOptions
  const customerLookup = any(user, ['planning.create', 'planning.linkAccount', 'planning.reservation.link', 'history.edit'])
  let customers = can('accounts.view') || can('map.view') || customerLookup ? (state.customers || []).filter(customer => customerReadable(customer, user, state)) : []
  if (can('accounts.view')) customers = customers.map(customer => sanitizeCustomer(customer, user))
  else if (can('map.view')) customers = customers.map(require('./subscriber-map-access.cjs').mapCustomer)
  else if (customerLookup) customers = customers.map(customer => {
    const safe = sanitizeCustomer(customer, user, true)
    return Object.fromEntries(['customerId', 'account', 'name', 'kind', 'status', 'softguardPresence', 'cctvService', 'excludeFromSubscriberCount', 'address', 'phone', 'email', 'location'].filter(key => safe[key] !== undefined).map(key => [key, safe[key]]))
  })
  else customers = []
  const employeeLookup = any(user, ['planning.technicians', 'planning.create', 'planning.reschedule', 'weekly.monthlyTeams.read', 'weekly.monthlyVehicles.read', 'weekly.guards.read'])
  const employees = can('employees.view') ? (state.employees || []).map(require('./employee-credentials.cjs').publicEmployee)
    : employeeLookup ? (state.employees || []).map(({ id, firstName, lastName, name, roleId, role, status, technicalEnabled }) => ({ id, firstName, lastName, name, roleId, role, status, technicalEnabled })) : []
  const roleLookup = employeeLookup || can('employees.view')
  const assignable = role => {
    try { require('./granular-write-policy.cjs').assertDelegable(user, role, state.roles); return true } catch { return false }
  }
  const roles = can('settings.roles.read') ? state.roles || []
    : (state.roles || []).filter(role => roleLookup || id(role.id) === id(user.roleId)).map(role => ({
      id: role.id, code: role.code, name: role.name,
      ...(id(role.id) === id(user.roleId) ? { permissions: role.permissions, description: role.description } : {}),
      ...(can('employees.view') ? { assignable: assignable(role) } : {})
    }))
  const metricRecord = record => ({
    ...Object.fromEntries(['id', 'date', 'status', 'service', 'serviceId', 'services', 'serviceIds', 'serviceTypes', 'subscriberReservation'].filter(key => record[key] !== undefined).map(key => [key, record[key]])),
    installationZone: record.installationZone || (/docta/i.test(`${record.address || ''} ${record.client || ''}`) ? 'docta' : /nobu/i.test(`${record.address || ''} ${record.client || ''}`) ? 'nobu-town' : 'residencial')
  })
  const metricHistory = can('dashboard.view') ? (state.history || []).filter(record => !visibleIds.has(id(record.id)) && serviceInReadScope(record, user, state)).map(metricRecord) : []
  const subscriptionHistory = can('subscriptions.read') ? (state.history || []).filter(record => !visibleIds.has(id(record.id)) && serviceInReadScope(record, user, state) && customerReadable(customerForRecord(record, state), user, state)).map(record => ({
    ...metricRecord(record),
    ...Object.fromEntries(['customerId', 'clientAccount', 'account', 'client', 'vehicleControl', 'monthlyFee', 'monthlyFeeEffectiveFrom', 'freezeMonthlyFee', 'frozenMonths', 'subscriptionCorrectedAt', 'subscriptionCorrectedBy'].filter(key => record[key] !== undefined).map(key => [key, record[key]]))
  })) : []
  const subscriptionIds = new Set(subscriptionHistory.map(record => id(record.id)))
  const historyWithZones = new Map([...visibleHistory.map(record => sanitizeService(record, user, state)), ...subscriptionHistory, ...metricHistory.filter(record => !subscriptionIds.has(id(record.id)))].map(record => [id(record.id), record]))
  if (can('accounts.view') && can('service.documents.read')) {
    for (const record of state.history || []) {
      if (!record.alarmZones || !serviceInReadScope(record, user, state) || !customerReadable(customerForRecord(record, state), user, state)) continue
      historyWithZones.set(id(record.id), { ...historyWithZones.get(id(record.id)), ...Object.fromEntries(['id','date','status','technicalStatus','customerId','client','clientAccount','alarmZones'].filter(key => record[key] !== undefined).map(key => [key,record[key]])) })
    }
  }
  return {
    revision: state.revision, roles, employees, customers,
    services: any(user, ['services.view', 'planning.create', 'planning.edit', 'history.edit', 'history.category']) ? state.services || [] : can('dashboard.view') ? (state.services || []).map(({ id, name, code, category }) => ({ id, name, code, category })) : [],
    vehicles: (state.vehicles || []).filter(vehicle => vehicleReadable(vehicle, user, state)).map(vehicle => sanitizeVehicle(vehicle, user)),
    history: [...historyWithZones.values()],
    agenda: any(user, ['weekly.view', 'agenda.view', 'settings.view']) ? { date: state.agenda?.date, teams: can('agenda.view') ? teams(state.agenda?.teams) : [], weekly } : null,
    preferences: {}
  }
}

function sanitizeAudit(value, user) {
  const withoutSecrets = item => Array.isArray(item) ? item.map(withoutSecrets)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).filter(([key]) => !['password', 'passwordHash'].includes(key)).map(([key, child]) => [key, withoutSecrets(child)])) : item
  const safe = withoutSecrets(scrubFields(value, permissions.can(user, 'records.financial'), permissions.can(user, 'records.contact')))
  return permissions.can(user, 'service.documents.read') ? safe : omitFields(safe, DOCUMENT_FIELDS)
}

module.exports = { customerForRecord, granularVisibleState, serviceReadable, serviceWritable, serviceExportable, serviceInReadScope, customerReadable, vehicleReadable, sanitizeService, sanitizeCustomer, sanitizeVehicle, sanitizeAudit, FINANCIAL_FIELDS, CONTACT_FIELDS }
