const test = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../api/_lib/permission-catalog.cjs')

const custom = permissions => ({ id: 700, code: 'role-700', name: 'Agente', permissions: { __catalogV2: true, ...permissions } })
const previewModule = (preview, id) => preview.modules.find(module => module.id === id)
const capability = (preview, module, id) => previewModule(preview, module).capabilities.find(item => item.id === id)
const notification = (preview, id) => preview.notifications.find(item => item.id === `notifications.${id}`)

test('role preview evaluates the unsaved draft without mutating it or granting shared actions through a hidden module', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const saved = custom({ 'weekly.view': true, 'agenda.view': true, 'records.read': true, 'planning.ready': true })
  const draft = structuredClone(saved)
  draft.permissions['weekly.view'] = false
  const before = JSON.stringify(draft)
  const preview = buildRolePreview(draft)
  assert.equal(previewModule(preview, 'weekly').visible, false)
  assert.equal(previewModule(preview, 'agenda').visible, true)
  assert.equal(capability(preview, 'agenda', 'planning.ready').allowed, true)
  assert.equal(capability(preview, 'weekly', 'planning.ready').granted, true)
  assert.equal(capability(preview, 'weekly', 'planning.ready').allowed, false)
  assert.equal(previewModule(buildRolePreview(saved), 'weekly').visible, true)
  assert.equal(JSON.stringify(draft), before)
  assert.equal(saved.permissions['weekly.view'], true)
})

test('role preview applies dependency revocations and keeps notification preferences separate from action permissions', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const role = custom({
    'weekly.view': true, 'records.read': true,
    'collections.view': true, 'records.financial': false, 'collections.confirm': true,
    'notifications.collections': true, 'notifications.reservations': false
  })
  const preview = buildRolePreview(role)
  assert.equal(previewModule(preview, 'collections').visible, true)
  assert.equal(capability(preview, 'collections', 'collections.confirm').allowed, false)
  assert.match(capability(preview, 'collections', 'collections.confirm').reason, /Requiere/)
  assert.equal(notification(preview, 'collections').enabled, false)
  assert.match(notification(preview, 'collections').reason, /Requiere/)
  assert.equal(notification(preview, 'reservations').enabled, false)
  assert.equal(notification(preview, 'pendingToday').enabled, true)
  assert.ok(preview.modules.every(module => module.capabilities.every(item => !item.id.startsWith('notifications.'))))
  for (const id of policy.NOTIFICATION_IDS) assert.equal(preview.notifications.find(item => item.id === id).enabled, policy.can(role, id), id)
  role.permissions['records.financial'] = true
  role.permissions['collections.confirm'] = false
  const updated = buildRolePreview(role)
  assert.equal(notification(updated, 'collections').enabled, true)
  assert.equal(capability(updated, 'collections', 'collections.confirm').allowed, false)
})

test('technical preview requires employee eligibility and preserves per-service conditions', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const role = custom({ 'technical.view': true, 'records.read': true, 'technical.start': true, 'technical.complete': false })
  const standard = buildRolePreview(role)
  assert.equal(standard.technical.configured, true)
  assert.equal(standard.technical.eligible, false)
  assert.equal(standard.technical.visible, false)
  assert.equal(standard.portalOnly, false)
  assert.equal(previewModule(standard, 'technical').visible, false)
  assert.match(capability(standard, 'technical', 'technical.start').reason, /ficha del colaborador/)
  const technician = buildRolePreview(role, { technicalEnabled: true })
  assert.equal(technician.technical.visible, true)
  assert.equal(technician.portalOnly, true)
  assert.equal(capability(technician, 'technical', 'technical.start').allowed, true)
  assert.equal(capability(technician, 'technical', 'technical.complete').allowed, false)
  assert.ok(technician.technical.conditions.some(condition => condition.includes('asignado')))
  assert.ok(technician.technical.conditions.some(condition => condition.includes('jornadas')))
  assert.deepEqual(technician.navigation, [{ id: 'myServices', label: 'Mis servicios' }])
  assert.equal(buildRolePreview({ ...role, code: 'technician' }).technical.eligible, true)
  assert.equal(buildRolePreview(custom({ 'technical.start': true }), { technicalEnabled: true }).technical.visible, false)
})

test('role names never impersonate the administrator and administrative previews include every notification category', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const renamed = buildRolePreview({ ...custom({ 'weekly.view': true }), name: 'Administrador' })
  assert.equal(renamed.roleCode, 'role-700')
  assert.equal(previewModule(renamed, 'settings').visible, false)
  assert.equal(renamed.notifications.find(item => item.id === 'administrator.advanceRequests').enabled, false)
  const administrator = buildRolePreview({ ...custom({}), code: 'administrator', name: 'Dirección' })
  assert.equal(administrator.enabledNotifications.length, policy.NOTIFICATION_IDS.length + 1)
  assert.equal(administrator.modules.filter(module => module.visible).length, policy.MODULES.length - 1, 'The virtual planning screen is included; technical work still depends on employee eligibility')
  assert.equal(administrator.readOnly, false)
  assert.equal(administrator.helpVisible, true)
  assert.equal(administrator.notifications.find(item => item.id === 'administrator.advanceRequests').enabled, true)
  assert.ok(administrator.modules.filter(module => module.id !== 'technical').every(module => module.capabilities.every(item => item.allowed)))
  assert.ok(buildRolePreview({ code: 'administrator' }, { technicalEnabled: true }).modules.every(module => module.visible))
})

test('preview scopes preserve assigned and CCTV restrictions, including invalid combinations', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const role = custom({
    'history.view': true, 'records.read': true, 'history.edit': true,
    'scope.services.read.assigned': true, 'scope.services.write.cctv': true, 'scope.customers.read.related': true
  })
  const preview = buildRolePreview(role)
  assert.deepEqual(preview.scopes.map(scope => scope.value), ['assigned', 'cctv', 'related'])
  assert.match(preview.scopes[0].description, /asignados/)
  assert.match(preview.scopes[1].description, /CCTV/)
  assert.match(preview.scopes[2].description, /vinculados/)
  role.permissions['scope.services.read.cctv'] = true
  const invalid = buildRolePreview(role)
  assert.equal(invalid.scopes[0].value, 'none')
  assert.match(invalid.scopes[0].description, /Sin acceso/)
})

test('preview uses stable application navigation order and accurately distinguishes read-only and technical-only access', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const readOnly = buildRolePreview(custom({ 'weekly.view': true, 'history.view': true, 'records.read': true, 'records.export': true }))
  assert.equal(readOnly.readOnly, true)
  assert.equal(readOnly.helpVisible, false)
  assert.deepEqual(readOnly.navigation.map(item => item.id), ['weekly', 'history'])
  const manager = buildRolePreview(custom({
    'dashboard.view': true, 'weekly.view': true, 'agenda.view': true, 'history.view': true,
    'settings.view': true, 'audit.view': true, 'technical.view': true, 'records.read': true, 'planning.ready': true
  }), { technicalEnabled: true })
  assert.deepEqual(manager.navigation.map(item => item.id), ['dashboard', 'weekly', 'agenda', 'history', 'myServices', 'settings', 'audit', 'help'])
  assert.equal(manager.portalOnly, false)
  assert.equal(manager.helpVisible, true)
  const empty = buildRolePreview(custom({}))
  assert.deepEqual(empty.visibleModules, [])
  assert.equal(empty.hiddenModules.length, policy.MODULES.length)
  assert.deepEqual(empty.enabledNotifications, [])
  assert.deepEqual(empty.navigation, [])
})

test('legacy preview migration preserves role identity, technical scopes and notification defaults', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const operator = buildRolePreview({ id: 5, name: 'Operador', code: 'legacy', permissions: { collections: true } })
  assert.equal(operator.roleCode, 'operator')
  assert.deepEqual(operator.visibleModules.map(module => module.id), ['weekly', 'tickets'])
  assert.equal(notification(operator, 'collections').enabled, false)
  assert.equal(notification(operator, 'pendingToday').enabled, true)
  const technician = buildRolePreview({ id: 4, code: 'technician', name: 'Técnico', permissions: {} })
  assert.equal(technician.technical.visible, true)
  assert.equal(technician.portalOnly, true)
  assert.deepEqual(technician.scopes.map(scope => scope.value), ['assigned', 'assigned', 'related'])
  assert.deepEqual(technician.visibleModules.map(module => module.id), ['tickets', 'technical'])
  assert.deepEqual(technician.enabledNotifications.map(item => item.id), ['notifications.tickets'])
})

test('planning preview groups existing capabilities and reacts to unsaved prerequisite revocations', async () => {
  const { buildRolePreview } = await import('../src/domain/access/role-preview.mjs')
  const role = custom({
    'weekly.view': true,
    'weekly.monthlyTeams.read': true,
    'weekly.monthlyTeams.manage': true,
    'weekly.guards.read': true
  })
  const before = JSON.stringify(role)
  const preview = buildRolePreview(role)
  assert.equal(previewModule(preview, 'operationalPlanning').visible, true)
  assert.equal(capability(preview, 'operationalPlanning', 'weekly.monthlyTeams.manage').allowed, true)
  assert.equal(capability(preview, 'operationalPlanning', 'weekly.guards.manage').allowed, false)
  assert.equal(capability(preview, 'weekly', 'weekly.monthlyTeams.manage'), undefined)
  assert.deepEqual(preview.navigation.map(item => item.id), ['weekly', 'operationalPlanning', 'help'])
  assert.equal(JSON.stringify(role), before)

  const draft = structuredClone(role)
  draft.permissions['weekly.monthlyTeams.read'] = false
  const partial = buildRolePreview(draft)
  assert.equal(previewModule(partial, 'operationalPlanning').visible, true)
  assert.equal(capability(partial, 'operationalPlanning', 'weekly.monthlyTeams.manage').allowed, false)
  assert.match(capability(partial, 'operationalPlanning', 'weekly.monthlyTeams.manage').reason, /Requiere/)
  draft.permissions['weekly.view'] = false
  const revoked = buildRolePreview(draft)
  assert.equal(previewModule(revoked, 'operationalPlanning').visible, false)
  assert.ok(!revoked.navigation.some(item => item.id === 'operationalPlanning'))
  assert.equal(JSON.stringify(role), before)
})
