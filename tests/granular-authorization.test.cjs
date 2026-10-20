const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleStateForUser, authorizeIncomingState } = require('../api/_lib/core.cjs')
const write = require('../api/_lib/granular-write-policy.cjs')
const read = require('../api/_lib/granular-read-policy.cjs')
const endpoint = require('../api/_lib/endpoint-policy.cjs')
const { attachmentAccess, handleAttachments } = require('../api/_lib/attachments.cjs')
const { canPerformTechnicalServices } = require('../api/_lib/technical-capability.cjs')
const { isOperator } = require('../api/_lib/operator-access.cjs')
const user = (keys, extra = {}) => ({ id: 'one', roleId: 'custom', roleCode: 'custom', name: 'Prueba', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) }, ...extra })
function fixture() {
  const record = { id: 'work', sourceTaskId: 'task', customerId: 'customer', client: 'CLI-1 Cliente', date: '2099-01-05', time: '09:00', status: 'Pendiente', technicianIds: ['one'], technicians: ['Uno'], teamId: 'team', detail: 'Original', amount: '100', paymentMethod: 'Efectivo', phone: '351000', address: 'Privada', internalNote: 'Nota' }
  return {
    roles: [{ id: 'custom', code: 'custom', name: 'Prueba', permissions: {} }], employees: [], services: [], vehicles: [], reviews: [], preferences: {},
    customers: [{ customerId: 'customer', account: 'CLI-1', name: 'Cliente', cctvService: true, phone: '351000', fields: { 'Abono mensual': '500', Dirección: 'Privada' } }],
    history: [record, { ...record, id: 'other', sourceTaskId: 'other-task', technicianIds: ['two'], customerId: 'elsewhere', client: 'CLI-2 Elsewhere', amount: '200' }],
    agenda: { date: record.date, teams: [], weekly: { [record.date]: { teams: [{ teamId: 'team', memberIds: ['one'], members: ['Uno'], tasks: [{ ...record, taskId: 'task', historyId: 'work' }] }] }, _workday: { weekdays: {} }, _frozenMonthOptions: [4, 6] } }
  }
}

test('v2 role names no longer impose the legacy operator, supervisor or technician policy', () => {
  for (const roleCode of ['operator', 'supervisor', 'technician']) {
    const actor = user(['weekly.view', 'records.read', 'planning.ready', 'technical.view'], { roleCode, role: 'Operador', technicalEnabled: true })
    assert.equal(isOperator(actor), false)
    assert.equal(canPerformTechnicalServices(actor), true)
    const state = fixture(), incoming = visibleStateForUser(state, actor)
    incoming.history[0].servicePreparation = { ready: true }
    assert.equal(authorizeIncomingState(incoming, state, actor).history[0].servicePreparation.ready, true)
  }
})

test('read scope, financial/contact redaction and hidden data survive PUT projection writes', () => {
  const actor = user(['weekly.view', 'records.read', 'planning.notes'])
  actor.permissions['scope.services.read.assigned'] = true
  actor.permissions['scope.services.write.assigned'] = true
  const state = fixture(), visible = visibleStateForUser(state, actor)
  assert.deepEqual(visible.history.map(row => row.id), ['work'])
  assert.equal(visible.history[0].amount, undefined)
  assert.equal(visible.history[0].phone, undefined)
  assert.equal(visible.history[0].supervisorVisible, true)
  visible.history[0].internalNote = 'Nueva'
  visible.history[0].amount = '' // Frontend form default for a redacted field.
  const saved = authorizeIncomingState(visible, state, actor)
  assert.equal(saved.history[0].internalNote, 'Nueva')
  assert.equal(saved.history[0].amount, '100')
  assert.equal(saved.history[1].amount, '200')
  assert.equal(saved.history[0].phone, '351000')
  assert.equal(saved.history[0].supervisorVisible, undefined)
  assert.equal(saved.agenda.weekly[state.agenda.date].teams[0].tasks[0].amount, '100')
  const injected = structuredClone(saved)
  injected.history[1].detail = 'Escaped'
  assert.equal(authorizeIncomingState(injected, state, actor).history[1].detail, state.history[1].detail, 'hidden rows are preserved even when an unsolicited full snapshot supplies them')
})

test('independent ready, note, assignment, completion and general edit permissions are enforced', () => {
  const state = fixture(), before = state.history[0]
  const ready = user(['weekly.view', 'records.read', 'planning.ready'])
  assert.doesNotThrow(() => write.assertServiceChange(before, { ...before, servicePreparation: { ready: true } }, ready, state, { planning: true }))
  assert.throws(() => write.assertServiceChange(before, { ...before, detail: 'other' }, ready, state, { planning: true }), /planning.edit/)
  assert.throws(() => write.assertServiceChange(before, { ...before, technicianIds: ['two'] }, ready, state), /planning.technicians/)
  const completer = user(['history.view', 'records.read', 'history.complete'])
  assert.doesNotThrow(() => write.assertServiceChange(before, { ...before, status: 'Completado' }, completer, state))
  assert.throws(() => write.assertServiceChange(before, { ...before, internalNote: 'x' }, completer, state), /planning.notes/)
  assert.throws(() => write.assertServiceChange(before, { ...before, amount: '300' }, completer, state), /planning.commercial/)
  assert.throws(() => endpoint.assertEndpointPermission(completer, 'PATCH', '/history/bulk'), /history.bulk/)
})

test('configuration does not inherit from weekly and sensitive fields use dedicated actions', () => {
  const state = fixture(), actor = user(['weekly.view', 'records.read'])
  const next = structuredClone(state); next.agenda.weekly._frozenMonthOptions = [3]
  assert.deepEqual(authorizeIncomingState(next, state, actor).agenda.weekly._frozenMonthOptions, [4, 6])
  next.agenda.weekly._workday = { weekdays: { 1: { end: '23:00' } } }
  assert.throws(() => authorizeIncomingState(next, state, actor), /settings.workday.manage/)
  const hours = user(['settings.view', 'settings.workday.read', 'settings.workday.manage'])
  const proposed = visibleStateForUser(state, hours); proposed.agenda.weekly._workday = { weekdays: { 1: { end: '17:00' } } }
  assert.deepEqual(authorizeIncomingState(proposed, state, hours).agenda.weekly._workday, proposed.agenda.weekly._workday)
})

test('CCTV and assigned write scope intersect read scope, including guessed record identifiers', () => {
  const state = fixture(), actor = user(['history.view', 'records.read', 'history.edit'])
  actor.permissions['scope.services.read.cctv'] = true
  actor.permissions['scope.services.write.assigned'] = true
  assert.equal(read.serviceWritable(state.history[0], actor, state), true)
  assert.equal(read.serviceWritable(state.history[1], actor, state), false)
  actor.permissions['scope.services.read.assigned'] = true
  assert.equal(read.serviceReadable(state.history[0], actor, state), false)
})

test('technical status needs exact action, assignment and employee capability', () => {
  const state = fixture(), actor = user(['technical.view', 'records.read', 'technical.complete'], { technicalEnabled: true })
  assert.doesNotThrow(() => endpoint.assertTechnicalAction(actor, state.history[0], state, 'Completado'))
  assert.throws(() => endpoint.assertTechnicalAction(actor, state.history[0], state, 'start'), /technical.start/)
  assert.throws(() => endpoint.assertTechnicalAction(actor, state.history[1], state, 'Completado'), /technical.complete/)
  assert.throws(() => endpoint.assertTechnicalAction({ ...actor, technicalEnabled: false }, state.history[0], state, 'Completado'), /technical.complete/)
})

test('documents separate read/upload/deleteOwn/deleteAny and verify author on modern and legacy files', async () => {
  const state = fixture(), actor = user(['history.view', 'records.read', 'service.documents.read'])
  assert.deepEqual(attachmentAccess(actor, 'service', state.history[0], state), { read: true, write: false })
  actor.permissions['service.documents.deleteOwn'] = true
  assert.doesNotThrow(() => endpoint.assertLegacyPhoto(actor, state.history[0], state, 'DELETE', 'one'))
  assert.throws(() => endpoint.assertLegacyPhoto(actor, state.history[0], state, 'DELETE', 'two'), /deleteOwn/)
  await assert.rejects(handleAttachments({
    user: actor, scope: 'service', entity: state.history[0], state, entityId: 'work', attachmentId: 'attachment',
    req: { method: 'DELETE' }, res: { setHeader() {}, end() {} },
    store: { ensure() {}, list: async () => [{ id: 'attachment', uploadedBy: 'two' }], remove() { throw new Error('Must not delete') } }
  }), error => error.statusCode === 403)
})

test('customer imported fields and nested original service data are redacted', () => {
  const actor = user(['accounts.view', 'history.view', 'records.read'])
  assert.equal(read.sanitizeCustomer(fixture().customers[0], actor).fields['Abono mensual'], undefined)
  const safe = read.sanitizeService({ reservationOriginal: { address: 'private', phone: 'private', name: 'ok' }, collection: { events: [{ amount: '9' }] } }, actor)
  assert.equal(safe.reservationOriginal.address, undefined)
  assert.equal(safe.reservationOriginal.phone, undefined)
  assert.equal(safe.collection, undefined)
})

test('roles cannot delegate capabilities or scope above actor; last active administrator remains', () => {
  const actor = user(['settings.view', 'settings.roles.read', 'settings.roles.permissions'])
  assert.throws(() => write.assertDelegable(actor, user(['employees.view', 'employees.password'])), /delegar/)
  actor.permissions['scope.services.read.assigned'] = true
  assert.throws(() => write.assertDelegable(actor, user([])), /alcance/)
  const state = fixture()
  state.roles.push({ id: 'admin', code: 'administrator', permissions: {} })
  state.employees.push({ id: 'admin', roleId: 'admin', status: 'Activo' })
  assert.throws(() => write.assertActiveAdministrator({ ...state, employees: [] }, state), /administrador activo/)
  const target = { id: 'person', roleId: 'custom', name: 'User', status: 'Activo', passwordHash: 'hash' }
  assert.throws(() => write.assertEmployeeChange(target, { ...target, password: 'NewPassword9' }, user(['employees.view', 'employees.edit']), state), /employees.password/)
})

test('catalog CAS compares authorized vehicle projection and preserves hidden mileage/insurance', () => {
  const actor = user(['vehicles.view', 'vehicles.edit'])
  const vehicle = { id: 'v', plate: 'ABC', mileage: 300, insuranceFileName: 'secret.pdf', brand: 'Ford' }
  const current = { vehicles: [vehicle] }, base = read.sanitizeVehicle(vehicle, actor)
  const input = endpoint.catalogInput('vehicles', current, { base, vehicle: { ...base, plate: 'DEF' } }, { operation: 'update', vehicleId: 'v' }, actor)
  assert.equal(input.vehicle.mileage, 300)
  assert.equal(input.vehicle.insuranceFileName, 'secret.pdf')
  assert.equal(input.base, vehicle)
  assert.throws(() => endpoint.catalogInput('vehicles', current, { base: { ...base, plate: 'STALE' } }, { operation: 'update', vehicleId: 'v' }, actor), error => error.statusCode === 409)
})

test('accounts history, technical history, reports and dashboard metrics have separate read boundaries', () => {
  const state = fixture()
  const accounts = user(['accounts.view', 'records.read'])
  accounts.permissions['scope.customers.read.cctv'] = true
  assert.equal(visibleStateForUser(state, accounts).history.length, 0)
  accounts.permissions['customer.history'] = true
  assert.deepEqual(visibleStateForUser(state, accounts).history.map(row => row.id), ['work'])
  const dashboard = visibleStateForUser(state, user(['dashboard.view']))
  assert.equal(dashboard.history.length, 2)
  assert.equal(dashboard.history[0].client, undefined)
  assert.equal(dashboard.history[0].amount, undefined)
  assert.equal(dashboard.history[0].phone, undefined)
  const technician = user(['technical.view', 'records.read', 'customer.history'])
  state.history.push({ ...state.history[0], id: 'previous', status: 'Completado', technicianIds: ['two'], date: '2025-01-01', technicalObservation: 'privado', servicePhotoUrl: 'privado' })
  const visible = visibleStateForUser(state, technician)
  assert.ok(visible.history.some(row => row.id === 'previous'))
  assert.equal(visible.history.find(row => row.id === 'previous').technicalObservation, undefined)
  assert.equal(visible.history.find(row => row.id === 'previous').servicePhotoUrl, undefined)
  technician.permissions['scope.services.read.assigned'] = true
  assert.ok(!visibleStateForUser(state, technician).history.some(row => row.id === 'previous'))
})

test('coordinate permission includes locationOverride, while employee password alone cannot alter name', () => {
  const state = fixture(), customer = state.customers[0]
  assert.doesNotThrow(() => write.assertCustomerChange(customer, { ...customer, locationOverride: { lat: 1, lng: 2 } }, user(['accounts.view', 'customers.coordinates']), state))
  assert.throws(() => write.assertCustomerChange(customer, { ...customer, locationOverride: { lat: 1, lng: 2 } }, user(['accounts.view', 'customers.edit']), state), /customers.coordinates/)
  assert.throws(() => write.assertEmployeeChange({ id: 'a', name: 'Before' }, { id: 'a', name: 'After' }, user(['employees.view', 'employees.password']), state), /employees.edit/)
})

test('role payload validation applies to migrated data independent of actor and rejects downgrade/ambiguous scopes', () => {
  const state = fixture(), role = { id: 'custom', code: 'custom', permissions: { __catalogV2: true, 'weekly.view': true } }
  assert.throws(() => write.validateGranularRoles({ ...state, roles: [{ ...role, permissions: { ...role.permissions, evil: true } }] }, state), /inválido/)
  assert.throws(() => write.validateGranularRoles({ ...state, roles: [{ ...role, permissions: {} }] }, { ...state, roles: [role] }), /heredados/)
  assert.throws(() => write.validateGranularRoles({ ...state, roles: [{ ...role, permissions: { ...role.permissions, 'scope.services.read.assigned': true, 'scope.services.read.cctv': true } }] }, state), /alcance/)
  assert.throws(() => write.validateGranularRoles({ ...state, roles: [{ ...role, code: 'administrator', permissions: { __catalogV2: true, 'scope.services.read.assigned': true } }] }, null), /alcance completo/)
})

test('reservation link derives customer contact and attribution without granting general editing', () => {
  const state = fixture(), actor = user(['history.view', 'records.read', 'planning.reservation.link'])
  state.history[0] = { ...state.history[0], customerId: '', subscriberReservation: true, client: 'Reserva' }
  const before = state.history[0]
  const linked = write.prepareServiceProposal(before, { ...before, customerId: 'customer', subscriberReservation: false, address: 'forged' }, actor, state)
  assert.equal(linked.phone, state.customers[0].phone)
  assert.equal(linked.reservationLinkedBy.id, actor.id)
  assert.doesNotThrow(() => write.assertServiceChange(before, linked, actor, state))
  assert.throws(() => write.assertServiceChange(before, { ...linked, detail: 'forged' }, actor, state), /history.edit/)
})

test('monthly staffing permits only the exact inherited assignment and preserves explicit exceptions', async () => {
  const { synchronizeMonthlyTeams } = await import('../src/domain/agenda/monthly-team-sync.mjs')
  const state = fixture(), actor = user(['weekly.view', 'records.read', 'weekly.monthlyTeams.read', 'weekly.monthlyTeams.manage'])
  state.agenda.weekly._monthlyTeams = { '2099-01': { teams: [{ teamId: 'team', memberIds: ['one'], members: ['Uno'] }] } }
  const teams = [{ teamId: 'team', memberIds: ['two'], members: ['Dos'] }]
  const next = synchronizeMonthlyTeams(state, { month: '2099-01', teams, fromDate: '2099-01-01' })
  next.agenda.weekly._monthlyTeams['2099-01'].teams = teams
  assert.deepEqual(authorizeIncomingState(next, state, actor).history[0].technicianIds, ['two'])
  next.history[0].technicianIds = ['intruder']
  assert.throws(() => authorizeIncomingState(next, state, actor), /planning.technicians/)
})

test('response session identity follows persisted role changes and applies the new projection immediately', () => {
  const state = fixture(), oldActor = user(['history.view', 'records.read', 'records.financial'])
  const updatedRole = { id: 'restricted', code: 'operator', name: 'Consulta mínima', permissions: { __catalogV2: true, 'dashboard.view': true } }
  state.roles.push(updatedRole)
  state.employees.push({ id: oldActor.id, name: 'One', roleId: updatedRole.id, status: 'Activo', passwordHash: 'never-return' })
  const visible = visibleStateForUser(state, oldActor)
  assert.equal(visible.sessionUser.roleId, 'restricted')
  assert.equal(visible.sessionUser.permissions['history.view'], undefined)
  assert.equal(visible.sessionUser.passwordHash, undefined)
  assert.equal(visible.history[0].amount, undefined)
  assert.equal(visible.history[0].client, undefined)
})

test('create-only role administrator can create an empty role inheriting narrow scopes, but cannot grant actions', () => {
  const state = fixture(), actor = user(['settings.view', 'settings.roles.read', 'settings.roles.create'])
  actor.permissions['scope.services.read.assigned'] = true
  actor.permissions['scope.services.write.assigned'] = true
  actor.permissions['scope.customers.read.related'] = true
  const created = { id: 'empty', code: 'empty', name: 'Vacío', permissions: { __catalogV2: true, 'scope.services.read.assigned': true, 'scope.services.write.assigned': true, 'scope.customers.read.related': true } }
  const incoming = structuredClone(visibleStateForUser(state, actor)); incoming.roles.push(created)
  assert.ok(authorizeIncomingState(incoming, state, actor).roles.some(row => row.id === 'empty'))
  created.permissions['settings.view'] = true
  assert.throws(() => authorizeIncomingState(incoming, state, actor), /settings.roles.permissions/)
})

test('legacy technical endpoint projection remains technical after refreshing the authenticated administrative role', () => {
  const state = fixture()
  state.roles.push({ id: 'admin', code: 'administrator', name: 'Administrador', permissions: {} })
  state.employees.push({ id: 'one', roleId: 'admin', status: 'Activo', name: 'Admin técnico', technicalEnabled: true })
  const visible = require('../api/_lib/core.cjs').visibleTechnicianStateForUser(state, { id: 'one', roleCode: 'administrator', technicalEnabled: true })
  assert.equal(visible.sessionUser.roleCode, 'administrator')
  assert.equal(visible.history.find(row => row.id === 'work').internalNote, undefined)
  assert.equal(visible.agenda, null)
})

test('subscription correction validates visible CAS before restoring hidden contact fields', async () => {
  const { subscriptionCorrectionBase, correctSubscription } = await import('../src/domain/customers/subscription-correction.mjs')
  const state = fixture(), actor = user(['accounts.view', 'records.financial', 'subscriptions.read', 'subscriptions.correct'])
  state.services = [{ id: 'alarm', name: 'Instalación de alarma', code: 'alarm-installation' }]
  state.history[0] = { ...state.history[0], serviceId: 'alarm', service: 'Instalación de alarma', installationZone: 'residencial', status: 'Completado', monthlyFee: '100', freezeMonthlyFee: false, monthlyFeeEffectiveFrom: '2026-01-01', frozenMonths: 0 }
  const visible = visibleStateForUser(state, actor)
  assert.equal(visible.history[0].address, undefined)
  const input = { recordId: 'work', customerId: 'customer', base: subscriptionCorrectionBase(visible.history[0]), values: { monthlyFee: '200', monthlyFeeEffectiveFrom: '2026-02-01', freezeMonthlyFee: false } }
  const prepared = endpoint.subscriptionInput(state, input, actor, subscriptionCorrectionBase)
  assert.equal(correctSubscription(state, prepared, actor).after.monthlyFee, '200')
  assert.equal(prepared.base.address, 'Privada')
  assert.throws(() => endpoint.subscriptionInput(state, { ...input, base: { ...input.base, monthlyFee: '99' } }, actor, subscriptionCorrectionBase), error => error.statusCode === 409)
})

test('creating a service materializes only its inherited team, without granting free team creation', async () => {
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
  const state = fixture(), actor = user(['weekly.view', 'records.read', 'planning.create'])
  const team = { teamId: 'template', label: 'Equipo 1', memberIds: ['one'], members: ['Uno'] }
  state.agenda.weekly._monthlyTeams = { '2099-01': { teams: [team] } }
  const snapshot = visibleStateForUser(state, actor)
  assert.deepEqual(snapshot.agenda.weekly._monthlyTeams['2099-01'].teams[0].memberIds, ['one'])
  const record = { id: 'new', sourceTaskId: 'new-task', date: '2099-01-06', time: '11:00', status: 'Pendiente', service: 'Servicio', serviceId: 's', technicianIds: ['one'], technicians: ['Uno'], teamId: team.teamId, team: team.label }
  const task = { ...record, taskId: 'new-task', historyId: 'new' }
  const operations = weeklyServiceOperations(snapshot, { day: record.date, team, task, record, baseRecord: null })
  const next = applyStateOperations(snapshot, operations)
  assert.ok(authorizeIncomingState(next, state, actor).history.some(row => row.id === 'new'))
  next.agenda.weekly[record.date].teams[0].memberIds = ['two']
  assert.throws(() => authorizeIncomingState(next, state, actor), /planning.teams.create/)
})

test('control generation alone materializes confirmed templates; combined assignment needs its own permission', async () => {
  const { buildVehicleControlRecords, vehicleControlTask } = await import('../src/domain/vehicles/vehicle-controls.mjs')
  const state = fixture(), actor = user(['weekly.view', 'weekly.monthlyVehicles.read', 'weekly.controls.schedule'])
  const team = { teamId: 'monthly', label: 'Equipo 1', memberIds: ['one'], members: ['Uno'] }
  state.employees = [{ id: 'one', name: 'Uno', roleId: 'custom', status: 'Activo' }]
  state.vehicles = [{ id: 'v', brand: 'Ford', model: 'Ka', plate: 'ABC', mileage: 1 }]
  state.agenda.weekly._monthlyTeams = { '2099-01': { teams: [team], vehicleAssignments: [{ vehicleId: 'v', technicianId: 'one' }] } }
  // User exists only to provide staffing; this actor is authenticated separately.
  const planner = { ...actor, id: 'planner' }
  const snapshot = visibleStateForUser(state, planner)
  const generated = buildVehicleControlRecords({ month: '2099-01', assignments: snapshot.agenda.weekly._monthlyTeams['2099-01'].vehicleAssignments, vehicles: snapshot.vehicles, technicians: snapshot.employees, teams: [team], fromDate: '2099-01-01' })
  assert.ok(generated.length)
  const incoming = structuredClone(snapshot)
  incoming.history.push(...generated)
  for (const record of generated) incoming.agenda.weekly[record.date] = { teams: [{ ...team, tasks: [vehicleControlTask(record)] }] }
  assert.equal(authorizeIncomingState(incoming, state, planner).history.filter(record => record.vehicleControl).length, generated.length)
  const blank = structuredClone(state); blank.agenda.weekly._monthlyTeams['2099-01'].vehicleAssignments = []
  assert.throws(() => authorizeIncomingState(incoming, blank, planner), /monthlyVehicles.assign/)
  const assigner = { ...planner, permissions: { ...planner.permissions, 'weekly.monthlyVehicles.assign': true } }
  assert.equal(authorizeIncomingState(incoming, blank, assigner).history.filter(record => record.vehicleControl).length, generated.length)
  incoming.history.at(-1).technicianIds = ['forged']
  assert.throws(() => authorizeIncomingState(incoming, state, planner), /weekly.controls.schedule/)
})

test('creating the first Saturday service inherits its operational guard without exposing guard configuration history', async () => {
  const { assignGuardToEmptySaturday } = await import('../src/features/agenda/application/agenda-model.mjs')
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
  const state = fixture(), actor = user(['weekly.view', 'records.read', 'planning.create'], { id: 'planner' })
  const day = '2099-01-03'
  state.employees = [{ id: 'one', name: 'Uno', status: 'Activo' }, { id: 'two', name: 'Dos', status: 'Activo' }]
  state.agenda.weekly._annualGuards = { 2099: { startDate: day, rotation: [{ technicianId: 'one', name: 'Uno' }, { technicianId: 'two', name: 'Dos' }], configurationHistory: [{ secret: 'management-only' }] } }
  const snapshot = visibleStateForUser(state, actor)
  assert.equal(snapshot.agenda.weekly._annualGuards[2099].configurationHistory, undefined)
  assert.deepEqual(snapshot.agenda.weekly._annualGuards[2099].rotation, state.agenda.weekly._annualGuards[2099].rotation)
  const team = assignGuardToEmptySaturday([{ teamId: 'virtual-saturday', label: 'Equipo 1', memberIds: [], members: [], tasks: [] }], day, snapshot.agenda.weekly, snapshot.employees)[0]
  assert.deepEqual(team.memberIds, ['one'])
  const record = { id: 'guard-work', sourceTaskId: 'guard-task', date: day, time: '10:00', status: 'Pendiente', service: 'Servicio', serviceId: 's', technicianIds: team.memberIds, technicians: team.members, teamId: team.teamId, team: team.label }
  const task = { ...record, taskId: record.sourceTaskId, historyId: record.id }
  const next = applyStateOperations(snapshot, weeklyServiceOperations(snapshot, { day, team, task, record, baseRecord: null }))
  assert.deepEqual(authorizeIncomingState(next, state, actor).history.find(row => row.id === record.id).technicianIds, ['one'])
  next.agenda.weekly[day].teams[0].memberIds = ['two']
  next.agenda.weekly[day].teams[0].members = ['Dos']
  assert.throws(() => authorizeIncomingState(next, state, actor), /planning.teams.create/)
})

test('rescheduling to an inherited virtual team preserves prior private evidence without requiring create or remove', async () => {
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
  const state = fixture(), actor = user(['weekly.view', 'records.read', 'planning.reschedule'])
  const team = { teamId: 'destination', label: 'Equipo 2', memberIds: ['one'], members: ['Uno'] }
  state.history[0].technicalObservation = 'Private report'
  state.agenda.weekly._monthlyTeams = { '2099-01': { teams: [team] } }
  const snapshot = visibleStateForUser(state, actor), base = snapshot.history.find(row => row.id === 'work')
  assert.equal(base.technicalObservation, undefined)
  const operations = historyRescheduleOperations(snapshot, { base, day: '2099-01-06', time: '10:00', team, today: '2099-01-01' })
  const next = authorizeIncomingState(applyStateOperations(snapshot, operations), state, actor)
  const moved = next.history.find(row => row.id === 'work')
  assert.equal(moved.date, '2099-01-06')
  assert.equal(moved.reschedulingHistory.at(-1).technicalObservation, 'Private report')
  assert.equal(next.agenda.weekly['2099-01-05'].teams[0].tasks.length, 0)
  assert.equal(next.agenda.weekly['2099-01-06'].teams[0].tasks[0].historyId, 'work')
  assert.equal(visibleStateForUser(next, actor).history.find(row => row.id === 'work').reschedulingHistory.at(-1).technicalObservation, undefined)
})
