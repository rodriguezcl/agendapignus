const test = require('node:test')
const assert = require('node:assert/strict')
const { preparePlanningClick } = require('../api/_lib/planning-click-operation.cjs')
const { normalizeStateForSave, authorizeIncomingState, visibleStateForUser, validateState } = require('../api/_lib/core.cjs')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { fixture, admin, day } = require('./helpers/planning-click-fixture.cjs')

async function builders() {
  return {
    ...await import('../src/features/state/application/service-preparation.mjs'),
    ...await import('../src/features/state/application/weekly-team-members-save.mjs'),
    ...await import('../src/features/state/application/state-operations.mjs')
  }
}
function general(current, operations, user = admin) {
  // Compare persistent state with the optimized helper. sessionUser belongs to
  // the final HTTP projection, whose full/delta behavior has integration tests.
  const { sessionUser, ...editable } = visibleStateForUser(current, user)
  const next = normalizeStateForSave(authorizeIncomingState(applyStateOperations(editable, operations), current, user), current, { allowEarlyCompletion: true })
  validateState(next, current)
  return next
}
function withoutStamp(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === 'at' ? undefined : item))
}

test('ready click matches general policy and keeps unrelated collections by reference', async () => {
  const { servicePreparationOperations } = await builders()
  for (const user of [admin, { id: 'planner', name: 'Planificador', roleCode: 'user', permissions: { weekly: true, history: true } }]) {
    const current = fixture(), saved = structuredClone(current)
    const ops = servicePreparationOperations(current, { base: current.history[0], ready: true })
    const fast = preparePlanningClick(current, ops, user)
    assert.equal(fast.kind, 'service_preparation')
    assert.deepEqual(withoutStamp(fast.state), withoutStamp(general(current, ops, user)))
    for (const key of ['customers', 'employees', 'roles', 'services', 'vehicles', 'reviews']) assert.equal(fast.state[key], current[key])
    assert.deepEqual(current, saved, 'preparation must not mutate its baseline')
    const replay = preparePlanningClick(fast.state, ops, user)
    assert.equal(replay.state.history, fast.state.history)
    assert.equal(replay.state.agenda, fast.state.agenda)
    const unrelatedEdit = structuredClone(fast.state); unrelatedEdit.history[0].detail = 'another writer'
    assert.throws(() => preparePlanningClick(unrelatedEdit, ops, user), { code: 'RECORD_WRITE_CONFLICT' })
  }
})

test('existing weekly and daily membership matches general policies, with idempotent replay and conflicts', async () => {
  const { weeklyTeamMemberOperations } = await builders()
  for (const user of [admin, { id: 'planner', roleCode: 'user', permissions: { weekly: true, history: true } }]) {
    const current = fixture(), saved = structuredClone(current)
    const team = current.agenda.weekly[day].teams[0]
    const ops = weeklyTeamMemberOperations(current, { day, teamId: 'team', teamIndex: 0, baseMemberIds: team.memberIds, baseMembers: team.members, memberIds: ['two'], members: ['two Técnico'] })
    const fast = preparePlanningClick(current, ops, user)
    assert.equal(fast.kind, 'team_membership')
    assert.deepEqual(fast.state, general(current, ops, user))
    assert.deepEqual(fast.state.history[0].technicianIds, ['two'])
    assert.deepEqual(current, saved)
    const replay = preparePlanningClick(fast.state, ops, user)
    assert.equal(replay.state.history, fast.state.history)
    assert.equal(replay.state.agenda, fast.state.agenda)
    const concurrent = structuredClone(current); concurrent.agenda.weekly[day].teams[0].memberIds = []
    assert.throws(() => preparePlanningClick(concurrent, ops, user), { code: 'RECORD_WRITE_CONFLICT' })
    assert.throws(() => preparePlanningClick(current, ops, { ...user, roleCode: 'technician' }), /Ruta de guardado|registro cambió/)
  }
})

test('mixed, structural and legacy-duration requests keep the general save pipeline', async () => {
  const { servicePreparationOperations, stateOperations, weeklyTeamMemberOperations } = await builders()
  const current = fixture()
  const ops = servicePreparationOperations(current, { base: current.history[0], ready: true })
  const other = structuredClone(current); other.history[0].detail = 'also editing'
  assert.equal(preparePlanningClick(current, stateOperations(current, other), admin), null)
  assert.equal(preparePlanningClick(current, [...ops, ...stateOperations(current, other)], admin), null)
  const legacy = structuredClone(current); delete legacy.history[0].estimatedMinutes
  assert.equal(preparePlanningClick(legacy, ops, admin), null)
  const empty = structuredClone(current); empty.agenda.weekly[day].teams = []
  const structural = weeklyTeamMemberOperations(empty, { day, teamId: 'team', teamIndex: 0, baseMemberIds: ['one'], baseMembers: ['one Técnico'], memberIds: [], members: [], materializeTeam: true, fallbackPlan: current.agenda.weekly[day] })
  assert.equal(preparePlanningClick(empty, structural, admin), null)
  const membership = weeklyTeamMemberOperations(current, { day, teamId: 'team', teamIndex: 0, baseMemberIds: ['one'], baseMembers: ['one Técnico'], memberIds: [], members: [] })
  for (const field of ['estimatedMinutes', 'status']) {
    const incomplete = structuredClone(current)
    delete incomplete.history[0][field]
    assert.equal(preparePlanningClick(incomplete, membership, admin), null)
  }
  const incompleteTask = structuredClone(current)
  delete incompleteTask.agenda.weekly[day].teams[0].tasks[0].estimatedMinutes
  assert.equal(preparePlanningClick(incompleteTask, membership, admin), null)
})

test('membership rejects technician overlap and nonexistent assignments exactly as ordinary validation', async () => {
  const { weeklyTeamMemberOperations } = await builders()
  const current = fixture()
  const second = { ...structuredClone(current.agenda.weekly[day].teams[0]), teamId: 'other', memberIds: ['two'], members: ['two Técnico'] }
  second.tasks = [{ ...second.tasks[0], taskId: 'other-task', historyId: 'other-work', technicianIds: ['two'], technicians: ['two Técnico'] }]
  current.agenda.weekly[day].teams.push(second); current.agenda.teams.push(structuredClone(second))
  current.history.push({ ...current.history[0], id: 'other-work', sourceTaskId: 'other-task', teamId: 'other', technicianIds: ['two'], technicians: ['two Técnico'] })
  for (const id of ['two', 'missing']) {
    const ops = weeklyTeamMemberOperations(current, { day, teamId: 'team', teamIndex: 0, baseMemberIds: ['one'], baseMembers: ['one Técnico'], memberIds: [id], members: [`${id} Técnico`] })
    assert.throws(() => general(current, ops), id === 'two' ? /incompatibles/ : /inexistente/)
    assert.throws(() => preparePlanningClick(current, ops, admin), id === 'two' ? /incompatibles/ : /inexistente/)
  }
})

test('membership preserves vehicle-control responsibility policy and monthly exceptions', async () => {
  const { weeklyTeamMemberOperations } = await builders()
  for (const status of ['Pendiente', 'Completado']) {
    const current = fixture()
    const service = current.services.find(item => item.code === 'vehicle-weekly-control')
    const record = { ...current.history[0], vehicleControl: true, vehicleId: 'v', vehicleControlScheduledFriday: day,
      serviceId: service.id, service: service.name, status, ...(status === 'Completado' ? { completedAt: '2026-01-05T12:00:00Z' } : {}) }
    current.vehicles = [{ id: 'v', brand: 'Ford', model: 'Ka', year: 2020, plate: 'AA000AA', mileage: 0 }]
    current.history = [record]
    for (const plan of [current.agenda, current.agenda.weekly[day]]) plan.teams[0].tasks = [{ ...record, taskId: 'task', historyId: 'work' }]
    current.agenda.weekly._monthlyTeams = { '2099-01': { vehicleAssignments: [{ vehicleId: 'v', technicianId: 'one' }], teams: [] } }
    const ops = weeklyTeamMemberOperations(current, { day, teamId: 'team', teamIndex: 0, baseMemberIds: ['one'], baseMembers: ['one Técnico'], memberIds: ['two'], members: ['two Técnico'] })
    const saved = structuredClone(current)
    const fast = preparePlanningClick(current, ops, admin)
    assert.deepEqual(fast.state, general(current, ops))
    assert.deepEqual(current, saved)
    assert.deepEqual(fast.state.history[0].technicianIds, status === 'Pendiente' ? ['two'] : ['one'])
    if (status === 'Pendiente') assert.deepEqual(fast.state.agenda.weekly._monthlyTeams['2099-01'].vehicleAssignments[0].weeklyOverrides, { [day]: 'two' })
  }
})

test('optional configuration keys added by authorization do not turn a persisted replay into a change', async () => {
  const { weeklyTeamMemberOperations } = await builders()
  const current = fixture()
  current.agenda.weekly._monthlyTeams = { '2099-01': { teams: [], defaultTimes: ['09:00'] } }
  const user = { id: 'planner', roleCode: 'user', permissions: { weekly: true, history: true, weeklyHours: true } }
  const operations = weeklyTeamMemberOperations(current, { day, teamId: 'team', teamIndex: 0, baseMemberIds: ['one'], baseMembers: ['one Técnico'], memberIds: ['two'], members: ['two Técnico'] })
  const first = preparePlanningClick(current, operations, user)
  const persisted = JSON.parse(JSON.stringify(first.state))
  const replay = preparePlanningClick(persisted, operations, user)
  assert.equal(replay.state.history, persisted.history)
  assert.equal(replay.state.agenda, persisted.agenda)
})

test('legacy cards linked to resolved history on another date keep complete schedule resolution', async () => {
  const { weeklyTeamMemberOperations } = await builders()
  for (const alias of ['historyId', 'sourceHistoryId', 'taskId', 'sourceTaskId']) {
    const current = fixture()
    const closed = { ...current.history[0], id: 'other-work', sourceTaskId: 'other-task', date: '2099-01-06', status: 'Completado', completedAt: '2026-10-20T12:00:00Z' }
    current.history.push(closed)
    const stale = { ...closed, date: day, status: 'Pendiente' }
    delete stale.completedAt; delete stale.sourceTaskId
    stale[alias] = alias.toLowerCase().includes('history') ? 'other-work' : 'other-task'
    for (const plan of [current.agenda, current.agenda.weekly[day]]) plan.teams[0].tasks.push(structuredClone(stale))
    const operations = weeklyTeamMemberOperations(current, { day, teamId: 'team', teamIndex: 0, baseMemberIds: ['one'], baseMembers: ['one Técnico'], memberIds: ['two'], members: ['two Técnico'] })
    assert.doesNotThrow(() => general(current, operations), `closed service resolves the ${alias} copy`)
    assert.equal(preparePlanningClick(current, operations, admin), null, `${alias} requires full history`)
  }
})
