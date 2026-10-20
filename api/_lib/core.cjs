const { serviceIsCompleted, assertServiceCanBeCompleted, normalizeHistoryCompletionTimes } = require('./service-completion.cjs')
const { userCan, assertVehicleControlOmissionAuthorized } = require('./access-policy.cjs')
const { publicEmployee, auditSafe, hashPassword, verifyPassword } = require('./employee-credentials.cjs')
const { reportDate, compareReportRecords, professionalExcelHtml } = require('./report-formatting.cjs')
const crypto = require('node:crypto')
const { isOperator, operatorState } = require('./operator-access.cjs')
const { validateChangedAgendaSchedules } = require('./scheduling-validation.cjs')
const { migrateLegacyEstimatedMinutes } = require('./legacy-estimated-minutes.cjs')
const { ensureVehicleControlService } = require('./vehicle-control-service.cjs')
const { synchronizeVehicleControlAssignments } = require('./vehicle-control-assignment.cjs')
const { assertNoPastWeeklyServiceAdditions } = require('./past-agenda.cjs')
const { projectLegacyCollectionReceipts, restoreLegacyCollectionReceipts } = require('./legacy-collection-receipts.cjs')

const normalizedText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const normalizedRoleName = normalizedText
const normalizedServiceName = normalizedText

function legacyRoleCode(role = {}) {
  const name = normalizedRoleName(role.name)
  if (name === 'administrador') return 'administrator'
  if (name === 'tecnico') return 'technician'
  if (name === 'coordinador') return 'coordinator'
  if (name === 'usuario') return 'user'
  if (name === 'supervisor') return 'supervisor'
  if (name === 'operador') return 'operator'
  return `role-${role.id}`
}

function legacyServiceCode(service = {}) {
  return normalizedServiceName(service.name) === 'instalacion de alarma' ? 'alarm-installation' : `service-${service.id}`
}

const normalizeServiceEstimatedMinutes = value => {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 720 ? minutes : 60
}

function planningHistoryForAgenda(incomingHistory = [], currentHistory = [], agenda = {}) {
  const linked = new Set()
  const removed = new Set()
  const inspectPlan = plan => {
    ;(plan?.removedTaskIds || []).forEach(id => removed.add(String(id)))
    ;(plan?.teams || []).forEach(team => (team.tasks || []).forEach(task => {
      if (task.historyId) linked.add(String(task.historyId))
      if (task.taskId) linked.add(String(task.taskId))
    }))
  }
  inspectPlan({ teams: agenda.teams || [] })
  Object.entries(agenda.weekly || {}).forEach(([key, value]) => { if (!key.startsWith('_')) inspectPlan(value) })
  const incomingById = new Map(incomingHistory.map(record => [String(record.id), record]))
  const wasExplicitlyRemoved = record => {
    const id = String(record?.id || '')
    const sourceTaskId = String(record?.sourceTaskId || '')
    return Boolean(
      (id && (removed.has(id) || removed.has(`history:${id}`))) ||
      (sourceTaskId && (removed.has(sourceTaskId) || removed.has(`task:${sourceTaskId}`)))
    )
  }
  const protectedFields = ['journeyClosedAt', 'status', 'technicalStatus', 'technicalObservation', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'completedAt', 'startedAt', 'startedById', 'startedByName', 'advanceRequest', 'originalScheduledTime']
  const result = []
  for (const previous of currentHistory) {
    const id = String(previous.id)
    const sourceTaskId = String(previous.sourceTaskId || '')
    const proposed = incomingById.get(id)
    const closed = ['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado'].includes(previous.status) || Boolean(previous.technicalStatus)
    if (previous.serviceJourney && !closed && !previous.startedAt && wasExplicitlyRemoved(previous) && !linked.has(id) && !(sourceTaskId && linked.has(sourceTaskId))) {
      incomingById.delete(id)
      result.push({ ...previous, status: 'Cancelado', scheduledDate: '', awaitingConfirmation: false })
      continue
    }
    if (!proposed) {
      if (!previous.serviceJourney && !closed && wasExplicitlyRemoved(previous)) continue
      result.push(previous)
      continue
    }
    incomingById.delete(id)
    if (closed || (!linked.has(id) && !(sourceTaskId && linked.has(sourceTaskId)))) { result.push(previous); continue }
    const next = { ...proposed }
    protectedFields.forEach(field => {
      if (previous[field] == null || previous[field] === '') delete next[field]
      else next[field] = previous[field]
    })
    next.status = previous.status || 'Pendiente'
    result.push(next)
  }
  for (const proposed of incomingById.values()) {
    const id = String(proposed.id)
    const sourceTaskId = String(proposed.sourceTaskId || '')
    if (!linked.has(id) && !(sourceTaskId && linked.has(sourceTaskId))) continue
    const next = { ...proposed, status: 'Pendiente' }
    protectedFields.filter(field => field !== 'status').forEach(field => { delete next[field] })
    result.push(next)
  }
  return result
}

function technicianVehicle(vehicle = {}) {
  const { id, brand, model, year, plate, insuranceFileName } = vehicle
  return { id, brand, model, year, plate, insuranceFileName }
}

function userForEmployee(employee, roles) {
  const validRoles = Array.isArray(roles) ? roles.filter(item => item && typeof item === 'object') : []
  const role = validRoles.find(item => String(item.id) === String(employee?.roleId)) || validRoles.find(item => normalizedRoleName(item.name) === normalizedRoleName(employee?.role))
  if (!employee || !role) return null
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    roleId: role.id,
    roleCode: require('./permission-catalog.cjs').isGranular(role) ? require('./permission-catalog.cjs').roleCode(role) : normalizedRoleName(role.name) === 'operador' ? 'operator' : normalizedRoleName(role.name) === 'supervisor' ? 'supervisor' : role.code || legacyRoleCode(role),
    role: role.name,
    technicalEnabled: employee.technicalEnabled === true,
    permissions: role.permissions || {}
  }
}

function technicianSafeRecord(record = {}) {
  const { servicePreparation: _servicePreparation, internalNote: _internalNote, internalChecklist: _internalChecklist, monthlyFee: _monthlyFee, ...visible } = record
  for (const field of ['collection', 'monthlyFeeEffectiveFrom', 'freezeMonthlyFee', 'frozenMonths', 'subscriptionCorrectedAt', 'subscriptionCorrectedBy']) delete visible[field]
  const cashPayment = normalizedRoleName(visible.paymentMethod) === 'efectivo'
  const handwrittenForm = normalizedRoleName(visible.form).startsWith('incompleto')
  if (!cashPayment) {
    delete visible.paymentMethod
    delete visible.amount
  }
  if (!handwrittenForm) delete visible.form
  delete visible.formEmail
  return visible
}

function internalPlanningIsValid(record = {}) {
  const checklist = record.internalChecklist
  return String(record.internalNote || '').length <= 5000 &&
    (checklist == null || (Array.isArray(checklist) && checklist.length <= 30 && checklist.every(item => item && typeof item === 'object' && String(item.text || '').length <= 500 && typeof item.completed === 'boolean')))
}

function stateSessionUser(state, user) {
  const employee = (state.employees || []).find(item => String(item.id) === String(user.id))
  const refreshed = employee ? userForEmployee(employee, state.roles) : null
  const current = refreshed || user
  const safe = Object.fromEntries(['id', 'name', 'email', 'roleId', 'roleCode', 'role', 'technicalEnabled', 'permissions'].filter(key => current[key] !== undefined).map(key => [key, current[key]]))
  if (employee?.status === 'Inactivo') return { ...safe, roleCode: 'inactive', technicalEnabled: false, permissions: { __catalogV2: true } }
  return safe
}

function visibleStateForUser(state, user) {
  const sessionUser = stateSessionUser(state, user)
  return { ...projectStateForUser(state, sessionUser), sessionUser }
}

function visibleTechnicianStateForUser(state, user) {
  const sessionUser = stateSessionUser(state, user)
  const projectionUser = require('./permission-catalog.cjs').isGranular(sessionUser) ? sessionUser : { ...sessionUser, roleCode: 'technician' }
  return { ...projectStateForUser(state, projectionUser), sessionUser }
}

function projectStateForUser(state, user) {
  if (require('./permission-catalog.cjs').isGranular(user)) return require('./granular-read-policy.cjs').granularVisibleState(state, user)
  if (isOperator(user)) return projectLegacyCollectionReceipts(operatorState(state), user)
  if (user.roleCode === 'technician') {
    const journeyHistory = state.history
    state = { ...state, history: state.history.filter(record => record.awaitingConfirmation !== true) }
    const technicianId = String(user.id)
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
    const assignedHistory = state.history.filter(record => record.technicianIds?.some(id => String(id) === technicianId))
    const activeAssigned = assignedHistory.filter(record => String(record.date || '') >= today && !record.technicalStatus && !['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado'].includes(record.status))
    const activeCustomerIds = new Set(activeAssigned
      .map(record => String(record.customerId || ''))
      .filter(Boolean))
    const activeCustomerAccounts = new Set(activeAssigned
      .map(record => String(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0] || '').trim().toUpperCase())
      .filter(Boolean))
    const visibleHistory = state.history.filter(record => {
      if (record.technicianIds?.some(id => String(id) === technicianId)) return true
      const customerId = String(record.customerId || '')
      const account = String(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0] || '').trim().toUpperCase()
      return (customerId && activeCustomerIds.has(customerId)) || (account && activeCustomerAccounts.has(account))
    })
    return {
      revision: state.revision,
      roles: [], employees: [], services: [], vehicles: (state.vehicles || []).map(technicianVehicle), customers: [], agenda: null, preferences: {},
      history: visibleHistory.map(record => technicianSafeRecord(record.serviceJourney ? { ...record, journeyActiveIndexes: require('./service-journeys.cjs').activeJourneyIndexes(record, journeyHistory) } : record))
    }
  }
  if (user.roleCode === 'supervisor' || normalizedRoleName(user.role) === 'supervisor') {
    const trackedCustomers = (state.customers || []).filter(customer => customer?.cctvService === true)
    const customerIds = new Set(trackedCustomers.map(customer => String(customer.customerId || '')).filter(Boolean))
    const accounts = new Set(trackedCustomers.map(customer => String(customer.account || '').trim().toUpperCase()).filter(Boolean))
    const history = (state.history || []).filter(record => {
      const customerId = String(record.customerId || '')
      const account = String(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0] || '').trim().toUpperCase()
      return (customerId && customerIds.has(customerId)) || (account && accounts.has(account))
    }).map(record => {
      const { collection: _collection, servicePreparation: _servicePreparation, internalNote: _internalNote, internalChecklist: _internalChecklist, paymentMethod: _paymentMethod, amount: _amount, monthlyFee: _monthlyFee, form: _form, formEmail: _formEmail, ...visible } = record
      return visible
    })
    return { revision: state.revision, roles: [], employees: [], services: [], vehicles: [], customers: trackedCustomers, history, agenda: null, preferences: {} }
  }
  const canPlan = userCan(user, 'agenda') || userCan(user, 'weekly')
  return {
    revision: state.revision,
    roles: state.roles,
    employees: userCan(user, 'employees') ? state.employees.map(publicEmployee) : state.employees.map(({ id, firstName, lastName, name, roleId, role, status, technicalEnabled }) => ({ id, firstName, lastName, name, roleId, role, status, technicalEnabled: technicalEnabled === true })),
    services: userCan(user, 'services') || canPlan || userCan(user, 'history') ? ensureVehicleControlService(state.services) : [],
    vehicles: userCan(user, 'vehicles') || userCan(user, 'weeklyVehicles') ? state.vehicles || [] : [],
    customers: userCan(user, 'accounts') || canPlan || userCan(user, 'history') ? state.customers : userCan(user, 'map') ? (state.customers || []).map(require('./subscriber-map-access.cjs').mapCustomer) : [],
    history: userCan(user, 'history') || userCan(user, 'accounts') || userCan(user, 'collections') ? projectLegacyCollectionReceipts(state.history, user) : [],
    agenda: canPlan ? projectLegacyCollectionReceipts(state.agenda, user) : null,
    preferences: state.preferences
  }
}

function persistentStateInput(state) {
  // Match the root fields reconstructed by storage. Session/response metadata
  // and request options must never enter the operational state or its hash.
  return Object.fromEntries(['revision', 'roles', 'employees', 'services', 'vehicles', 'customers', 'history', 'reviews', 'agenda', 'preferences']
    .filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]]))
}

function authorizeIncomingState(incoming, current, user) {
  incoming = persistentStateInput(incoming)
  const retirementPolicy = require('./softguard-retirement-policy.cjs')
  incoming = retirementPolicy.protectSoftguardRetirementInput(incoming, current)
  if (require('./permission-catalog.cjs').isGranular(user)) return retirementPolicy.assertSoftguardRetirementDeletion(current, require('./granular-write-policy.cjs').authorizeGranularState(incoming, current, user))
  incoming = restoreLegacyCollectionReceipts(incoming, current, user)
  if (isOperator(user)) throw Object.assign(new Error('Operador tiene acceso de solo lectura.'), { statusCode: 403 })
  const administrator = user.roleCode === 'administrator'
  const canPlan = userCan(user, 'agenda') || userCan(user, 'weekly')
  assertVehicleControlOmissionAuthorized(incoming, current, user)
  let employees = current.employees
  if (administrator) employees = incoming.employees
  else if (userCan(user, 'employees')) {
    const previousById = new Map(current.employees.map(employee => [String(employee.id), employee]))
    const administratorRoleIds = new Set(current.roles.filter(role => (role.code || legacyRoleCode(role)) === 'administrator').map(role => String(role.id)))
    employees = (incoming.employees || []).map(employee => {
      const previous = previousById.get(String(employee.id))
      if (previous && administratorRoleIds.has(String(previous.roleId))) return previous
      if (!previous && administratorRoleIds.has(String(employee.roleId))) {
        const error = new Error('Solamente un administrador puede crear o asignar cuentas administrativas.')
        error.statusCode = 403
        throw error
      }
      return previous ? { ...employee, roleId: previous.roleId, role: previous.role, technicalEnabled: previous.technicalEnabled === true } : { ...employee, technicalEnabled: false }
    })
    current.employees.filter(employee => administratorRoleIds.has(String(employee.roleId)) && !employees.some(item => String(item.id) === String(employee.id))).forEach(employee => employees.push(employee))
  }
  const currentAgenda = current.agenda || {}
  const incomingAgenda = incoming.agenda || {}
  const { _workday: ignoredWorkday, _holidayOverrides: ignoredHolidayOverrides, _annualGuards: ignoredAnnualGuards, _monthlyTeams: ignoredMonthlyTeams, _frozenMonthOptions: ignoredFrozenMonthOptions, ...incomingWeeklyWithoutProtectedConfiguration } = incomingAgenda.weekly || {}
  const currentMonthly = currentAgenda.weekly?._monthlyTeams || {}
  const incomingMonthly = incomingAgenda.weekly?._monthlyTeams || {}
  const protectedMonthly = Object.fromEntries([...new Set([...Object.keys(currentMonthly), ...Object.keys(incomingMonthly)])].map(month => {
    const previous = currentMonthly[month] || {}
    const proposed = incomingMonthly[month] || {}
    const canConfigureAnything = ['weeklyTeams', 'weeklyHours', 'weeklyVehicles'].some(permission => userCan(user, permission))
    return [month, {
      ...previous,
      ...(userCan(user, 'weeklyTeams') ? { teams: proposed.teams ?? previous.teams } : {}),
      ...(userCan(user, 'weeklyHours') ? { defaultTimes: proposed.defaultTimes ?? previous.defaultTimes, defaultTimePeriods: proposed.defaultTimePeriods ?? previous.defaultTimePeriods } : {}),
      ...(userCan(user, 'weeklyVehicles') ? { vehicleAssignments: proposed.vehicleAssignments ?? previous.vehicleAssignments } : {}),
      ...(canConfigureAnything && proposed.configurationHistory ? { configurationHistory: proposed.configurationHistory } : {})
    }]
  }))
  const protectedWeekly = administrator ? incomingAgenda.weekly : {
    ...incomingWeeklyWithoutProtectedConfiguration,
    ...(currentAgenda.weekly?._workday ? { _workday: currentAgenda.weekly._workday } : {}),
    ...(currentAgenda.weekly?._frozenMonthOptions !== undefined ? { _frozenMonthOptions: currentAgenda.weekly._frozenMonthOptions } : {}),
    ...(currentAgenda.weekly?._holidayOverrides ? { _holidayOverrides: currentAgenda.weekly._holidayOverrides } : {}),
    ...(userCan(user, 'weeklyGuards') ? (incomingAgenda.weekly?._annualGuards ? { _annualGuards: incomingAgenda.weekly._annualGuards } : {}) : (currentAgenda.weekly?._annualGuards ? { _annualGuards: currentAgenda.weekly._annualGuards } : {})),
    ...(Object.keys(protectedMonthly).length ? { _monthlyTeams: protectedMonthly } : {})
  }
  const existingCustomerIds = new Set((current.customers || []).map(customer => String(customer.customerId)))
  const planningCustomers = canPlan ? [...(current.customers || []), ...(incoming.customers || []).filter(customer => !existingCustomerIds.has(String(customer.customerId)) && customerKind(customer) === 'client')] : current.customers
  let customers = planningCustomers
  if (userCan(user, 'accountsEdit')) {
    const proposedById = new Map((incoming.customers || []).map(customer => [String(customer.customerId), customer]))
    customers = (current.customers || []).map(customer => proposedById.get(String(customer.customerId)) || customer)
    ;(incoming.customers || []).filter(customer => !existingCustomerIds.has(String(customer.customerId))).forEach(customer => customers.push(customer))
  }
  if (userCan(user, 'accountsDelete')) {
    const incomingIds = new Set((incoming.customers || []).map(customer => String(customer.customerId)))
    customers = customers.filter(customer => !existingCustomerIds.has(String(customer.customerId)) || incomingIds.has(String(customer.customerId)))
  }
  const planningHistory = canPlan ? planningHistoryForAgenda(incoming.history || [], current.history || [], incomingAgenda) : current.history
  return retirementPolicy.assertSoftguardRetirementDeletion(current, require('./service-preparation.cjs').applyServicePreparation({
    ...incoming,
    roles: administrator ? incoming.roles : current.roles,
    employees,
    services: userCan(user, 'services') ? incoming.services : current.services,
    vehicles: userCan(user, 'vehicles') && Array.isArray(incoming.vehicles) ? incoming.vehicles : current.vehicles || [],
    history: userCan(user, 'historyManage') ? incoming.history : planningHistory,
    customers,
    reviews: current.reviews,
    agenda: {
      ...currentAgenda,
      ...(userCan(user, 'agenda') ? { date: incomingAgenda.date, teams: incomingAgenda.teams } : {}),
      ...(userCan(user, 'weekly') ? { weekly: protectedWeekly } : {})
    }
  }, current, user, canPlan))
}

function customerKind(customer) {
  if (customer.kind === 'subscriber' || customer.kind === 'client') return customer.kind
  return String(customer.account || '').toUpperCase().startsWith('PIG-') ? 'subscriber' : 'client'
}

function normalizeStateForSave(state, current, { allowEarlyCompletion = false } = {}) {
  state = persistentStateInput(state)
  require('./multi-service.cjs').validateServiceTypes(state)
  state = require('./service-schedule-sync.cjs').synchronizeServiceSchedules(state, current)
  state = require('./team-service-assignments.cjs').synchronizeTeamServiceAssignments(state, current)
  current ||= { roles: [], employees: [], services: [], vehicles: [], customers: [], history: [], reviews: [], agenda: {} }
  state = migrateLegacyEstimatedMinutes(state).state
  const roles = (state.roles || []).map(role => ({ ...role, code: role.code || legacyRoleCode(role) }))
  const roleById = new Map(roles.map(role => [String(role.id), role]))
  const employees = (state.employees || []).map(employee => {
    const role = roleById.get(String(employee.roleId))
    return { ...employee, name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(), ...(role ? { roleId: role.id, role: role.name } : {}) }
  })
  const services = ensureVehicleControlService((state.services || []).map(service => ({ ...service, code: service.code || legacyServiceCode(service), category: service.category || (normalizedServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service'), estimatedMinutes: normalizeServiceEstimatedMinutes(service.estimatedMinutes) })))
  const serviceById = new Map(services.map(service => [String(service.id), service]))
  const serviceByName = new Map(services.map(service => [normalizedServiceName(service.name), service]))
  const previousServiceById = new Map((current.services || []).map(service => [String(service.id), service]))
  const previousServiceByName = new Map((current.services || []).map(service => [normalizedServiceName(service.name), service]))
  const normalizeScheduledService = item => {
    const service = serviceById.get(String(item?.serviceId ?? '')) || serviceByName.get(normalizedServiceName(item?.service))
    if (!service) return item
    const previousService = previousServiceById.get(String(item?.serviceId ?? '')) || previousServiceByName.get(normalizedServiceName(item?.service))
    const previousDefault = normalizeServiceEstimatedMinutes(previousService?.estimatedMinutes, service.estimatedMinutes)
    const serviceDefaultChanged = Boolean(previousService) && previousDefault !== service.estimatedMinutes
    const closed = ['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado'].includes(item?.status)
    const customized = item.estimatedMinutesCustomized === true || (
      item.estimatedMinutesCustomized !== false && item.estimatedMinutes != null && Number(item.estimatedMinutes) !== Number(previousDefault)
    )
    // Un guardado de Clientes, Vehículos u otro módulo no debe reescribir la
    // agenda usando nuevamente el valor predeterminado del catálogo. Sólo se
    // propaga ese valor cuando el tipo de servicio cambió realmente.
    const estimatedMinutes = !previousService || serviceDefaultChanged
      ? (closed || customized ? normalizeServiceEstimatedMinutes(item.estimatedMinutes, service.estimatedMinutes) : service.estimatedMinutes)
      : normalizeServiceEstimatedMinutes(item.estimatedMinutes, service.estimatedMinutes)
    const estimatedMinutesCustomized = closed
      ? (item.estimatedMinutesCustomized ?? true)
      : (!previousService || serviceDefaultChanged ? customized : (item.estimatedMinutesCustomized ?? customized))
    return { ...item, serviceId: service.id, service: service.name, estimatedMinutes, estimatedMinutesCustomized }
  }
  const normalizeTeams = teams => deduplicateScheduledTasks((teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeScheduledService) })))
  const vehicles = (state.vehicles || []).map(vehicle => ({ ...vehicle, brand: String(vehicle.brand || '').trim(), model: String(vehicle.model || '').trim(), year: Number(vehicle.year), mileage: vehicle.mileage == null || vehicle.mileage === '' ? null : Number(vehicle.mileage), plate: String(vehicle.plate || '').trim().toLocaleUpperCase('es-AR') }))
  // Legacy accounts without a CCTV flag already mean "not tracked". Adding
  // false here migrates the whole customer catalog during an unrelated service
  // save and generates thousands of audit writes inside the same transaction.
  const customers = (state.customers || []).map(customer => ({ ...customer, kind: customerKind(customer), ...(Object.hasOwn(customer, 'cctvService') ? { cctvService: Boolean(customer.cctvService) } : {}), name: String(customer.name || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR') }))
  const history = normalizeHistoryCompletionTimes(
    (state.history || []).map(record => ({ ...normalizeScheduledService(record), status: record.status || 'Pendiente' })),
    current.history,
    new Date().toISOString(),
    { allowEarlyCompletion }
  )
  const incomingAgenda = state.agenda || {}
  const weekly = Object.fromEntries(Object.entries(incomingAgenda.weekly || {}).map(([key, value]) => key === '_monthlyTeams'
    ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: normalizeTeams(config?.teams) }]))]
    : [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }]))
  const agenda = { ...incomingAgenda, teams: normalizeTeams(incomingAgenda.teams), weekly }
  return normalizeRetirementCustomers(synchronizeVehicleControlAssignments({ ...state, roles, employees, services, vehicles, customers, history, agenda, reviews: state.reviews || current.reviews || [] }, current), current).state
}

function deduplicateScheduledTasks(teams = []) {
  const seen = new Set()
  return teams.map(team => ({
    ...team,
    tasks: (team.tasks || []).filter(task => {
      const taskId = String(task?.taskId || '').trim()
      const historyId = String(task?.historyId || '').trim()
      const identity = taskId ? `task:${taskId}` : historyId ? `history:${historyId}` : ''
      if (!identity) return true
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
  }))
}

function statePersistenceChanged(current, next) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    return value
  }
  const persistent = state => ({
    roles: state.roles || [], employees: state.employees || [], services: state.services || [], vehicles: state.vehicles || [],
    customers: state.customers || [], history: state.history || [], reviews: state.reviews || [],
    agenda: state.agenda || {}, preferences: { theme: state.preferences?.theme || 'light' }
  })
  return JSON.stringify(canonical(persistent(current))) !== JSON.stringify(canonical(persistent(next)))
}

function assertNoAccidentalHistoryWipe(currentHistory = [], nextHistory = [], maximumAutomaticDeletions = 9) {
  const nextIds = new Set((nextHistory || []).map(record => String(record.id)))
  const removed = (currentHistory || []).filter(record => !nextIds.has(String(record.id)))
  if (removed.length <= maximumAutomaticDeletions) return
  const error = new Error(`Se bloqueó la eliminación simultánea de ${removed.length} trabajos del historial para proteger los indicadores. Eliminá menos registros por vez o recargá la página.`)
  error.statusCode = 409
  error.code = 'HISTORY_BULK_DELETE_BLOCKED'
  throw error
}

function normalizeRetirementCustomers(state, previous = null) {
  const retiringCustomerIds = new Set((state.history || []).filter(record => record.status === 'Completado' && normalizedServiceName(record.service).includes('retiro de equipo')).map(record => String(record.customerId || '')).filter(Boolean))
  const currentRecords = new Map((state.history || []).map(record => [String(record.id), record]))
  const correctedCustomerIds = new Set((previous?.history || []).filter(record => {
    const next = currentRecords.get(String(record.id))
    return record.status === 'Completado' && normalizedServiceName(record.service).includes('retiro de equipo') && next && (next.status !== 'Completado' || !normalizedServiceName(next.service).includes('retiro de equipo')) && String(next.customerId) === String(record.customerId)
  }).map(record => String(record.customerId || '')).filter(Boolean))
  let nextNumber = Math.max(0, ...(state.customers || []).map(customer => Number(String(customer.account || '').match(/^CLI-(\d+)$/i)?.[1]) || 0)) + 1
  const conversions = new Map()
  const mergedCustomers = new Map()
  const removedCustomerIds = new Set()
  const customers = (state.customers || []).map(customer => {
    if (correctedCustomerIds.has(String(customer.customerId)) && !retiringCustomerIds.has(String(customer.customerId)) && customerKind(customer) === 'client' && /^PIG-/i.test(customer.convertedFromAccount || '')) {
      const account = String(customer.convertedFromAccount).trim().toUpperCase()
      const existing = state.customers.find(other => String(other.customerId) !== String(customer.customerId) && String(other.account || '').trim().toUpperCase() === account)
      if (existing) {
        const { matchesRetiredSubscriber, mergeRetiredSubscriber } = require('./retirement-customer-match.cjs')
        if (customerKind(existing) !== 'subscriber' || !matchesRetiredSubscriber(customer, existing)) throw new Error(`No se pudo restituir ${account}: esa cuenta pertenece a otro registro y no coincide suficientemente en nombre y teléfono o dirección. Revisá Abonados y clientes antes de corregir el retiro.`)
        if (retiringCustomerIds.has(String(existing.customerId))) throw new Error(`No se pudo restituir ${account}: el abonado tiene otro retiro completado. Revisá ese retiro antes de unir las cuentas.`)
        const restored = mergeRetiredSubscriber(customer, mergedCustomers.get(String(existing.customerId)) || existing)
        mergedCustomers.set(String(existing.customerId), restored)
        removedCustomerIds.add(String(customer.customerId))
        conversions.set(String(customer.customerId), { before: customer, after: restored })
        return customer
      }
      const { convertedFromAccount, convertedFromType, subscriptionEndedAt, softguardRetirementResolution, ...rest } = customer
      const restored = { ...rest, kind: 'subscriber', account, type: convertedFromType ?? 'Abonado' }
      conversions.set(String(customer.customerId), { before: customer, after: restored })
      return restored
    }
    if (!retiringCustomerIds.has(String(customer.customerId)) || customerKind(customer) !== 'subscriber') return customer
    const converted = { ...customer, kind: 'client', account: `CLI-${String(nextNumber++).padStart(4, '0')}`, type: 'Cliente de servicio', convertedFromAccount: customer.account, convertedFromType: customer.type, subscriptionEndedAt: new Date().toISOString() }
    delete converted.softguardRetirementResolution
    conversions.set(String(customer.customerId), { before: customer, after: converted })
    return converted
  }).filter(customer => !removedCustomerIds.has(String(customer.customerId))).map(customer => mergedCustomers.get(String(customer.customerId)) || customer)
  if (!conversions.size) return { state: { ...state, customers }, conversions: [] }
  const redirect = item => {
    const conversion = conversions.get(String(item?.customerId || ''))
    if (!conversion) return item
    const customer = conversion.after
    return { ...item, customerId: customer.customerId, clientAccount: customer.account, clientNameAtService: customer.name, client: `${customer.account} ${customer.name}` }
  }
  const redirectTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(redirect) }))
  const agenda = state.agenda || {}
  const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => key === '_monthlyTeams'
    ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: redirectTeams(config?.teams) }]))]
    : [key, key.startsWith('_') ? value : { ...value, teams: redirectTeams(value?.teams) }]))
  return {
    state: { ...state, customers, history: (state.history || []).map(redirect), reviews: (state.reviews || []).map(redirect), agenda: { ...agenda, teams: redirectTeams(agenda.teams), weekly } },
    conversions: [...conversions.values()]
  }
}

function secureEmployees(employees, previousEmployees) {
  const previousById = new Map(previousEmployees.map(employee => [String(employee.id), employee]))
  return employees.map(employee => {
    const previous = previousById.get(String(employee.id))
    const next = { ...employee }
    if (next.password?.trim() && (next.password.trim().length < 8 || !/[a-z]/.test(next.password) || !/[A-Z]/.test(next.password) || !/\d/.test(next.password))) throw new Error('Las contraseñas deben tener al menos 8 caracteres, una mayúscula, una minúscula y un número.')
    if (!previous && !next.password?.trim()) throw new Error('Todo empleado nuevo requiere una contraseña.')
    if (next.password?.trim()) next.passwordHash = hashPassword(next.password)
    else if (previous?.passwordHash) next.passwordHash = previous.passwordHash
    else if (previous?.password) next.passwordHash = hashPassword(previous.password)
    delete next.password
    return next
  })
}

function validateState(state, previousState = null) {
  require('./granular-write-policy.cjs').validateGranularRoles(state || {}, previousState)
  require('./workday.cjs').validateWorkday(state?.agenda?.weekly?._workday)
  require('./frozen-months.cjs').validateFrozenMonths(state, previousState)
  require('./multi-service.cjs').validateServiceTypes(state)
  require('./completed-service-policy.cjs').assertCompletedServices(state, previousState)
  require('./journey-identity.cjs').synchronizeJourneyIdentity(state, previousState)
  require('./service-journeys.cjs').validateServiceJourneys(state, previousState)
  const previousConfirmationRecords = new Map((previousState?.history || []).map(record => [String(record.id), record]))
  for (const record of state?.history || []) require('./service-confirmation.cjs').assertServiceConfirmationChange(previousConfirmationRecords.get(String(record.id)), record)
  if (!state || typeof state !== 'object') throw new Error('El estado recibido no es válido.')
  for (const name of ['roles', 'employees', 'services', 'vehicles', 'customers', 'history']) if (!Array.isArray(state[name])) throw new Error(`La colección ${name} no es válida.`)
  const unique = (items, key, label) => {
    const found = new Set()
    items.forEach((item, index) => {
      const value = String(item?.[key] ?? '').trim().toLowerCase()
      if (!value) throw new Error(`${label} ${index + 1}: falta ${key}.`)
      if (found.has(value)) throw new Error(`No puede haber ${label.toLowerCase()}s duplicados.`)
      found.add(value)
    })
  }
  unique(state.roles, 'id', 'Rol'); unique(state.roles, 'code', 'Código de rol')
  unique(state.employees, 'id', 'Empleado'); unique(state.employees, 'email', 'Correo electrónico')
  unique(state.services, 'id', 'Tipo de servicio'); unique(state.services, 'code', 'Código de servicio')
  unique(state.vehicles, 'id', 'Vehículo'); unique(state.vehicles, 'plate', 'Matrícula')
  unique(state.customers, 'account', 'Cliente'); unique(state.customers, 'customerId', 'Cliente')
  unique(state.history, 'id', 'Registro de historial')
  const roleIds = new Set(state.roles.map(item => String(item.id)))
  const serviceIds = new Set(state.services.map(item => String(item.id)))
  const serviceById = new Map(state.services.map(item => [String(item.id), item]))
  const customerIds = new Set(state.customers.map(item => String(item.customerId)))
  const employeeIds = new Set(state.employees.map(item => String(item.id)))
  const previousHistoryById = new Map((previousState?.history || []).map(item => [String(item.id), item]))
  const reservationUsesAlarmInstallation = record => {
    const service = serviceById.get(String(record.serviceId || ''))
    return service?.code === 'alarm-installation' || normalizedServiceName(service?.name || record.service) === 'instalacion de alarma'
  }
  state.employees.forEach((employee, index) => {
    if (!employee.firstName || !employee.lastName || !/^\S+@\S+\.\S+$/.test(String(employee.email || '')) || !roleIds.has(String(employee.roleId))) throw new Error(`Empleado ${index + 1}: datos incompletos.`)
  })
  state.services.forEach((service, index) => {
    if (!String(service.name || '').trim() || String(service.name).trim().length > 120) throw new Error(`Tipo de servicio ${index + 1}: el nombre es obligatorio o demasiado extenso.`)
    if (String(service.description || '').length > 500) throw new Error(`Tipo de servicio ${index + 1}: la descripción es demasiado extensa.`)
    if (!Number.isInteger(Number(service.estimatedMinutes)) || Number(service.estimatedMinutes) < 15 || Number(service.estimatedMinutes) > 720) throw new Error(`Tipo de servicio ${index + 1}: el tiempo estimado debe estar entre 15 minutos y 12 horas.`)
    if (!['Activo', 'Inactivo'].includes(service.status)) throw new Error(`Tipo de servicio ${index + 1}: el estado no es válido.`)
  })
  const maximumVehicleYear = new Date().getFullYear() + 1
  state.vehicles.forEach((vehicle, index) => {
    if (!String(vehicle.brand || '').trim() || String(vehicle.brand).trim().length > 80) throw new Error(`Vehículo ${index + 1}: la marca es obligatoria o demasiado extensa.`)
    if (!String(vehicle.model || '').trim() || String(vehicle.model).trim().length > 120) throw new Error(`Vehículo ${index + 1}: el modelo es obligatorio o demasiado extenso.`)
    if (!Number.isInteger(Number(vehicle.year)) || Number(vehicle.year) < 1886 || Number(vehicle.year) > maximumVehicleYear) throw new Error(`Vehículo ${index + 1}: el año no es válido.`)
    if (vehicle.mileage != null && (!Number.isInteger(Number(vehicle.mileage)) || Number(vehicle.mileage) < 0 || Number(vehicle.mileage) > 99999999)) throw new Error(`Vehículo ${index + 1}: el kilometraje no es válido.`)
    if (!String(vehicle.plate || '').trim() || String(vehicle.plate).trim().length > 20) throw new Error(`Vehículo ${index + 1}: la matrícula es obligatoria o demasiado extensa.`)
    if (vehicle.insuranceExpiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(vehicle.insuranceExpiresOn))) throw new Error(`Vehículo ${index + 1}: la fecha de vencimiento del seguro no es válida.`)
    if (String(vehicle.insuranceFileName || '').length > 180) throw new Error(`Vehículo ${index + 1}: el nombre del archivo de seguro es demasiado extenso.`)
  })
  state.history.forEach((record, index) => {
    if (record.date && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) throw new Error(`Historial ${index + 1}: fecha inválida.`)
    if (record.serviceId != null && !serviceIds.has(String(record.serviceId))) throw new Error(`Historial ${index + 1}: el tipo de servicio no existe.`)
    if (record.customerId != null && String(record.customerId).trim() && !customerIds.has(String(record.customerId))) throw new Error(`Historial ${index + 1}: el cliente no existe.`)
    if (record.subscriberReservation && String(record.customerId || '').trim()) throw new Error(`Historial ${index + 1}: una reserva PIG pendiente no puede estar vinculada a un cliente.`)
    if (record.subscriberReservation && !reservationUsesAlarmInstallation(record)) {
      const previous = previousHistoryById.get(String(record.id))
      const legacyUnchangedReservation = previous?.subscriberReservation && String(previous.serviceId || previous.service || '') === String(record.serviceId || record.service || '')
      if (!legacyUnchangedReservation) throw new Error(`Historial ${index + 1}: Reserva PIG sólo está disponible para Instalación de alarma.`)
    }
    if (record.subscriberReservation && ![record.clientNameAtService || record.client, record.address, record.phone].every(value => String(value || '').trim())) throw new Error(`Historial ${index + 1}: la reserva PIG debe incluir nombre, dirección y contacto provisorios.`)
    if ((record.technicianIds || []).some(id => !employeeIds.has(String(id)))) throw new Error(`Historial ${index + 1}: contiene un técnico inexistente.`)
    if (record.serviceId != null && (!Number.isInteger(Number(record.estimatedMinutes)) || Number(record.estimatedMinutes) < 15 || Number(record.estimatedMinutes) > 720)) throw new Error(`Historial ${index + 1}: el tiempo estimado debe estar entre 15 minutos y 12 horas.`)
    if (!internalPlanningIsValid(record)) throw new Error(`Historial ${index + 1}: la nota o el checklist interno contiene datos no válidos.`)
  })
  const agendaTeams = [...(state.agenda?.teams || [])]
  Object.entries(state.agenda?.weekly || {}).forEach(([key, plan]) => { if (!key.startsWith('_')) agendaTeams.push(...(plan?.teams || [])) })
  agendaTeams.forEach((team, teamIndex) => (team.tasks || []).forEach((task, taskIndex) => {
    if (!internalPlanningIsValid(task)) throw new Error(`Agenda: la nota o el checklist interno del servicio ${taskIndex + 1} del equipo ${teamIndex + 1} contiene datos no válidos.`)
  }))
  validateChangedAgendaSchedules(state, previousState)
  if (previousState) assertNoPastWeeklyServiceAdditions(state.agenda, previousState.agenda)
}

function auditChanges(previousRecords, nextRecords, key, entity, user) {
  const previous = new Map(previousRecords.map(record => [String(record[key]), record]))
  const incoming = new Map(nextRecords.map(record => [String(record[key]), record]))
  const entries = []
  const create = (action, entityId, before, after) => ({ id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role }, action, entity, entityId, before: auditSafe(before), after: auditSafe(after) })
  for (const [id, record] of incoming) {
    const old = previous.get(id)
    if (!old) entries.push(create('Creó', id, null, record))
    else if (JSON.stringify(auditSafe(old)) !== JSON.stringify(auditSafe(record))) entries.push(create('Modificó', id, old, record))
  }
  for (const [id, record] of previous) if (!incoming.has(id)) entries.push(create('Eliminó', id, record, null))
  return entries
}

module.exports = { assertNoAccidentalHistoryWipe, assertServiceCanBeCompleted, auditChanges, auditSafe, authorizeIncomingState, compareReportRecords, deduplicateScheduledTasks, hashPassword, legacyRoleCode, normalizedServiceName, normalizeHistoryCompletionTimes, normalizeRetirementCustomers, normalizeStateForSave, professionalExcelHtml, publicEmployee, reportDate, secureEmployees, statePersistenceChanged, stateSessionUser, technicianSafeRecord, userCan, userForEmployee, validateState, verifyPassword, visibleStateForUser, visibleTechnicianStateForUser }
