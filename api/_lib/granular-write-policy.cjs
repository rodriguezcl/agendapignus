const { isDeepStrictEqual } = require('node:util')
const catalog = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')
const id = value => String(value ?? '')
const same = (a, b) => isDeepStrictEqual(a, b) || JSON.stringify(a) === JSON.stringify(b)
const changed = (before, after, keys) => keys.some(key => !same(before?.[key], after?.[key]))
const fail = (permission, detail = '') => { throw Object.assign(new Error(`No tenés permiso para esta acción (${permission}).${detail ? ` ${detail}` : ''}`), { statusCode: 403, code: 'PERMISSION_DENIED', permission }) }
const requirePermission = (user, permission) => { if (!catalog.can(user, permission)) fail(permission) }
const requireAny = (user, keys) => { if (!keys.some(key => catalog.can(user, key))) fail(keys.join(' / ')) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const identity = value => object(value) ? ['id', 'taskId', 'historyId', 'teamId', 'customerId'].find(key => value[key] != null) : null

// A client submits its authorized projection. Hidden rows and hidden fields
// must survive a PUT as well as PATCH. Unsolicited hidden values are ignored;
// visible changes pass through field and record authorization below.
function restoreHidden(proposed, current, visible) {
  if (proposed == null && visible == null && current != null) return current
  if (Array.isArray(current) && Array.isArray(proposed) && Array.isArray(visible)) {
    const key = [...current, ...visible, ...proposed].map(identity).find(Boolean)
    if (!key) return proposed
    const old = new Map(current.map(row => [id(row?.[key]), row]))
    const shown = new Map(visible.map(row => [id(row?.[key]), row]))
    const result = proposed.map(row => restoreHidden(row, old.get(id(row?.[key])), shown.get(id(row?.[key]))))
    const present = new Set(proposed.map(row => id(row?.[key])))
    current.forEach(row => { if (!shown.has(id(row?.[key])) && !present.has(id(row?.[key]))) result.push(row) })
    return result
  }
  if (!object(current) || !object(proposed)) return proposed
  const result = { ...proposed }
  if (Object.hasOwn(result, 'supervisorVisible') && !Object.hasOwn(current, 'supervisorVisible')) delete result.supervisorVisible
  if (Object.hasOwn(result, 'hasFollowup') && !Object.hasOwn(current, 'hasFollowup')) delete result.hasFollowup
  if (Object.hasOwn(result, 'assignable') && !Object.hasOwn(current, 'assignable')) delete result.assignable
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(visible || {}, key)) result[key] = current[key]
    else if (Object.hasOwn(proposed, key)) result[key] = restoreHidden(proposed[key], current[key], visible?.[key])
  }
  return result
}

const RECORD_GROUPS = {
  notes: ['internalNote'], checklist: ['internalChecklist'], ready: ['servicePreparation'],
  account: ['customerId', 'client', 'clientAccount', 'clientNameAtService'],
  commercial: ['serviceCharges', 'amount', 'paymentMethod', 'monthlyFee', 'form', 'formEmail'],
  freeze: ['freezeMonthlyFee', 'frozenMonths', 'monthlyFeeEffectiveFrom'],
  schedule: ['date', 'time', 'scheduledTime', 'scheduledDate', 'teamId', 'team', 'rescheduledFrom', 'reprogrammedAt', 'reschedulingHistory'],
  assignment: ['technicianIds', 'technicians'],
  confirm: ['awaitingConfirmation', 'confirmedAt', 'confirmedById', 'confirmedByName'],
  journey: ['serviceJourney'], reservation: ['subscriberReservation'],
  technical: ['workCompletion', 'technicalStatus', 'technicalObservation', 'alarmZones', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'completedAt', 'journeyClosedAt', 'startedAt', 'startedById', 'startedByName', 'advanceRequest', 'originalScheduledTime', 'vehicleMileage', 'vehiclePhotoUrl', 'vehicleControlReportedAt', 'technicianRequest'],
  system: ['id', 'historyId', 'taskId', 'sourceTaskId', 'sourceHistoryId', 'createdBy', 'createdAt', 'updatedAt', 'status', 'collection', 'supervisorVisible', 'sourceTicketId', 'ticketNumber', 'ticketResolution'],
  general: ['service', 'serviceId', 'services', 'serviceIds', 'serviceTypes', 'estimatedMinutes', 'estimatedMinutesCustomized', 'detail', 'description', 'address', 'phone', 'location', 'category', 'vehicleId', 'vehicleControl', 'guard', 'guardAdvance', 'advancedGuard']
}
const classified = new Set(Object.values(RECORD_GROUPS).flat())
const nonempty = value => value != null && value !== '' && value !== false && value !== 0 && (!Array.isArray(value) || value.length)
function validScheduledControl(record, state, day = record?.date) {
  if (!record?.vehicleControl) return false
  const friday = String(record.vehicleControlScheduledFriday || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(friday) || new Date(`${friday}T12:00:00Z`).getUTCDay() !== 5) return false
  const month = friday.slice(0, 7), config = state.agenda?.weekly?._monthlyTeams?.[month]
  const assignment = config?.vehicleAssignments?.find(item => id(item.vehicleId) === id(record.vehicleId))
  const responsible = assignment?.weeklyOverrides?.[friday] || assignment?.technicianId
  const employee = (state.employees || []).find(item => id(item.id) === id(responsible))
  const vehicle = (state.vehicles || []).find(item => id(item.id) === id(record.vehicleId))
  let expectedDay = friday
  for (let count = 0; count < 14; count++) {
    const weekday = new Date(`${expectedDay}T12:00:00Z`).getUTCDay()
    if (weekday >= 1 && weekday <= 5 && state.agenda?.weekly?._holidayOverrides?.[expectedDay]?.status !== 'closed') break
    const date = new Date(`${expectedDay}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); expectedDay = date.toISOString().slice(0, 10)
  }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const expectedId = `vehicle-control-${friday}-${record.vehicleId}`
  return Boolean(assignment && employee && vehicle && expectedDay === day && day >= today && record.monthlyVehicleAssignment === month &&
    id(record.id || record.historyId) === expectedId && id(record.sourceTaskId || record.taskId) === expectedId &&
    record.serviceId === 'vehicle-weekly-control' && record.service === 'Control semanal de vehículo' && record.time === '15:45' && Number(record.estimatedMinutes) === 15 &&
    same((record.technicianIds || []).map(String), [id(responsible)]) && same(record.technicians, [employee.name]) &&
    !record.customerId && !record.address && !record.phone && !record.startedAt && !record.completedAt && !record.technicalStatus && (!record.status || record.status === 'Pendiente'))
}

function assertServiceChange(before, after, user, state, { planning = false, task = false, monthlyAssignment = null } = {}) {
  require('./softguard-presence.cjs').assertActiveService(before,after,state.customers)
  if (same(before, after)) return
  const populated = value => value && ['serviceId', 'service', 'customerId', 'client', 'vehicleControl', 'subscriberReservation'].some(key => nonempty(value[key]))
  if (task && !populated(before) && !populated(after)) return
  if (task && before && !populated(before) && populated(after)) return assertServiceChange(null, after, user, state, { planning, task })
  const scopeRecord = before || after
  if (!read.serviceWritable(scopeRecord, user, state) || after && !read.serviceWritable(after, user, { ...state, history: [...(state.history || []).filter(row => id(row.id) !== id(after.id)), after] })) fail('scope.services.write')
  if (!after) {
    requirePermission(user, planning ? 'planning.remove' : 'history.delete')
    if (before.vehicleControl) requirePermission(user, planning ? 'vehicle.controls.omit' : 'vehicle.controls.delete')
    return
  }
  if (!before) {
    requirePermission(user, after.vehicleControl ? 'weekly.controls.schedule' : 'planning.create')
    if (after.vehicleControl && !validScheduledControl(after, state)) fail('weekly.controls.schedule', 'El control debe coincidir con la asignación mensual guardada.')
    if (after.serviceJourney) requirePermission(user, 'planning.journeys')
    if (after.subscriberReservation) requirePermission(user, 'planning.reservation.create')
    if (after.customerId) requirePermission(user, 'planning.linkAccount')
    if (after.sourceTicketId) requirePermission(user, 'tickets.linkService')
    if (after.ticketResolution) fail('planning.create', 'La resolución del ticket debe provenir del informe técnico.')
    if (nonempty(after.internalNote)) requirePermission(user, 'planning.notes')
    if (nonempty(after.internalChecklist)) requirePermission(user, 'planning.checklist')
    if (RECORD_GROUPS.commercial.some(key => nonempty(after[key]))) requirePermission(user, 'planning.commercial')
    if (RECORD_GROUPS.freeze.some(key => nonempty(after[key]))) requirePermission(user, 'planning.freeze')
    if (after.servicePreparation?.ready) requirePermission(user, 'planning.ready')
    if (after.status && after.status !== 'Pendiente' || RECORD_GROUPS.technical.some(key => nonempty(after[key])) || after.collection) fail('planning.create', 'Un servicio nuevo no puede contener un informe o una cobranza ya registrados.')
    return
  }
  const scheduled = catalog.can(user, 'weekly.controls.schedule') && validScheduledControl(after, state) && !before.startedAt && !before.completedAt && !before.technicalStatus
  if (changed(before, after, ['sourceTicketId', 'ticketNumber'])) requirePermission(user, 'tickets.linkService')
  if (changed(before, after, ['ticketResolution'])) fail('history.edit', 'La resolución del ticket debe provenir del informe técnico.')
  const scheduleDerived = scheduled ? new Set(['technicianIds', 'technicians', 'teamId', 'team', 'date', 'time', 'vehicleBrand', 'vehicleModel', 'vehiclePlate', 'vehicleMileageAtScheduling', 'vehicleControlScheduledFriday', 'monthlyVehicleAssignment', 'client']) : new Set()
  for (const key of ['id', 'taskId', 'historyId', 'sourceTaskId', 'sourceHistoryId', 'createdAt', 'createdBy']) {
    if (before[key] != null && !same(before[key], after[key])) fail('records.identity', 'No se puede alterar la identidad o atribución del servicio.')
  }
  if (changed(before, after, RECORD_GROUPS.notes)) requirePermission(user, 'planning.notes')
  if (changed(before, after, RECORD_GROUPS.checklist)) requirePermission(user, 'planning.checklist')
  if (changed(before, after, RECORD_GROUPS.ready)) requirePermission(user, 'planning.ready')
  const training = !before.customerId && !after.customerId && /capacitacion/.test(String(after.service || before.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
  if (changed(before, after, RECORD_GROUPS.account.filter(key => !scheduleDerived.has(key)))) requirePermission(user, training ? planning ? 'planning.edit' : 'history.edit' : before.subscriberReservation && !after.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')
  if (changed(before, after, RECORD_GROUPS.commercial)) requirePermission(user, 'planning.commercial')
  if (changed(before, after, RECORD_GROUPS.freeze)) requirePermission(user, 'planning.freeze')
  if (changed(before, after, RECORD_GROUPS.confirm)) requirePermission(user, 'planning.confirm')
  if (changed(before, after, RECORD_GROUPS.journey)) requirePermission(user, 'planning.journeys')
  if (changed(before, after, RECORD_GROUPS.reservation)) requirePermission(user, after.subscriberReservation ? 'planning.reservation.create' : 'planning.reservation.link')
  if (changed(before, after, RECORD_GROUPS.assignment) && !scheduled && !(monthlyAssignment && same(after.technicianIds, monthlyAssignment.memberIds) && same(after.technicians, monthlyAssignment.members))) requirePermission(user, 'planning.technicians')
  if (changed(before, after, RECORD_GROUPS.schedule.filter(key => !scheduleDerived.has(key)))) {
    const timeOnly = !changed(before, after, RECORD_GROUPS.schedule.filter(key => !['time', 'scheduledTime'].includes(key)))
    requireAny(user, timeOnly ? ['planning.reschedule', 'weekly.reorder'] : ['planning.reschedule'])
  }
  if (changed(before, after, ['guardAdvance', 'advancedGuard'])) requirePermission(user, 'weekly.advanceGuard')
  const rescheduling = before.date !== after.date && catalog.can(user, 'planning.reschedule')
  const statusChanged = (before.status || 'Pendiente') !== (after.status || 'Pendiente')
  if (statusChanged) {
    const permission = ['Completado', 'Avance registrado'].includes(after.status) ? 'history.complete'
      : after.status === 'Pendiente' ? rescheduling ? 'planning.reschedule' : 'history.reopen'
        : after.status === 'Cancelado' ? 'history.cancel'
          : after.status === 'Reprogramado' ? 'planning.reschedule' : 'history.edit'
    requirePermission(user, permission)
    if (before.vehicleControl && after.status === 'Cancelado') requirePermission(user, 'vehicle.controls.omit')
  }
  if (changed(before, after, ['collection'])) fail('collections.confirm', 'La cobranza sólo puede modificarse mediante su operación específica.')
  if (changed(before, after, RECORD_GROUPS.technical)) {
    const reopening = statusChanged && after.status === 'Pendiente'
    const completing = statusChanged && ['Completado', 'Avance registrado', 'Cancelado'].includes(after.status)
    if (!reopening && !completing && !rescheduling) fail('technical.report', 'El informe técnico sólo puede modificarse mediante una acción de estado autorizada.')
  }
  const linked = id(before.customerId) !== id(after.customerId) || before.subscriberReservation && !after.subscriberReservation
  const linkDerived = linked ? new Set(['address', 'phone', 'newCustomer', 'reservationOriginal', 'reservationLinkedAt', 'reservationLinkedBy']) : new Set()
  const general = [...Object.keys(before), ...Object.keys(after)].filter(key => !linkDerived.has(key) && !scheduleDerived.has(key) && (!classified.has(key) || RECORD_GROUPS.general.includes(key)))
  if (changed(before, after, general)) {
    if (planning) requirePermission(user, 'planning.edit')
    else requirePermission(user, 'history.edit')
  }
  if (!task && id(before.id) !== id(after.id)) fail('records.identity')
}

function prepareServiceProposal(before, after, user, state) {
  if (!after) return after
  if (before?.date && after.date && before.date !== after.date && !after.vehicleControl) {
    requirePermission(user, 'planning.reschedule')
    const now = new Date().toISOString()
    const visitKeys = ['date', 'time', 'scheduledTime', 'teamId', 'team', 'technicianIds', 'technicians', 'status', 'startedAt', 'startedById', 'startedByName', 'technicalStatus', 'technicianRequest', 'technicalObservation', 'alarmZones', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'completedAt']
    const visit = Object.fromEntries(visitKeys.filter(key => before[key] !== undefined).map(key => [key, before[key]]))
    after = { ...after, status: 'Pendiente', scheduledDate: '', technicianRequest: '', technicalStatus: '', technicalObservation: '', technicalReportedAt: '', technicalReportedById: '', technicalReportedByName: '', startedAt: '', startedById: '', startedByName: '', completedAt: '', rescheduledFrom: before.date, reprogrammedAt: now, reschedulingHistory: [...(before.reschedulingHistory || []), { ...visit, reprogrammedAt: now }] }
  }
  const linking = before && (id(before.customerId) !== id(after.customerId) || before.subscriberReservation && !after.subscriberReservation)
  if (!after.customerId || (!linking && before)) return after
  const customer = (state.customers || []).find(row => id(row.customerId) === id(after.customerId))
  if (!customer || !read.customerReadable(customer, user, state)) fail('scope.customers.read')
  if (linking) requirePermission(user, before.subscriberReservation ? 'planning.reservation.link' : 'planning.linkAccount')
  const result = { ...after, address: customer.address || '', phone: customer.phone || '' }
  if (linking) Object.assign(result, { newCustomer: false, subscriberReservation: false, client: `${customer.account} ${customer.name}`, clientAccount: customer.account, clientNameAtService: customer.name })
  if (linking && before.subscriberReservation) Object.assign(result, {
    reservationOriginal: before.reservationOriginal || { name: before.clientNameAtService || before.client || '', address: before.address || '', phone: before.phone || '' },
    reservationLinkedAt: new Date().toISOString(), reservationLinkedBy: { id: user.id, name: user.name, role: user.role }
  })
  return result
}

function validateGranularRoles(state, previous) {
  const known = new Set([catalog.VERSION_KEY, ...catalog.SCOPE_KEYS, ...catalog.CATALOG.map(item => item.id)])
  for (const role of state.roles || []) {
    const prior = (previous?.roles || []).find(item => id(item.id) === id(role.id))
    if (catalog.isGranular(prior) && !catalog.isGranular(role)) fail('settings.roles.permissions', 'Un rol migrado no puede volver a permisos heredados.')
    if (Object.hasOwn(role.permissions || {}, catalog.VERSION_KEY) && role.permissions[catalog.VERSION_KEY] !== true) fail('settings.roles.permissions', 'La versión del catálogo no es válida.')
    if (!catalog.isGranular(role)) continue
    for (const [key, value] of Object.entries(role.permissions || {})) if (!known.has(key) || typeof value !== 'boolean') fail('settings.roles.permissions', 'El catálogo contiene una clave o valor inválido.')
    if (catalog.roleCode(role) === 'administrator' && catalog.SCOPE_KEYS.some(key => role.permissions[key] === true)) fail('settings.roles.permissions', 'El administrador debe conservar alcance completo para recuperar los accesos.')
    if (catalog.readScope(role) === 'none' || catalog.writeScope(role) === 'none' || catalog.readScope(role, 'customers') === 'none') fail('settings.roles.permissions', 'Elegí un único alcance por recurso.')
    if (prior && prior.code !== role.code) fail('settings.roles.edit', 'El identificador del rol no puede modificarse.')
  }
  if (previous && [...(state.roles || []), ...(previous.roles || [])].some(catalog.isGranular)) assertActiveAdministrator(state, previous)
}

function monthlyAssignments(before, after, user) {
  const teams = new Map(), records = new Map()
  if (!catalog.can(user, 'weekly.monthlyTeams.manage')) return { teams, records }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const signature = ids => JSON.stringify((ids || []).map(String).sort())
  const pending = task => !task.startedAt && !task.completedAt && !task.technicalStatus && (!task.status || task.status === 'Pendiente')
  const history = before.history || []
  for (const [day, plan] of [...Object.entries(before.agenda?.weekly || {}), [before.agenda?.date, before.agenda]]) {
    if (!day || day.startsWith('_') || day < today || [0, 6].includes(new Date(`${day}T12:00:00`).getDay())) continue
    const month = day.slice(0, 7), oldMonthly = before.agenda?.weekly?._monthlyTeams?.[month]?.teams || [], newMonthly = after.agenda?.weekly?._monthlyTeams?.[month]?.teams || []
    if (same(oldMonthly, newMonthly)) continue
    for (const team of plan?.teams || []) {
      const prior = oldMonthly.find(row => id(row.teamId) === id(team.teamId)), replacement = newMonthly.find(row => id(row.teamId) === id(team.teamId))
      const linked = task => history.find(record => record.date === day && (task.historyId && id(task.historyId) === id(record.id) || task.taskId && id(task.taskId) === id(record.sourceTaskId || record.taskId)))
      if (!prior || !replacement || team.guardOverride || team.monthlyStaffingOverride || signature(team.memberIds) !== signature(prior.memberIds) || (team.tasks || []).some(task => !pending(task) || !pending(linked(task) || {}))) continue
      teams.set(`${day}/${team.teamId}`, replacement)
      for (const task of team.tasks || []) {
        const record = linked(task)
        if (task.vehicleControl || task.technicianIds?.length && signature(task.technicianIds) !== signature(prior.memberIds) || record?.technicianIds?.length && signature(record.technicianIds) !== signature(prior.memberIds)) continue
        if (record) records.set(id(record.id), replacement)
      }
    }
  }
  return { teams, records }
}

function collectionChanges(before = [], after = [], key, action) {
  const old = new Map(before.map(row => [id(row[key]), row]))
  const next = new Map(after.map(row => [id(row[key]), row]))
  for (const row of before) if (!next.has(id(row[key]))) action(row, null)
  for (const row of after) if (!same(old.get(id(row[key])), row)) action(old.get(id(row[key])), row)
}

function assertDelegable(user, proposed, currentRoles = []) {
  const target = catalog.toGranularPermissions(proposed)
  const actor = catalog.toGranularPermissions(user)
  const protectedAdmin = catalog.roleCode(proposed) === 'administrator'
  if (protectedAdmin && catalog.roleCode(user) !== 'administrator') fail('employees.role', 'Las cuentas administrativas requieren un administrador.')
  for (const key of Object.keys(target)) {
    if (key === '__catalogV2' || key.startsWith('scope.')) continue
    if (target[key] === true && !catalog.can(user, key)) fail('settings.roles.permissions', `No podés delegar ${key}.`)
  }
  for (const resource of ['services', 'customers']) {
    const own = catalog.readScope(user, resource), granted = catalog.readScope(proposed, resource)
    if (own !== 'all' && granted !== own) fail('settings.roles.permissions', 'El alcance delegado excede tu alcance.')
  }
  const ownWrite = catalog.writeScope(user, 'services')
  if (ownWrite !== 'all' && catalog.writeScope(proposed, 'services') !== ownWrite) fail('settings.roles.permissions', 'El alcance de escritura delegado excede tu alcance.')
}

function assertActiveAdministrator(state, previous) {
  const administrators = value => new Set((value.roles || []).filter(role => catalog.roleCode(role) === 'administrator').map(role => id(role.id)))
  const before = administrators(previous), after = administrators(state)
  if (!(previous.employees || []).some(employee => before.has(id(employee.roleId)) && employee.status === 'Activo')) return
  if (!(state.employees || []).some(employee => after.has(id(employee.roleId)) && employee.status === 'Activo')) fail('settings.roles.permissions', 'Debe conservarse al menos un administrador activo.')
  const active = (state.employees || []).filter(employee => after.has(id(employee.roleId)) && employee.status === 'Activo')
  if (!active.some(employee => {
    const role = state.roles.find(row => id(row.id) === id(employee.roleId))
    return catalog.can(role, 'settings.roles.permissions') && catalog.can(role, 'employees.role')
  })) fail('settings.roles.permissions', 'Debe conservarse una cuenta administrativa capaz de recuperar roles y accesos.')
}

function assertEmployeeChange(before, after, user, state) {
  if (!after) requirePermission(user, 'employees.delete')
  else if (!before) requirePermission(user, 'employees.create')
  const oldRole = state.roles.find(role => id(role.id) === id(before?.roleId))
  const nextRole = state.roles.find(role => id(role.id) === id(after?.roleId))
  if (catalog.roleCode(oldRole) === 'administrator' || catalog.roleCode(nextRole) === 'administrator') {
    if (catalog.roleCode(user) !== 'administrator') fail('employees.role', 'Las cuentas administrativas están protegidas.')
  }
  if (!after) return
  if (!before || changed(before, after, ['roleId', 'role'])) {
    if (before) requirePermission(user, 'employees.role')
    if (nextRole) assertDelegable(user, nextRole, state.roles)
  }
  if (changed(before, after, ['technicalEnabled']) && after.technicalEnabled === true || before && changed(before, after, ['technicalEnabled'])) requirePermission(user, 'employees.technical')
  if (!before) return
  if (changed(before, after, ['status'])) requirePermission(user, 'employees.status')
  if (after.password && after.password !== before.password || changed(before, after, ['passwordHash'])) requirePermission(user, 'employees.password')
  const ordinary = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !['id', 'roleId', 'role', 'technicalEnabled', 'status', 'password', 'passwordHash'].includes(key))
  if (changed(before, after, ordinary)) requirePermission(user, 'employees.edit')
}

function assertCustomerChange(before, after, user, state) {
  if (before && !read.customerReadable(before, user, state) || after && !read.customerReadable(after, user, { ...state, customers: [...state.customers.filter(row => id(row.customerId) !== id(after.customerId)), after] })) fail('scope.customers.read')
  if (!after) return requirePermission(user, 'customers.delete')
  if (!before) return requirePermission(user, 'customers.create')
  if (changed(before, after, ['coordinates', 'latitude', 'longitude', 'lat', 'lng', 'locationOverride', 'locationSource', 'geocodedAt'])) requirePermission(user, 'customers.coordinates')
  if (changed(before, after, ['cctvService'])) requirePermission(user, 'customers.cctv')
  const ordinary = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !['customerId', 'coordinates', 'latitude', 'longitude', 'lat', 'lng', 'locationOverride', 'locationSource', 'geocodedAt', 'cctvService'].includes(key))
  if (changed(before, after, ordinary)) requirePermission(user, 'customers.edit')
}

function assertCatalogChange(kind, before, after, user) {
  if (!after) return requirePermission(user, `${kind}.delete`)
  if (!before) return requirePermission(user, `${kind}.create`)
  const special = kind === 'services' ? { estimatedMinutes: 'services.duration', status: 'services.status' }
    : { mileage: 'vehicles.mileage.edit', insuranceExpiresOn: 'vehicle.insurance.write', insuranceFileName: 'vehicle.insurance.write', insuranceUploadedAt: 'vehicle.insurance.write', insuranceDocumentUrl: 'vehicle.insurance.write' }
  for (const [key, permission] of Object.entries(special)) if (changed(before, after, [key])) requirePermission(user, permission)
  const ordinary = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => key !== 'id' && !Object.hasOwn(special, key))
  if (changed(before, after, ordinary)) requirePermission(user, `${kind}.edit`)
}

function assertAgendaChange(before = {}, after = {}, user, state, derived = { teams: new Map(), records: new Map() }) {
  const inspectTeams = (oldTeams = [], newTeams = [], day) => {
    let templates = state.agenda?.weekly?._monthlyTeams?.[String(day).slice(0, 7)]?.teams || []
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 6) {
      const config = state.agenda?.weekly?._annualGuards?.[String(day).slice(0, 4)], rotation = (config?.rotation || []).filter(item => item?.technicianId || item?.name)
      const start = new Date(`${String(day).slice(0, 4)}-01-01T12:00:00Z`); start.setUTCDate(start.getUTCDate() + ((6 - start.getUTCDay() + 7) % 7))
      const weeks = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${config?.startDate || start.toISOString().slice(0, 10)}T12:00:00Z`)) / 604800000)
      const guard = rotation.length ? rotation[((weeks % rotation.length) + rotation.length) % rotation.length] : null
      templates = !oldTeams.length && newTeams.length === 1 && guard ? [{ teamId: newTeams[0].teamId, label: 'Equipo 1', memberIds: [guard.technicianId], members: [guard.name] }] : []
    }
    const generatedControls = catalog.can(user, 'weekly.controls.schedule') && newTeams.some(team => (team.tasks || []).some(task => validScheduledControl(task, state, day)))
    const planningMaterialization = catalog.can(user, 'planning.create') || catalog.can(user, 'planning.reschedule')
    const materializedTemplate = team => (generatedControls || planningMaterialization) && templates.some(template =>
      id(template.teamId) === id(team.teamId) && same(template.memberIds || [], team.memberIds || []) && same(template.members || [], team.members || []) &&
      (!team.label || team.label === template.label) && Object.keys(team).every(key => ['teamId', 'memberIds', 'members', 'label', 'tasks'].includes(key)) &&
      (planningMaterialization || (team.tasks || []).every(task => !['serviceId', 'service', 'customerId', 'client', 'vehicleControl', 'subscriberReservation'].some(key => nonempty(task[key])) || validScheduledControl(task, state, day))))
    collectionChanges(oldTeams, newTeams, 'teamId', (old, next) => {
      if (!old && !materializedTemplate(next)) requirePermission(user, 'planning.teams.create')
      else if (!next) requirePermission(user, 'planning.teams.delete')
      const monthly = derived.teams.get(`${day}/${old?.teamId}`)
      if (old && next && changed(old, next, ['memberIds', 'members', 'monthlyStaffingOverride', 'guardOverride']) && !(monthly && same(next.memberIds, monthly.memberIds) && same(next.members, monthly.members) && !changed(old, next, ['monthlyStaffingOverride', 'guardOverride']))) requirePermission(user, 'planning.technicians')
      if (old && next && changed(old, next, ['label', 'name'])) requirePermission(user, 'planning.edit')
      const scopeTask = (task, team) => task ? { ...task, date: task.date || day, technicianIds: task.technicianIds || team?.memberIds || [] } : task
      const historyForTask = task => (state.history || []).find(row => id(row.id) === id(task?.historyId || task?.sourceHistoryId) || task?.taskId && id(row.sourceTaskId) === id(task.taskId))
      if (old && next && changed(old, next, ['memberIds', 'members'])) {
        for (const task of old.tasks || []) {
          const record = historyForTask(task) || scopeTask(task, old)
          if (!read.serviceWritable(record, user, state) || !read.serviceWritable({ ...record, technicianIds: next.memberIds || [] }, user, state)) fail('scope.services.write')
        }
      }
      const key = [...(old?.tasks || []), ...(next?.tasks || [])].some(task => task.taskId) ? 'taskId' : 'historyId'
      collectionChanges(old?.tasks || [], next?.tasks || [], key, (prior, proposed) => {
        const existing = historyForTask(prior || proposed)
        if (existing && !read.serviceWritable(existing, user, state)) fail('scope.services.write')
        const nextRecord = (state.nextHistory || []).find(record => id(record.id) === id(existing?.id))
        if (!proposed && existing && nextRecord && (nextRecord.date !== day || id(nextRecord.teamId) !== id(old?.teamId))) {
          requirePermission(user, 'planning.reschedule')
          return
        }
        if (!prior && proposed && existing && nextRecord && (existing.date !== day || id(existing.teamId) !== id(next?.teamId))) {
          requirePermission(user, 'planning.reschedule')
          assertServiceChange(existing, { ...existing, ...proposed, date: day, teamId: next?.teamId, team: next?.label }, user, state, { planning: true, task: true })
          return
        }
        assertServiceChange(scopeTask(prior, old), scopeTask(proposed, next), user, state, { planning: true, task: true, monthlyAssignment: derived.records.get(id(existing?.id)) })
      })
    })
  }
  if (!same(before.teams, after.teams) || before.date !== after.date) {
    requirePermission(user, 'agenda.view')
    inspectTeams(before.teams, after.teams, after.date || before.date)
  }
  const oldWeekly = before.weekly || {}, newWeekly = after.weekly || {}
  for (const key of new Set([...Object.keys(oldWeekly), ...Object.keys(newWeekly)])) {
    if (same(oldWeekly[key], newWeekly[key])) continue
    if (key === '_workday') { requirePermission(user, 'settings.workday.manage'); continue }
    if (key === '_frozenMonthOptions') { requirePermission(user, 'settings.frozenMonths'); continue }
    if (key === '_holidayOverrides') { requirePermission(user, 'weekly.holidays'); continue }
    if (key === '_annualGuards') { requirePermission(user, 'weekly.guards.manage'); continue }
    if (key === '_monthlyTeams') {
      const previous = oldWeekly[key] || {}, next = newWeekly[key] || {}
      for (const month of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        if (changed(previous[month], next[month], ['teams'])) requirePermission(user, 'weekly.monthlyTeams.manage')
        if (changed(previous[month], next[month], ['defaultTimes', 'defaultTimePeriods'])) {
          requirePermission(user, 'weekly.monthlyHours.manage')
          require('./monthly-hours.cjs').validateMonthlyHoursChange(month, previous[month] || {}, next[month] || {})
        }
        if (changed(previous[month], next[month], ['vehicleAssignments'])) requirePermission(user, 'weekly.monthlyVehicles.assign')
        if (changed(previous[month], next[month], ['configurationHistory'])) requireAny(user, ['weekly.monthlyTeams.manage', 'weekly.monthlyHours.manage', 'weekly.monthlyVehicles.assign'])
      }
      continue
    }
    if (key.startsWith('_')) fail('weekly.configuration', 'Configuración no reconocida.')
    requirePermission(user, 'weekly.view')
    inspectTeams(oldWeekly[key]?.teams, newWeekly[key]?.teams, key)
    if (changed(oldWeekly[key], newWeekly[key], ['removedTaskIds'])) {
      requirePermission(user, 'planning.remove')
      const prior = new Set((oldWeekly[key]?.removedTaskIds || []).map(String))
      const added = new Set((newWeekly[key]?.removedTaskIds || []).map(String).filter(value => !prior.has(value)))
      const affected = (state.history || []).filter(record => record.date === key && [record.id, record.sourceTaskId, record.taskId].some(value => added.has(id(value))))
      for (const record of affected) {
        if (!read.serviceWritable(record, user, state)) fail('scope.services.write')
        if (record.vehicleControl) requirePermission(user, 'vehicle.controls.omit')
      }
    }
    if (changed(oldWeekly[key], newWeekly[key], ['removedTeams'])) requirePermission(user, 'planning.teams.delete')
    if (changed(oldWeekly[key], newWeekly[key], ['removedSlots'])) requirePermission(user, 'planning.remove')
  }
}

function authorizeGranularState(incoming, current, user) {
  user = catalog.permissionSnapshot(user)
  const visible = read.granularVisibleState(current, user)
  const next = restoreHidden({ ...current, ...incoming }, current, visible)
  const oldHistory = new Map((current.history || []).map(record => [id(record.id), record]))
  const oldHistoryByTask = new Map((current.history || []).filter(record => record.sourceTaskId).map(record => [id(record.sourceTaskId), record]))
  next.history = (next.history || []).map(record => prepareServiceProposal(oldHistory.get(id(record.id)), record, user, next))
  const prepareTeams = (teams, oldTeams = []) => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(task => {
    const oldTeam = oldTeams.find(row => id(row.teamId) === id(team.teamId))
    const oldTask = (oldTeam?.tasks || []).find(row => task.taskId ? id(row.taskId) === id(task.taskId) : task.historyId && id(row.historyId) === id(task.historyId))
    const movedRecord = !oldTask && (oldHistory.get(id(task.historyId || task.sourceHistoryId)) || oldHistoryByTask.get(id(task.taskId)))
    if (movedRecord) return prepareServiceProposal(movedRecord, restoreHidden(task, movedRecord, read.sanitizeService(movedRecord, user, current)), user, next)
    return prepareServiceProposal(oldTask, task, user, next)
  }) }))
  if (next.agenda) {
    next.agenda = { ...next.agenda, teams: prepareTeams(next.agenda.teams, current.agenda?.teams), weekly: { ...next.agenda.weekly } }
    for (const [day, plan] of Object.entries(next.agenda.weekly)) if (!day.startsWith('_')) next.agenda.weekly[day] = { ...plan, teams: prepareTeams(plan?.teams, current.agenda?.weekly?.[day]?.teams) }
  }
  const derived = monthlyAssignments(current, next, user)
  const authorizationState = { ...current, agenda: next.agenda, customers: next.customers, nextHistory: next.history }
  delete next.sessionUser
  collectionChanges(current.roles, next.roles, 'id', (before, after) => {
    if (!after) fail('settings.roles.edit', 'Los roles existentes no se eliminan desde el editor.')
    if (!before) {
      requirePermission(user, 'settings.roles.create')
      if (catalog.CATALOG.some(item => after.permissions?.[item.id] === true)) requirePermission(user, 'settings.roles.permissions')
    }
    else {
      if (changed(before, after, ['name', 'description'])) requirePermission(user, 'settings.roles.edit')
      if (changed(before, after, ['permissions'])) requirePermission(user, 'settings.roles.permissions')
      if (changed(before, after, ['code'])) fail('settings.roles.edit', 'El identificador interno del rol no puede modificarse.')
    }
    if (!before || changed(before, after, ['permissions'])) assertDelegable(user, after, current.roles)
  })
  collectionChanges(current.employees, next.employees, 'id', (before, after) => assertEmployeeChange(before, after, user, { ...current, roles: next.roles }))
  collectionChanges(current.customers, next.customers, 'customerId', (before, after) => assertCustomerChange(before, after, user, current))
  for (const kind of ['services', 'vehicles']) collectionChanges(current[kind], next[kind], 'id', (before, after) => assertCatalogChange(kind, before, after, user))
  collectionChanges(current.history, next.history, 'id', (before, after) => {
    const agenda = after ? next.agenda : current.agenda
    const linked = (agenda?.teams || []).concat(...Object.entries(agenda?.weekly || {}).filter(([key]) => !key.startsWith('_')).map(([, plan]) => plan?.teams || [])).some(team => (team.tasks || []).some(task => id(task.historyId) === id((after || before).id) || task.taskId && id(task.taskId) === id((after || before).sourceTaskId)))
    assertServiceChange(before, after, user, authorizationState, { planning: linked && !catalog.can(user, 'history.edit'), monthlyAssignment: derived.records.get(id((after || before).id)) })
  })
  assertAgendaChange(current.agenda, next.agenda, user, authorizationState, derived)
  if (!same(current.reviews, next.reviews)) fail('reviews', 'Las reseñas históricas no son editables.')
  validateGranularRoles(next, current)
  return require('./service-preparation.cjs').applyServicePreparation(next, current, user, catalog.can(user, 'planning.ready'))
}

module.exports = { authorizeGranularState, restoreHidden, prepareServiceProposal, validateGranularRoles, assertServiceChange, assertEmployeeChange, assertCustomerChange, assertCatalogChange, assertAgendaChange, assertDelegable, assertActiveAdministrator, requirePermission, requireAny, fail, same, changed }
