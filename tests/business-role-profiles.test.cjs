const test = require('node:test'), assert = require('node:assert/strict')
const policy = require('../api/_lib/permission-catalog.cjs')
const { profiles, profileRole, businessRolesPlan, SYSTEM_ADMIN_NAME } = require('../api/_lib/business-role-profiles.cjs')
const { userForEmployee, visibleStateForUser } = require('../api/_lib/core.cjs')
const tickets = require('../api/_lib/tickets.cjs')
const roles = Object.fromEntries(profiles.map(profile => [profile.code, profileRole(profile)]))
const user = code => userForEmployee({ id: 'test-user', roleId: roles[code].id, status: 'Activo' }, Object.values(roles))
test('business profiles have effective, explicit permissions and cannot administer access', () => {
  for (const role of Object.values(roles)) {
    assert.equal(policy.isGranular(role), true)
    for (const { id } of policy.CATALOG) assert.equal(policy.can(role, id), role.permissions[id], `${role.code}: ${id}`)
    for (const key of ['settings.view', 'employees.view', 'employees.role', 'employees.password', 'settings.roles.create', 'settings.roles.permissions', 'tickets.configure', 'technical.view', 'history.delete', 'customers.delete', 'customers.undo']) assert.equal(policy.can(role, key), false, `${role.code}: ${key}`)
    assert.equal(policy.can(role, 'tickets.create'), true)
  }
})
test('accounting manages payment and banking information without scheduling or closing services', () => {
  const actor = user('accounting')
  for (const key of ['collections.confirm', 'collections.amount', 'collections.method', 'subscriptions.correct', 'registration.sensitive', 'registration.manage', 'forms.view', 'planning.reservation.link', 'notifications.collections', 'notifications.registration']) assert.equal(policy.can(actor, key), true, key)
  for (const key of ['planning.create', 'planning.edit', 'planning.confirm', 'planning.reschedule', 'history.edit', 'history.complete', 'notifications.pendingToday', 'notifications.confirmation']) assert.equal(policy.can(actor, key), false, key)
})
test('seller has own reservations and limited ticket access without broad account or payment visibility', () => {
  const actor = user('seller')
  assert.equal(policy.can(actor, 'sales.reserve'), true)
  for (const key of ['weekly.view', 'history.view', 'accounts.view', 'forms.view', 'collections.view', 'records.financial', 'registration.sensitive', 'planning.confirm', 'tickets.scope.all', 'tickets.resolve', 'notifications.collections', 'notifications.reservations']) assert.equal(policy.can(actor, key), false, key)
  const customer = { customerId: 'customer', account: 'PIG-123', name: 'Cuenta', phone: '123', address: 'Privada', amount: 999 }
  assert.equal(tickets.intakeCustomerReadable(customer, actor, {}), true)
  assert.deepEqual(tickets.snapshot(customer, actor), { id: 'customer', customerId: 'customer', account: 'PIG-123', name: 'Cuenta' })
  assert.equal(tickets.visible({ createdById: 'test-user' }, actor, {}, { areas: [] }), true)
  assert.equal(tickets.visible({ createdById: 'another' }, actor, {}, { areas: [] }), false)
  const visible = visibleStateForUser({ roles: Object.values(roles), employees: [], history: [], agenda: {}, customers: [customer], services: [], vehicles: [], preferences: {} }, actor)
  assert.equal(visible.customers.length, 0)
})
test('coordinator manages schedules and operational tickets but cannot confirm payments or reveal banking data', () => {
  const actor = user('coordinator')
  for (const key of ['planning.confirm', 'planning.reschedule', 'weekly.monthlyTeams.manage', 'weekly.monthlyVehicles.assign', 'weekly.guards.manage', 'history.complete', 'tickets.linkService', 'tickets.assign', 'tickets.resolve', 'notifications.confirmation']) assert.equal(policy.can(actor, key), true, key)
  for (const key of ['collections.view', 'collections.confirm', 'subscriptions.correct', 'registration.sensitive', 'notifications.collections', 'notifications.passwordRequests']) assert.equal(policy.can(actor, key), false, key)
})
test('rename preserves administrator identity, effective permissions and employee assignments; creation is idempotent', () => {
  const admin = { id: 1, code: 'administrator', name: 'Administrador', permissions: { weekly: true } }
  const agent = { id: 2, code: 'user', name: 'Agente', permissions: { __catalogV2: true, 'tickets.view': true, 'tickets.create': true } }
  const original = { roles: [admin, agent], employees: [{ id: 'admin-user', roleId: 1, role: 'Administrador', passwordHash: 'unchanged' }, { id: 'agent-user', roleId: 2, role: 'Agente' }], history: [{ createdBy: { role: 'Administrador' } }], agenda: { date: '2026-10-29' } }
  const before = structuredClone(original), { state, changes } = businessRolesPlan(original)
  assert.deepEqual(original, before)
  assert.equal(changes.length, 4)
  assert.equal(state.roles[0].name, SYSTEM_ADMIN_NAME)
  assert.deepEqual(state.roles[0].permissions, admin.permissions)
  assert.deepEqual(policy.resolvePermissions(state.roles[0]), policy.resolvePermissions(admin))
  assert.equal(userForEmployee(state.employees[0], state.roles).roleCode, 'administrator')
  assert.deepEqual(state.employees[0], { ...before.employees[0], role: SYSTEM_ADMIN_NAME })
  assert.deepEqual(state.roles[1], agent); assert.deepEqual(state.employees[1], before.employees[1])
  assert.deepEqual(state.history, before.history); assert.deepEqual(state.agenda, before.agenda)
  state.roles.find(role => role.code === 'seller').permissions['tickets.comment'] = false
  assert.equal(businessRolesPlan(state).changed, false)
  assert.equal(policy.roleCode({ name: SYSTEM_ADMIN_NAME }), 'administrator')
  assert.notEqual(policy.roleCode({ name: 'Administrativo contable' }), 'administrator')
})
test('ambiguous existing roles fail without overwriting them', () => {
  const base = { roles: [{ id: 1, code: 'administrator', name: 'Administrador' }], employees: [] }
  assert.throws(() => businessRolesPlan({ ...base, roles: [...base.roles, { id: 2, code: 'custom', name: 'Vendedor' }] }), /Ya existe/)
  assert.throws(() => businessRolesPlan({ roles: [], employees: [] }), /único rol/)
})
test('PostgreSQL role rollout preserves assignments and survives normalized storage reconstruction', async () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '..')
  const { PGlite } = await import('@electric-sql/pglite')
  const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
  const { fixture } = require('./helpers/planning-click-fixture.cjs')
  const { normalizeStateForSave } = require('../api/_lib/core.cjs')
  const { replaceCollections } = require('../api/_lib/database.cjs')
  const { readApplicationState } = require('../api/_lib/storage-router.cjs')
  const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
  const { configureBusinessRoles } = require('../scripts/configure-business-roles.cjs')
  const pg = await PGlite.create()
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), raw = fixture()
    raw.roles = [{ id: 'admin', code: 'administrator', name: 'Administrador', permissions: {} }, { id: 'technician', code: 'technician', name: 'Técnico', permissions: {} }]
    raw.employees = raw.employees.map((e, index) => ({ ...e, roleId: index ? 'technician' : 'admin', role: index ? 'Técnico' : 'Administrador' }))
    const initial = { ...normalizeStateForSave(raw, raw), revision: 1 }
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const candidate = buildShadowCandidate(initial)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [1, candidate.analysis.sourceFingerprint])
    const before = await readApplicationState(sql)
    assert.equal((await configureBusinessRoles(sql)).applied, false)
    assert.deepEqual(await readApplicationState(sql), before)
    assert.equal((await configureBusinessRoles(sql, { apply: true })).applied, true)
    const after = await readApplicationState(sql)
    assert.equal(after.roles.length, 5)
    assert.equal(after.roles.find(r => r.code === 'administrator').name, SYSTEM_ADMIN_NAME)
    for (const employee of after.employees) {
      const previous = before.employees.find(e => e.id === employee.id)
      assert.deepEqual(employee, { ...previous, role: employee.roleId === 'admin' ? SYSTEM_ADMIN_NAME : previous.role })
    }
    for (const key of ['history', 'agenda', 'customers', 'vehicles', 'services']) assert.deepEqual(after[key], before[key])
    assert.equal(after.revision, 2)
    assert.equal((await configureBusinessRoles(sql, { apply: true })).applied, false)
    assert.deepEqual(await readApplicationState(sql), after)
    const control = (await pg.query('select active_fingerprint from normalized_shadow.storage_control where id=1')).rows[0]
    assert.equal(control.active_fingerprint, buildShadowCandidate(after).analysis.sourceFingerprint)
  } finally { await pg.close() }
})
