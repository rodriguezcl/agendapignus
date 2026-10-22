const test = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../api/_lib/permission-catalog.cjs')
const custom = permissions => ({ roleCode: 'role-test', role: 'Prueba', permissions: { __catalogV2: true, ...permissions } })

test('catalogue contains unique capabilities with known acyclic prerequisites', () => {
  assert.equal(policy.validateCatalog(), true)
  assert.equal(policy.CATALOG.length, 136)
  assert.equal(policy.MODULES.length, 14)
  assert.equal(policy.PERMISSION_GROUPS.length, 16)
  assert.equal(policy.MODULES.some(([id]) => id === 'notifications'), false)
  assert.equal(policy.PERMISSION_GROUPS.some(([id]) => id === 'notifications'), true)
  assert.equal(policy.BY_ID['notifications.view'], undefined)
  assert.equal(policy.MODULES.some(([id]) => id === 'operationalPlanning'), false)
  assert.equal(policy.PERMISSION_GROUPS.some(([id]) => id === 'operationalPlanning'), true)
  assert.equal(policy.BY_ID['operationalPlanning.view'], undefined)
})
test('checking a parent grants no child and removing it recursively clears dependants', () => {
  let user = custom({ 'technical.view': true, 'records.read': true, 'technical.start': true, 'technical.advance': true, 'technical.complete': true })
  let result = policy.togglePermission(user, 'technical.start', false)
  assert.equal(result.permissions['technical.advance'], false)
  assert.equal(result.permissions['technical.complete'], true, 'A colleague may have started the service')
  result = policy.togglePermission(custom(result.permissions), 'technical.start', true)
  assert.equal(result.permissions['technical.advance'], false)
  result = policy.togglePermission(custom(result.permissions), 'technical.view', false)
  assert.equal(result.permissions['records.read'], false)
  assert.equal(result.permissions['technical.start'], false)
  assert.equal(result.permissions['technical.complete'], false)
})

test('SoftGuard resolution is separate from notices, importing and editing customer identity', () => {
  const resolver = custom({ 'accounts.view': true, 'customers.softguard.resolve': true, 'notifications.softguard': false })
  assert.equal(policy.can(resolver, 'customers.softguard.resolve'), true)
  for (const id of ['customers.edit', 'customers.import', 'records.financial', 'notifications.softguard']) assert.equal(policy.can(resolver, id), false, id)
  assert.equal(policy.hasAnyWrite(resolver), true)
  assert.equal(policy.can(custom({ 'accounts.view': true, 'customers.edit': true }), 'customers.softguard.resolve'), false)
  assert.equal(policy.can(custom({ 'accounts.view': true, 'notifications.softguard': true }), 'customers.softguard.resolve'), false)
  const removed = policy.togglePermission(resolver, 'accounts.view', false)
  assert.equal(removed.permissions['customers.softguard.resolve'], false)
  assert.ok(removed.removed.includes('customers.softguard.resolve'))
  assert.equal(policy.can({ roleCode: 'administrator' }, 'customers.softguard.resolve'), true)
  assert.equal(policy.can({ roleCode: 'coordinator', permissions: { accounts: true, accountsEdit: true } }, 'customers.softguard.resolve'), true)
  for (const roleCode of ['operator', 'supervisor', 'technician']) {
    assert.equal(policy.can({ roleCode, permissions: { accounts: true, accountsEdit: true } }, 'customers.softguard.resolve'), false, roleCode)
  }
  assert.equal(policy.can({ roleCode: 'coordinator', permissions: { accounts: true } }, 'customers.softguard.resolve'), false)
})
test('shared actions remain enabled through another authorized module', () => {
  const user = custom({ 'weekly.view': true, 'agenda.view': true, 'records.read': true, 'planning.edit': true })
  const first = policy.togglePermission(user, 'weekly.view', false)
  assert.equal(first.permissions['planning.edit'], true)
  const second = policy.togglePermission(custom(first.permissions), 'agenda.view', false)
  assert.equal(second.permissions['planning.edit'], false)
  assert.match(policy.dependencyReason('planning.edit', second.permissions), /Requiere/)
})
test('a disabled prerequisite cannot be bypassed by stored child flags or non-booleans', () => {
  const user = custom({ 'collections.view': true, 'records.financial': false, 'collections.confirm': true, 'history.view': 'true', 'unknown.future.permission': true })
  assert.equal(policy.can(user, 'collections.confirm'), false)
  assert.equal(policy.can(user, 'history.view'), false)
  assert.equal(policy.can(user, 'unknown.future.permission'), false)
  assert.equal(policy.can({ roleCode: 'administrator' }, 'unknown.future.permission'), false)
})
test('legacy read-only roles remain restricted until explicitly saved as granular roles', () => {
  const operator = { name: 'Operador', code: 'legacy', permissions: { weekly: true, history: true, historyManage: true } }
  assert.equal(policy.can(operator, 'weekly.view'), true)
  assert.equal(policy.can(operator, 'history.view'), false)
  assert.equal(policy.can(operator, 'planning.create'), false)
  const migrated = { ...operator, code: 'operator', permissions: policy.toGranularPermissions(operator) }
  migrated.permissions['agenda.view'] = true
  migrated.permissions['planning.ready'] = true
  assert.equal(policy.can(migrated, 'planning.ready'), true)
  assert.equal(policy.can(migrated, 'planning.create'), false)
})
test('renaming granular roles does not change their identity or authority', () => {
  for (const name of ['Administrador', 'Supervisor', 'Operador', 'Técnico']) {
    const role = { name, code: 'role-123', permissions: { __catalogV2: true, 'history.view': true } }
    assert.equal(policy.roleCode(role), 'role-123')
    assert.equal(policy.can(role, 'settings.roles.permissions'), false)
  }
})
test('legacy migration preserves business CRUD but leaves protected capabilities denied', () => {
  const legacy = { code: 'coordinator', permissions: { employees: true, weekly: true, history: true, historyManage: false } }
  const migrated = { ...legacy, permissions: policy.toGranularPermissions(legacy) }
  for (const id of ['employees.create', 'employees.edit', 'employees.password', 'planning.create', 'planning.technicians']) assert.equal(policy.can(migrated, id), true, id)
  for (const id of ['employees.role', 'employees.technical', 'settings.roles.permissions', 'history.delete', 'weekly.holidays']) assert.equal(policy.can(migrated, id), false, id)
  assert.equal(policy.can(migrated, 'service.documents.upload'), true, 'Legacy effective attachment rights are explicitly migrated')
})
test('record scopes survive persistence and ambiguous scopes fail closed', () => {
  const technician = { code: 'technician', permissions: {} }
  const migrated = { ...technician, permissions: policy.toGranularPermissions(technician) }
  assert.equal(policy.readScope(migrated), 'assigned')
  assert.equal(policy.writeScope(migrated), 'assigned')
  assert.equal(policy.readScope(migrated, 'customers'), 'related')
  migrated.permissions['scope.services.read.cctv'] = true
  assert.equal(policy.readScope(migrated), 'none')
})
test('viewing and exporting do not make a role writable', () => {
  assert.equal(policy.hasAnyWrite(custom({ 'history.view': true, 'records.read': true, 'records.export': true })), false)
  assert.equal(policy.hasAnyWrite(custom({ 'history.view': true, 'records.read': true, 'service.documents.read': true, 'service.documents.deleteOwn': true })), true)
})
test('frontend and backend resolve versioned roles identically', async () => {
  const frontend = await import('../src/domain/access/permissions.mjs')
  const role = { name: 'Operador', code: 'operator', permissions: { __catalogV2: true, 'weekly.view': true, 'records.read': true, 'planning.ready': true } }
  const actual = frontend.resolvedRolePermissions(role)
  for (const item of policy.CATALOG) assert.equal(actual[item.id], policy.can(role, item.id), item.id)
  assert.equal(actual.weekly, true)
  assert.equal(actual.weeklyTeams, false)
})
test('request snapshots are immutable without caching subsequent revocations', () => {
  const actor = custom({ 'history.view': true, 'records.read': true })
  const request = policy.permissionSnapshot(actor)
  assert.equal(policy.can(request, 'records.read'), true)
  assert.equal(Object.isFrozen(request.permissions), true)
  assert.equal(Object.isFrozen(policy.resolvePermissions(request)), true)
  actor.permissions['history.view'] = false
  assert.equal(policy.can(actor, 'records.read'), false)
  assert.equal(policy.can(policy.permissionSnapshot(actor), 'records.read'), false)
})

const noticePrerequisites = {
  'followups.view': true,
  'weekly.view': true,
  'records.read': true,
  'collections.view': true,
  'records.financial': true,
  'vehicles.view': true,
  'vehicle.insurance.read': true,
  'accounts.view': true,
  'employees.view': true,
  'employees.requests.read': true
}

test('existing granular roles inherit only notices supported by their effective reading permissions', () => {
  assert.equal(policy.NOTIFICATION_IDS.length, 10)
  const role = custom(noticePrerequisites)
  for (const id of policy.NOTIFICATION_IDS) assert.equal(policy.can(role, id), true, id)
  const noAccess = custom(Object.fromEntries(policy.NOTIFICATION_IDS.map(id => [id, true])))
  for (const id of policy.NOTIFICATION_IDS) assert.equal(policy.can(noAccess, id), false, id)
  for (const id of Object.keys(noticePrerequisites)) assert.equal(policy.can(noAccess, id), false, id)
  const malformedParents = custom({ 'records.read': true, 'employees.requests.read': true, 'vehicle.insurance.read': true })
  for (const id of policy.NOTIFICATION_IDS) assert.equal(policy.can(malformedParents, id), false, id)
})

test('legacy notification defaults follow actual capabilities instead of role names or raw module flags', () => {
  const operator = { name: 'Operador', permissions: { collections: true, vehicles: true, employees: true } }
  assert.equal(policy.can(operator, 'notifications.collections'), false)
  assert.equal(policy.can(operator, 'notifications.reservations'), true)
  assert.equal(policy.can(operator, 'notifications.insurance'), false)
  assert.equal(policy.can(operator, 'notifications.passwordRequests'), false)
  const coordinator = { code: 'coordinator', permissions: { collections: true, vehicles: true, accounts: true } }
  assert.equal(policy.can(coordinator, 'notifications.collections'), true)
  assert.equal(policy.can(coordinator, 'notifications.insurance'), true)
  assert.equal(policy.can(coordinator, 'notifications.softguard'), true)
  assert.equal(policy.can(coordinator, 'notifications.pendingToday'), false)
  coordinator.permissions['notifications.collections'] = false
  assert.equal(policy.can(coordinator, 'notifications.collections'), false)
  const technician = { code: 'technician', permissions: {} }
  assert.equal(policy.can(technician, 'vehicle.insurance.read'), true)
  for (const id of policy.NOTIFICATION_IDS) assert.equal(policy.can(technician, id), id === 'notifications.followups', id)
})

test('explicit notification preferences prevail over defaults and require strict booleans', () => {
  for (const value of [false, null, undefined, 'true', 1]) {
    const role = custom({ ...noticePrerequisites, 'notifications.collections': value })
    assert.equal(policy.can(role, 'notifications.collections'), false, String(value))
    assert.equal(policy.toGranularPermissions(role)['notifications.collections'], false)
  }
  const administrator = { code: 'administrator', permissions: { __catalogV2: true, ...Object.fromEntries(policy.NOTIFICATION_IDS.map(id => [id, false])) } }
  for (const id of policy.NOTIFICATION_IDS) assert.equal(policy.can(administrator, id), true, id)
})

test('new role defaults and reenabled parents never turn on explicitly disabled notifications', () => {
  const blank = custom(Object.fromEntries(policy.CATALOG.map(item => [item.id, false])))
  let updated = policy.togglePermission(blank, 'accounts.view', true)
  assert.equal(updated.permissions['notifications.softguard'], false)
  updated = policy.togglePermission(custom(updated.permissions), 'notifications.softguard', true)
  assert.equal(updated.permissions['notifications.softguard'], true)
  updated = policy.togglePermission(custom(updated.permissions), 'accounts.view', false)
  assert.equal(updated.permissions['notifications.softguard'], false)
  assert.ok(updated.removed.includes('notifications.softguard'))
  updated = policy.togglePermission(custom(updated.permissions), 'accounts.view', true)
  assert.equal(updated.permissions['notifications.softguard'], false)
  assert.match(policy.dependencyReason('notifications.collections', updated.permissions), /Cobranzas/)
})

test('notification defaults normalize, migrate, snapshot and delegate consistently without write privileges', async () => {
  const { canDelegateRole } = await import('../src/domain/access/role-delegation.mjs')
  const { PERMISSION_GROUPS, toGranularPermissions, canPermission } = await import('../src/domain/access/permissions.mjs')
  assert.deepEqual(PERMISSION_GROUPS, policy.PERMISSION_GROUPS)
  const role = custom(noticePrerequisites)
  const resolved = policy.resolvePermissions(role)
  const migrated = toGranularPermissions(role)
  const request = policy.permissionSnapshot(role)
  assert.deepEqual(policy.normalizePermissions(resolved), resolved)
  assert.deepEqual(policy.resolvePermissions(custom(migrated)), resolved)
  assert.equal(policy.hasAnyWrite(role), false)
  for (const id of policy.NOTIFICATION_IDS) {
    assert.equal(canPermission(role, id), policy.can(request, id), id)
    assert.equal(migrated[id], true, id)
  }
  assert.equal(canDelegateRole(role, role), true)
  role.permissions['notifications.collections'] = false
  assert.equal(policy.can(role, 'notifications.collections'), false)
  assert.equal(policy.can(request, 'notifications.collections'), true, 'The earlier immutable snapshot retains its prior reading decision')
  assert.equal(policy.can(policy.permissionSnapshot(role), 'notifications.collections'), false)
  assert.equal(canDelegateRole(role, custom(noticePrerequisites)), false)
})
