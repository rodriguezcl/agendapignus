const test = require('node:test')
const assert = require('node:assert/strict')
const { synchronizeTeamServiceAssignments: sync } = require('../api/_lib/team-service-assignments.cjs')

test('missing previous agenda or dates do not trigger daily synchronization', () => {
  const state = { agenda: { teams: [{ teamId: 'one', memberIds: ['new'] }] }, history: [{ teamId: 'one', technicianIds: ['old'], status: 'Pendiente' }] }
  for (const previous of [undefined, null, {}, { reviews: [] }, { agenda: {} }, { agenda: { teams: [{ teamId: 'one', memberIds: ['old'] }] } }]) {
    assert.equal(sync(state, previous), state)
    assert.equal(sync({ history: [] }, previous).history.length, 0)
  }
  assert.deepEqual(state.history[0].technicianIds, ['old'])
})

test('different daily dates do not reassign historical services', () => {
  const previous = { agenda: { date: '2026-10-06', teams: [{ teamId: 'one', memberIds: ['old'] }] } }
  const state = { agenda: { date: '2026-10-07', teams: [{ teamId: 'one', memberIds: ['new'] }] }, history: [{ date: '2026-10-06', teamId: 'one', technicianIds: ['old'], status: 'Pendiente' }] }
  assert.equal(sync(state, previous), state)
})

for (const daily of [false, true]) test(`crew split updates pending history through ${daily ? 'daily' : 'weekly'} agenda`, () => {
  const day = '2026-09-28'
  const team = { teamId: 'one', memberIds: ['p', 'l'], members: ['Pascual', 'Leonardo'] }
  const record = { date: day, teamId: 'one', technicianIds: ['p', 'l'], technicians: ['Pascual', 'Leonardo'], status: 'Pendiente' }
  const previous = { agenda: { date: day, teams: [team], weekly: { [day]: { teams: [team] } } }, history: [
    { ...record, id: 'pending' }, { ...record, id: 'done', status: 'Completado' },
    { ...record, id: 'started', startedAt: '2026-09-28T12:00:00Z' },
    { ...record, id: 'vehicle', vehicleControl: true },
    { ...record, id: 'other', teamId: 'two' }
  ] }
  const next = structuredClone(previous)
  const selected = daily ? next.agenda.teams[0] : next.agenda.weekly[day].teams[0]
  selected.memberIds = ['p']; selected.members = ['Pascual']
  const result = sync(next, previous)
  assert.deepEqual(result.history[0].technicianIds, ['p'])
  assert.deepEqual(result.history[0].technicians, ['Pascual'])
  assert.deepEqual(result.history.slice(1), previous.history.slice(1))
  assert.deepEqual(previous.history[0].technicianIds, ['p', 'l'])
  assert.equal(sync(previous, previous), previous)
})
