const test = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../api/_lib/permission-catalog.cjs')
const custom = permissions => ({ roleCode: 'role-test', role: 'Prueba', permissions: { __catalogV2: true, ...permissions } })

test('catalogue contains unique capabilities with known acyclic prerequisites', () => {
  assert.equal(policy.validateCatalog(), true)
  assert.equal(policy.CATALOG.length, 121)
  assert.equal(policy.MODULES.length, 13)
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
