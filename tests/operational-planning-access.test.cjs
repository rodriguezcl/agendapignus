const test = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../api/_lib/permission-catalog.cjs')

const custom = permissions => ({ code: 'role-planning', permissions: { __catalogV2: true, ...permissions } })

test('operational planning exposes only effective existing read capabilities', async () => {
  const { canAccessOperationalPlanning, OPERATIONAL_PLANNING_TABS } = await import('../src/domain/access/operational-planning.mjs')
  assert.deepEqual(OPERATIONAL_PLANNING_TABS.map(tab => tab.id), ['hours', 'teams', 'vehicles', 'guards'])
  assert.equal(canAccessOperationalPlanning({ code: 'administrator' }), true)
  assert.equal(canAccessOperationalPlanning(custom({ 'weekly.view': true })), false)
  assert.equal(canAccessOperationalPlanning(custom({ 'operationalPlanning.view': true })), false)
  for (const tab of OPERATIONAL_PLANNING_TABS) {
    const subject = custom({ 'weekly.view': true, [tab.permission]: true })
    assert.equal(canAccessOperationalPlanning(subject), true, tab.id)
    assert.equal(policy.hasAnyWrite(subject), false, tab.id)
    subject.permissions['weekly.view'] = false
    assert.equal(canAccessOperationalPlanning(subject), false, `${tab.id}: missing parent`)
    subject.permissions['weekly.view'] = true
    subject.permissions[tab.permission] = 'true'
    assert.equal(canAccessOperationalPlanning(subject), false, `${tab.id}: strict boolean`)
  }
})

test('moving planning capabilities does not broaden legacy roles or auto-enable management', async () => {
  const { canAccessOperationalPlanning } = await import('../src/domain/access/operational-planning.mjs')
  for (const code of ['operator', 'supervisor', 'technician']) {
    assert.equal(canAccessOperationalPlanning({ code, permissions: { weekly: true, weeklyTeams: true, weeklyHours: true, weeklyVehicles: true, weeklyGuards: true } }), false, code)
  }
  for (const feature of ['weeklyTeams', 'weeklyHours', 'weeklyVehicles', 'weeklyGuards']) {
    assert.equal(canAccessOperationalPlanning({ code: 'coordinator', permissions: { weekly: true, [feature]: true } }), true, feature)
    assert.equal(canAccessOperationalPlanning({ code: 'coordinator', permissions: { [feature]: true } }), false, `${feature}: missing weekly access`)
  }
  assert.equal(canAccessOperationalPlanning({ code: 'coordinator', permissions: { weekly: true } }), false)
  assert.equal(canAccessOperationalPlanning(custom({ 'weekly.monthlyTeams.manage': true, 'weekly.view': true })), false)
})

test('planning settings share one presentation group while keeping original dependencies and aliases', async () => {
  const { NAVIGATION_ITEMS, navigationForModules, navigationLabel } = await import('../src/domain/access/navigation.mjs')
  const entries = policy.CATALOG.filter(item => item.groups.includes('operationalPlanning'))
  assert.equal(entries.length, 9)
  for (const item of entries) {
    assert.deepEqual(item.groups, ['operationalPlanning'])
    assert.ok(item.id.startsWith('weekly.'))
    const expectedParent = item.id.endsWith('.read') ? 'weekly.view'
      : item.id === 'weekly.controls.schedule' ? 'weekly.monthlyVehicles.read'
      : `${item.id.slice(0, item.id.lastIndexOf('.'))}.read`
    assert.deepEqual(item.all, [expectedParent], item.id)
    assert.deepEqual(item.any, [], item.id)
  }
  assert.deepEqual(policy.ALIASES.weeklyVehicles, ['weekly.monthlyVehicles.assign', 'weekly.controls.schedule'])
  const navigation = navigationForModules(['services', 'operationalPlanning', 'vehicles', 'employees'])
  assert.deepEqual(navigation.map(item => item.id), ['employees', 'vehicles', 'operationalPlanning', 'services'])
  const planning = NAVIGATION_ITEMS.find(item => item.id === 'operationalPlanning')
  assert.equal(planning.section, 'resources')
  assert.equal(planning.collapsible, true)
  assert.equal(navigationLabel('operationalPlanning'), 'Planificación operativa')
})
