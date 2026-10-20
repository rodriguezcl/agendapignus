const test = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../api/_lib/permission-catalog.cjs')

test('live session identity takes priority over stale role snapshots and falls back for legacy sessions', async () => {
  const { currentSessionRole, reconcileSessionUser } = await import('../src/features/auth/application/session-user.mjs')
  const oldRole = { id: 'old', name: 'Administrador', code: 'administrator', permissions: { __catalogV2: true } }
  const current = { id: 'u', roleId: 'old', role: oldRole.name, roleCode: oldRole.code, permissions: oldRole.permissions }
  const received = { id: 'u', roleId: 'new', role: 'Consulta', roleCode: 'role-new', permissions: { __catalogV2: true, 'history.view': true, 'records.read': true }, technicalEnabled: false }
  const next = reconcileSessionUser(current, received)
  assert.equal(policy.can(currentSessionRole(next, [oldRole]), 'history.view'), true)
  assert.equal(policy.can(currentSessionRole(next, [oldRole]), 'settings.roles.permissions'), false)
  const revoked = reconcileSessionUser(next, { ...received, permissions: { __catalogV2: true } })
  assert.equal(policy.can(currentSessionRole(revoked, [{ ...oldRole, id: 'new' }]), 'history.view'), false)
  assert.equal(currentSessionRole({ id: 'u', roleId: 'old' }, [oldRole]), oldRole)
  assert.equal(currentSessionRole({ id: 'u', role: 'Administrador' }, [oldRole]), oldRole)
})

test('session refresh preserves identity, ignores secret fields and is stable for unchanged metadata', async () => {
  const { reconcileSessionUser } = await import('../src/features/auth/application/session-user.mjs')
  const current = { id: 'u', name: 'Usuario', permissions: { __catalogV2: true } }
  assert.equal(reconcileSessionUser(current, { id: 'another', roleCode: 'administrator' }), current)
  assert.equal(reconcileSessionUser(null, current), null)
  assert.equal(reconcileSessionUser(current, { ...current, passwordHash: 'secret', token: 'secret' }), current)
  assert.deepEqual(reconcileSessionUser(current, { ...current, name: 'Nombre nuevo' }), { ...current, name: 'Nombre nuevo' })
})

test('legacy session defaults survive empty flags without widening granular roles or overriding revocations', async () => {
  const { currentSessionRole } = await import('../src/features/auth/application/session-user.mjs')
  const { resolvedRolePermissions } = await import('../src/domain/access/permissions.mjs')
  for (const roleCode of ['user', 'coordinator']) {
    const legacy = currentSessionRole({ id: 'u', roleCode, permissions: {} })
    assert.equal(resolvedRolePermissions(legacy).weekly, true)
    assert.equal(resolvedRolePermissions(legacy).dashboard, true)
    assert.equal(resolvedRolePermissions(currentSessionRole({ id: 'u', roleCode, permissions: { weekly: false } })).weekly, false)
    const granular = currentSessionRole({ id: 'u', roleCode, permissions: { __catalogV2: true } })
    assert.equal(resolvedRolePermissions(granular).weekly, false)
    assert.equal(resolvedRolePermissions(granular).dashboard, false)
  }
})

test('session metadata follows response deltas but is excluded from editable state operations', async () => {
  const { stateDelta, applyStateDelta } = await import('../src/domain/shared/state-delta.mjs')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const before = { revision: 1, roles: [], history: [], sessionUser: { id: 'u', roleCode: 'administrator' } }
  const after = { ...before, revision: 2, sessionUser: { id: 'u', roleCode: 'role-read', permissions: { __catalogV2: true, 'history.view': true } } }
  assert.deepEqual(applyStateDelta(before, stateDelta(before, after)), after)
  assert.deepEqual(stateOperations(before, after), [])
  assert.equal(before.sessionUser.roleCode, 'administrator')
  assert.throws(() => applyStateDelta(before, { baseRevision: 1, revision: 2, changes: { credentials: { value: {} } } }), /inválida/)
})
