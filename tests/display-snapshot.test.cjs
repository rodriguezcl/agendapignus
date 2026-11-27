const test = require('node:test')
const assert = require('node:assert/strict')
const { migrateLegacyEstimatedMinutes } = require('../api/_lib/legacy-estimated-minutes.cjs')

test('la confirmación de un cambio de equipo conserva copias aisladas de los días y registros previos', async () => {
  const { createServerSnapshotCopier } = await import('../src/features/state/application/display-snapshot.mjs')
  const { applyStateDelta } = await import('../src/domain/shared/state-delta.mjs')
  const copy = createServerSnapshotCopier()
  const day = '2026-11-27', nextDay = '2026-11-28'
  const task = { service: 'Service', estimatedMinutes: 30 }
  const team = { teamId: 'a', memberIds: ['t1'], tasks: [task] }
  const data = { revision: 1, customers: [{ name: 'Cliente' }], history: [{ id: 'h', ...task }],
    agenda: { date: day, teams: [team], weekly: { [day]: { teams: [team] }, [nextDay]: { teams: [team] } } } }
  const migrate = state => migrateLegacyEstimatedMinutes(state, { repairUnidentifiedAgenda: true }).state
  const before = copy(migrate(data))
  const newTeam = { ...team, memberIds: ['t2'] }
  const received = applyStateDelta(data, { baseRevision: 1, revision: 2, changes: {
    agenda: { weekly: { [day]: { value: { teams: [newTeam] } } } },
    history: { id: 'id', upsert: [{ id: 'new', service: 'Service' }], removed: [] }
  } })
  const display = migrate(received)
  const after = copy(display)
  assert.deepEqual(after, structuredClone(display))
  assert.equal(after.history[1].estimatedMinutes, 15)
  assert.equal(after.agenda.weekly[nextDay], before.agenda.weekly[nextDay])
  assert.equal(after.history[0], before.history[0])
  assert.equal(after.customers, before.customers)
  assert.notEqual(after.agenda.weekly[day], before.agenda.weekly[day])
  display.agenda.weekly[day].teams[0].memberIds.push('draft')
  display.history[0].service = 'Edición local'
  assert.deepEqual(before.agenda.weekly[day].teams[0].memberIds, ['t1'])
  assert.deepEqual(after.agenda.weekly[day].teams[0].memberIds, ['t2'])
  assert.equal(after.history[0].service, 'Service')
})

test('solo se reutiliza la versión serializada si coincide cada sección visible', async () => {
  const { sameDisplaySections, sameCatalogs } = await import('../src/features/state/application/display-snapshot.mjs')
  const state = { customers: [], roles: [], services: [], employees: [], history: [], vehicles: [], agenda: { date: '2026-11-27', teams: [], weekly: {} } }
  assert.equal(sameDisplaySections(null, state), false)
  assert.equal(sameDisplaySections(state, { ...state, agenda: { ...state.agenda } }), true)
  for (const key of ['customers', 'roles', 'services', 'employees', 'history', 'vehicles']) {
    const next = { ...state, [key]: [] }
    assert.equal(sameDisplaySections(state, next), false)
    assert.equal(sameCatalogs(state, next), ['history', 'vehicles'].includes(key))
  }
  for (const key of ['date', 'teams', 'weekly']) {
    assert.equal(sameDisplaySections(state, { ...state, agenda: { ...state.agenda, [key]: null } }), false)
  }
})

test('los planes antiguos sin listas se completan y una jornada válida conserva su identidad', () => {
  const valid = { teams: [{ tasks: [] }] }
  const old = { agenda: { teams: [{ members: [] }], weekly: { '2026-11-27': valid, '2026-11-28': {} } } }
  const migrated = migrateLegacyEstimatedMinutes(old).state
  assert.deepEqual(migrated.history, [])
  assert.deepEqual(migrated.agenda.teams, [{ members: [], tasks: [] }])
  assert.deepEqual(migrated.agenda.weekly['2026-11-28'], { teams: [] })
  assert.equal(migrated.agenda.weekly['2026-11-27'], valid)
  assert.deepEqual(old.agenda.weekly['2026-11-28'], {})
})
