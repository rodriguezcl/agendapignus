const test = require('node:test')
const assert = require('node:assert/strict')
const relocation = require('../api/_lib/address-change.cjs')
const imports = require('../api/_lib/customer-import.cjs')
const { preserveSoftguardRetirementCustomers } = require('../api/_lib/softguard-retirement-policy.cjs')
const { applyServiceCatalogOperation } = require('../api/_lib/service-catalog-operation.cjs')
const { synchronizeJourneyIdentity } = require('../api/_lib/journey-identity.cjs')
const before = '2026-10-29T10:00:00Z', completedAt = '2026-10-29T12:00:00Z', after = '2026-10-29T13:00:00Z'
const job = overrides => ({ id: 'move', customerId: 'c1', client: 'PIG-1000 CLIENTE', serviceId: 'address-change', service: 'Cambio de domicilio', address: 'Calle Vieja 10, Córdoba', newAddress: 'Calle Nueva 20, Córdoba', date: '2026-10-29', status: 'Pendiente', ...overrides })
const customer = overrides => ({ customerId: 'c1', account: 'PIG-1000', name: 'CLIENTE', address: job().address, fields: { Calle: 'Calle Vieja 10', Localidad: 'Córdoba' }, ...overrides })

test('catalog default is idempotent and can be configured before its first persisted use', () => {
  const list = relocation.ensureAddressChangeService([])
  assert.equal(list.length, 1)
  assert.equal(relocation.ensureAddressChangeService(list), list)
  assert.equal(relocation.ensureAddressChangeService([{ id: 'custom', name: 'CAMBIO DE DOMICILIO' }]).length, 1)
  const updated = applyServiceCatalogOperation({ services: [] }, { operation: 'update', serviceId: 'address-change', base: list[0], service: { ...list[0], estimatedMinutes: 180 } })
  assert.equal(updated.service.estimatedMinutes, 180)
  assert.equal(updated.service.category, 'service')
  assert.equal(applyServiceCatalogOperation({ services: list }, { operation: 'delete', base: list[0] }).outcome, 'deactivated')
})

test('a relocation requires an existing account and distinct, bounded addresses', () => {
  assert.doesNotThrow(() => relocation.validateAddressChange(job()))
  for (const patch of [{ customerId: '' }, { subscriberReservation: true }, { address: '' }, { newAddress: '' }, { newAddress: 'x'.repeat(1001) }, { newAddress: 'calle vieja 10 CORDOBA' }]) assert.throws(() => relocation.validateAddressChange(job(patch)))
  assert.doesNotThrow(() => relocation.validateAddressChange(job({ status: 'Cancelado', newAddress: '' })))
  assert.equal(relocation.isAddressChange({ serviceTypes: [{ id: 'address-change', name: 'Traslado' }] }), true)
})

test('completion waits for a fresh import, warns on old or different address and clears only on the expected address', () => {
  const record = job({ status: 'Completado', completedAt })
  assert.equal(relocation.addressChangeState(job(), customer()).status, 'planned')
  assert.equal(relocation.addressChangeState(record, customer()).status, 'awaiting-sync')
  assert.equal(relocation.addressChangeState(record, customer({ softguardAddress: { address: record.newAddress, checkedAt: before } })).status, 'awaiting-sync')
  for (const [address, status] of [[record.address, 'unchanged'], ['Otra 30', 'different'], ['CALLE NUEVA 20 - CORDOBA', 'verified']]) {
    assert.equal(relocation.addressChangeState(record, customer({ softguardAddress: { address, checkedAt: after } })).status, status)
  }
  assert.equal(relocation.addressChangeState(job({ status: 'Cancelado' }), customer()), null)
})

test('manual edits cannot confirm a SoftGuard update or forge the import evidence', () => {
  const record = job({ status: 'Completado', completedAt })
  const current = customer({ softguardAddress: { address: record.address, checkedAt: after } })
  const edited = { ...current, address: record.newAddress, softguardAddress: { address: record.newAddress, checkedAt: after } }
  assert.throws(() => preserveSoftguardRetirementCustomers([current], [edited], { reject: true }), /verificación de domicilio/)
  assert.equal(relocation.addressChangeState(record, preserveSoftguardRetirementCustomers([current], [edited])[0]).status, 'unchanged')
})

test('import evidence uses source fields, only accounts in the uploaded report and only relocation accounts', () => {
  const current = customer({ address: job().newAddress })
  const unrelated = customer({ customerId: 'c2', account: 'PIG-2000' })
  const capture = accounts => relocation.captureImportedAddresses([current, unrelated], accounts, after, [job()])
  assert.equal(capture(['PIG-1000', 'PIG-2000'])[0].softguardAddress.address, job().address)
  assert.equal(capture(['PIG-1000', 'PIG-2000'])[1], unrelated)
  assert.equal(capture(['PIG-2000'])[0], current)
  assert.equal(capture(undefined)[0], current)
  assert.equal(relocation.captureImportedAddresses([customer({ fields: {} })], ['PIG-1000'], after, [job()])[0].softguardAddress, undefined)
})

test('undoing an import restores prior address verification, including the absence of evidence', () => {
  for (const original of [customer(), customer({ softguardAddress: { address: job().address, checkedAt: before } })]) {
    const imported = relocation.captureImportedAddresses([{ ...original, fields: { Calle: 'Calle Nueva 20', Localidad: 'Córdoba' } }], ['PIG-1000'], after, [job()])
    const changes = imports.customerImportChanges([original], imported)
    assert.deepEqual(imports.restoreCustomerImportBackup(imported, changes.backup)[0].softguardAddress, original.softguardAddress)
  }
})

test('multi-day visits create one notice and a later completed move supersedes an earlier one', () => {
  const history = [job({ id: 'day1', serviceJourney: { id: 'journey' }, status: 'Avance registrado' }), job({ id: 'day2', serviceJourney: { id: 'journey' }, date: '2026-10-30' })]
  assert.equal(relocation.pendingAddressChanges(history, [customer()]).length, 1)
  const completed = job({ status: 'Completado', completedAt })
  const newer = job({ id: 'next-move', status: 'Completado', completedAt: after, date: '2026-11-01', address: completed.newAddress, newAddress: 'Destino 30' })
  assert.deepEqual(relocation.pendingAddressChanges([completed, newer], [customer()]).map(item => item.record.id), ['next-move'])
  assert.equal(relocation.pendingAddressChanges([job({ status: 'Cancelado' })], [customer()]).length, 0)
  const partial = job({ status: 'Completado', completedAt, serviceId: 'alarm', service: 'Service de alarma', workCompletion: { items: [{ id: 'address-change', name: 'Cambio de domicilio', status: 'pending' }] } })
  assert.equal(relocation.addressChangeState(partial, customer()).status, 'planned')
  partial.workCompletion.management = { at: after, note: 'Traslado cancelado por el cliente; alarma reparada.' }
  assert.equal(relocation.addressChangeState(partial, customer()), null)
})

test('new destination propagates between unstarted journeys without changing origin or reports', () => {
  const records = [1, 2].map(index => job({ id: String(index), serviceJourney: { id: 'journey', index, total: 2 } }))
  const original = { history: records, agenda: { teams: [{ tasks: structuredClone(records) }] } }
  const next = structuredClone(original)
  next.history[0].newAddress = 'Destino corregido 30'
  synchronizeJourneyIdentity(next, original)
  assert.equal(next.history[1].newAddress, 'Destino corregido 30')
  assert.equal(next.agenda.teams[0].tasks[1].newAddress, 'Destino corregido 30')
  assert.equal(next.history[1].address, job().address)
})

test('notification opens the service, follows verification status and respects contact/notification permissions', async () => {
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const input = { isAdministrator: true, today: '2026-10-29', history: [job({ status: 'Completado', completedAt })], customers: [customer({ softguardAddress: { address: job().address, checkedAt: after } })] }
  const notices = selectDashboardNotifications(input).filter(item => item.id.startsWith('address-change:'))
  assert.equal(notices.length, 1)
  assert.match(notices[0].title, /domicilio anterior/)
  assert.deepEqual(notices[0].target, { type: 'history', recordId: 'move' })
  assert.equal(selectDashboardNotifications({ ...input, customers: [customer({ softguardAddress: { address: job().newAddress, checkedAt: after } })] }).filter(item => item.id.startsWith('address-change:')).length, 0)
  const permissions = { __catalogV2: true, 'history.view': true, 'records.read': true, 'notifications.softguard': true, 'records.contact': false }
  assert.equal(selectDashboardNotifications({ ...input, isAdministrator: false, user: { id: 'u', roleCode: 'custom', permissions } }).filter(item => item.id.startsWith('address-change:')).length, 0)
})

test('normalization preserves the new destination and imported verification evidence', () => {
  const { buildShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
  const current = customer({ softguardAddress: { address: job().newAddress, checkedAt: after } })
  const state = { roles: [], employees: [], customers: [current], services: [relocation.ADDRESS_CHANGE_SERVICE], vehicles: [], history: [job({ estimatedMinutes: 120, time: '09:00' })], agenda: { teams: [], weekly: {} }, reviews: [], preferences: {} }
  const { tables } = buildShadowCandidate(state)
  assert.equal(tables.history_evidence[0].original_payload.newAddress, job().newAddress)
  assert.deepEqual(tables.source_record_evidence.find(row => row.collection === 'customers').original_payload.softguardAddress, current.softguardAddress)
})

test('the first weekly save persists the built-in service and both addresses through backend validation', async () => {
  const { fixture, admin, day } = require('./helpers/planning-click-fixture.cjs')
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
  const { normalizeStateForSave, authorizeIncomingState, visibleStateForUser, validateState } = require('../api/_lib/core.cjs')
  const original = fixture()
  original.services = original.services.filter(service => service.id !== 'address-change')
  original.customers = [customer()]
  const record = { ...original.history[0], ...job({ id: original.history[0].id, date: day }) }
  const team = original.agenda.weekly[day].teams[0]
  const task = { ...team.tasks[0], ...record }
  const operations = weeklyServiceOperations(original, { day, team, task, record, baseRecord: original.history[0], baseTask: team.tasks[0] })
  const next = normalizeStateForSave(authorizeIncomingState(applyStateOperations(visibleStateForUser(original, admin), operations), original, admin), original)
  validateState(next, original)
  assert.equal(next.services.find(service => service.id === 'address-change').category, 'service')
  assert.equal(next.history[0].newAddress, job().newAddress)
  assert.equal(next.agenda.weekly[day].teams[0].tasks[0].newAddress, job().newAddress)
  assert.equal(next.customers[0].address, job().address)
  next.history[0].newAddress = ''
  assert.throws(() => validateState(next, original), /Domicilio nuevo/)
})
