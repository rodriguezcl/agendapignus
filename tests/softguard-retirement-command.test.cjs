const test = require('node:test')
const assert = require('node:assert/strict')
const { pendingSoftguardRetirements, softguardRetirementPending, softguardRetirementResolution, softguardRetirementBase, resolveSoftguardRetirement } = require('../api/_lib/softguard-retirement.cjs')
const { preserveSoftguardRetirementCustomers, protectSoftguardRetirementInput, assertSoftguardRetirementDeletion, assertSoftguardRetirementAccess } = require('../api/_lib/softguard-retirement-policy.cjs')
const { normalizeRetirementCustomers, authorizeIncomingState } = require('../api/_lib/core.cjs')
const { preserveCustomerTrackingFlags, restoreCustomerImportBackup } = require('../api/_lib/customer-import.cjs')
const { assertEndpointPermission } = require('../api/_lib/endpoint-policy.cjs')
const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const now = '2026-10-21T12:00:00.000Z'
const retired = (patch = {}) => ({ customerId: 'customer', account: 'CLI-0176', kind: 'client', name: 'CLIENTE', convertedFromAccount: 'PIG-0704', convertedFromType: 'Residencial', subscriptionEndedAt: '2026-10-20T15:00:00.000Z', ...patch })
const fixture = (customer = retired()) => ({ revision: 7, roles: [], employees: [], customers: [customer], services: [], vehicles: [], history: [], reviews: [], agenda: { teams: [], weekly: {} } })
const input = customer => ({ customerId: customer.customerId, base: softguardRetirementBase(customer) })
const completed = customer => resolveSoftguardRetirement(fixture(customer), input(customer), admin, now).after
const userWith = (...keys) => ({ id: 'viewer', roleCode: 'custom', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) } })

test('SoftGuard cutoff follows Buenos Aires midnight and ignores invalid, unrelated and old provenance', () => {
  assert.equal(softguardRetirementPending(retired({ subscriptionEndedAt: '2026-10-20T02:59:59.999Z' })), false)
  assert.equal(softguardRetirementPending(retired({ subscriptionEndedAt: '2026-10-20T03:00:00.000Z' })), true)
  for (const patch of [{ subscriptionEndedAt: 'invalid' }, { subscriptionEndedAt: '' }, { convertedFromAccount: 'CLI-0030' }, { kind: 'subscriber' }, { account: 'PIG-0176' }]) assert.equal(softguardRetirementPending(retired(patch)), false)
  const customers = [retired({ customerId: 'older' }), retired({ customerId: 'newer', subscriptionEndedAt: now }), completed(retired())]
  assert.deepEqual(pendingSoftguardRetirements(customers).map(row => row.customerId), ['newer', 'older'])
  assert.equal(customers[0].customerId, 'older', 'selector must not reorder its input')
})

test('resolution is bound to the exact subscriber lifecycle, with an authenticated actor and immutable input', () => {
  const state = fixture(), original = structuredClone(state)
  const result = resolveSoftguardRetirement(state, input(state.customers[0]), admin, now)
  assert.deepEqual(state, original)
  assert.equal(result.state.history, state.history)
  assert.equal(result.state.customers[0], result.after)
  assert.deepEqual(result.after.softguardRetirementResolution, { convertedFromAccount: 'PIG-0704', subscriptionEndedAt: state.customers[0].subscriptionEndedAt, completedAt: now, completedBy: 'admin', completedByName: 'Administración' })
  assert.equal(softguardRetirementPending(result.after), false)
  assert.equal(softguardRetirementResolution(result.after), result.after.softguardRetirementResolution)
  for (const patch of [{ convertedFromAccount: 'PIG-0001' }, { subscriptionEndedAt: now }, { completedAt: 'invalid' }, { completedBy: '' }]) {
    const altered = { ...result.after, softguardRetirementResolution: { ...result.after.softguardRetirementResolution, ...patch } }
    assert.equal(softguardRetirementResolution(altered), null)
    assert.equal(softguardRetirementPending(altered), true)
  }
})

test('command rejects stale bases, duplicate confirmation and changed lifecycle without requiring unrelated fields', () => {
  const customer = retired(), state = fixture(customer), request = input(customer)
  const renamed = fixture({ ...customer, name: 'OTRO NOMBRE', phone: '351' })
  assert.doesNotThrow(() => resolveSoftguardRetirement(renamed, request, admin, now))
  const result = resolveSoftguardRetirement(state, request, admin, now)
  assert.throws(() => resolveSoftguardRetirement(result.state, request, admin, now), { statusCode: 409 })
  assert.throws(() => resolveSoftguardRetirement(result.state, input(result.after), admin, now), { statusCode: 409 })
  assert.throws(() => resolveSoftguardRetirement(fixture(retired({ subscriptionEndedAt: now })), request, admin, now), { statusCode: 409 })
  assert.throws(() => resolveSoftguardRetirement(state, { ...request, customerId: 'absent' }, admin, now), { statusCode: 404 })
})

test('dedicated permission requires accounts access and enforces customer scope even without records permissions', () => {
  const state = fixture(), request = input(state.customers[0])
  const resolver = userWith('accounts.view', 'customers.softguard.resolve')
  assert.doesNotThrow(() => assertEndpointPermission(resolver, 'POST', '/customers/softguard-retirement'))
  assert.doesNotThrow(() => assertSoftguardRetirementAccess(state, request, resolver))
  for (const user of [userWith('accounts.view'), userWith('customers.softguard.resolve'), { id: 'legacy', permissions: { accounts: true } }]) assert.throws(() => assertSoftguardRetirementAccess(state, request, user), { statusCode: 403 })
  const scoped = { ...resolver, permissions: { ...resolver.permissions, 'scope.customers.read.cctv': true } }
  assert.throws(() => assertSoftguardRetirementAccess(state, request, scoped), { statusCode: 403 })
  assert.doesNotThrow(() => assertSoftguardRetirementAccess(fixture(retired({ cctvService: true })), request, scoped))
  assert.doesNotThrow(() => assertSoftguardRetirementAccess(state, request, { id: 'legacy', permissions: { accounts: true, accountsEdit: true } }))
})

test('generic state writes cannot forge or erase resolution and cannot rewrite retirement provenance', () => {
  const customer = completed(retired()), state = fixture(customer)
  const missingMetadata = { customerId: customer.customerId, account: customer.account, kind: 'client', name: 'NUEVO NOMBRE' }
  const preserved = authorizeIncomingState({ ...state, customers: [missingMetadata] }, state, admin)
  assert.deepEqual(preserved.customers[0].softguardRetirementResolution, customer.softguardRetirementResolution)
  for (const patch of [{ softguardRetirementResolution: null }, { subscriptionEndedAt: now }, { convertedFromAccount: 'PIG-9999' }, { account: 'PIG-0704', kind: 'subscriber' }]) assert.throws(() => protectSoftguardRetirementInput({ customers: [{ ...customer, ...patch }] }, state), { statusCode: 403 })
  assert.throws(() => protectSoftguardRetirementInput({ customers: [retired({ customerId: 'forged' })] }, fixture({ customerId: 'old', account: 'PIG-1' })), { statusCode: 403 })
  assert.throws(() => assertSoftguardRetirementDeletion(fixture(), fixture({ customerId: 'different' })), /Registrá primero la baja/)
  assert.doesNotThrow(() => assertSoftguardRetirementDeletion(state, { customers: [] }))
})

test('import and undo preserve the latest acknowledgment instead of trusting spreadsheet or backup metadata', () => {
  const customer = completed(retired())
  const oldBackup = { ...retired(), name: 'NOMBRE ANTERIOR' }
  const imported = preserveCustomerTrackingFlags([customer], [{ ...retired(), softguardRetirementResolution: { completedBy: 'forged' }, name: 'IMPORTADO' }])[0]
  assert.deepEqual(imported.softguardRetirementResolution, customer.softguardRetirementResolution)
  for (const backup of [{ customers: [oldBackup] }, { version: 2, before: [oldBackup], createdAccounts: [] }]) {
    const restored = restoreCustomerImportBackup([imported], backup)
    assert.equal(restored[0].name, 'NOMBRE ANTERIOR')
    assert.deepEqual(restored[0].softguardRetirementResolution, customer.softguardRetirementResolution)
  }
  const forged = preserveSoftguardRetirementCustomers([], [customer])[0]
  assert.equal(forged.softguardRetirementResolution, undefined)
  assert.equal(forged.subscriptionEndedAt, undefined)
  assert.throws(() => restoreCustomerImportBackup([retired()], { version: 2, before: [], createdAccounts: ['CLI-0176'] }), /Registrá primero la baja/)
})

test('undo refuses to reverse a subsequent retirement or restoration, avoiding duplicate customer identities', () => {
  const subscriber = { customerId: 'customer', account: 'PIG-0704', kind: 'subscriber' }
  assert.throws(() => restoreCustomerImportBackup([retired()], { version: 2, before: [subscriber], createdAccounts: [] }), { statusCode: 409 })
  assert.throws(() => restoreCustomerImportBackup([subscriber], { version: 2, before: [retired()], createdAccounts: [] }), { statusCode: 409 })
  assert.throws(() => restoreCustomerImportBackup([retired()], { version: 2, before: [], createdAccounts: ['PIG-0704'] }), { statusCode: 409 })
})

test('reopening, merge restoration and a new completed retirement invalidate the previous acknowledgment', () => {
  const customer = completed(retired({ phone: '3515551010', address: 'Calle 123' }))
  const record = { id: 'retirement', customerId: 'customer', service: 'Retiro de equipo', status: 'Completado' }
  const previous = { ...fixture(customer), history: [record] }
  const reopened = normalizeRetirementCustomers({ ...previous, history: [{ ...record, status: 'Pendiente' }] }, previous).state
  assert.equal(reopened.customers[0].account, 'PIG-0704')
  assert.equal(reopened.customers[0].softguardRetirementResolution, undefined)
  assert.equal(softguardRetirementPending(reopened.customers[0]), false)
  const completedAgain = normalizeRetirementCustomers({ ...reopened, history: [record] }, reopened).state
  assert.equal(completedAgain.customers[0].softguardRetirementResolution, undefined)
  assert.equal(softguardRetirementPending(completedAgain.customers[0]), true)
  const importedSubscriber = { ...reopened.customers[0], customerId: 'imported' }
  const merged = normalizeRetirementCustomers({ ...previous, customers: [customer, importedSubscriber], history: [{ ...record, status: 'Pendiente' }] }, previous).state
  assert.equal(merged.customers.length, 1)
  assert.equal(merged.customers[0].customerId, 'imported')
  assert.equal(merged.customers[0].softguardRetirementResolution, undefined)
  assert.deepEqual(merged.customers[0].mergedRetirementCustomers[0].softguardRetirementResolution, customer.softguardRetirementResolution)
})
