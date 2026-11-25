const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { authorizeIncomingState, visibleStateForUser } = require('../api/_lib/core.cjs')
const { validateServiceJourneys } = require('../api/_lib/service-journeys.cjs')

const actor = (permissions = []) => ({ id: 'planner', roleCode: 'custom', permissions: {
  __catalogV2: true,
  ...Object.fromEntries(['weekly.view', 'agenda.view', 'records.read', 'planning.remove', ...permissions].map(key => [key, true]))
} })

function fixture() {
  const history = [1, 2, 3, 4].map(index => ({
    id: index === 1 ? 'journey' : `visit-${index}`, sourceTaskId: `task-${index}`,
    customerId: 'customer', client: 'Cliente', serviceId: 'alarm', service: 'Alarma',
    date: `2099-01-0${index + 4}`, time: '09:00', estimatedMinutes: 60,
    teamId: 'team', team: 'Equipo 1', technicianIds: ['tech'], technicians: ['Técnico'],
    status: 'Pendiente', serviceJourney: { id: 'journey', index, total: 4 }
  }))
  const teams = record => [{ teamId: 'team', label: 'Equipo 1', memberIds: ['tech'], members: ['Técnico'], tasks: [{ ...record, taskId: record.sourceTaskId, historyId: record.id }] }]
  return {
    roles: [], employees: [], services: [], vehicles: [], customers: [{ customerId: 'customer', account: 'CLI-1', name: 'Cliente' }], reviews: [], preferences: {}, history,
    agenda: { date: history[1].date, teams: teams(history[1]), weekly: Object.fromEntries(history.map(record => [record.date, { teams: teams(record) }])) }
  }
}

async function removed(state, user = actor()) {
  const { weeklyTaskRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const visible = visibleStateForUser(state, user)
  return applyStateOperations(visible, weeklyTaskRemovalOperations(visible, {
    day: state.history[1].date, teamId: 'team', taskId: 'task-2', historyId: 'visit-2', taskIndex: 0
  }))
}

test('planning.remove retira una jornada pendiente conservando todo el grupo y los informes previos', async () => {
  const state = fixture()
  Object.assign(state.history[0], { status: 'Avance registrado', technicalStatus: 'Avance registrado', technicalObservation: 'Cableado realizado', technicalReportedAt: '2099-01-05T12:00:00Z' })
  const next = authorizeIncomingState(await removed(state), state, actor())
  assert.equal(next.history.length, 4)
  assert.equal(next.history[1].status, 'Cancelado')
  assert.deepEqual(next.history[0], state.history[0])
  assert.deepEqual(next.history.map(record => record.serviceJourney), state.history.map(record => record.serviceJourney))
  assert.equal(next.agenda.teams[0].tasks.length, 0)
  assert.equal(next.agenda.weekly[state.history[1].date].teams[0].tasks.length, 0)
  assert.doesNotThrow(() => validateServiceJourneys(next, state))
})

test('planning.remove no autoriza cancelar sin retirar las tarjetas y registrar la baja', async () => {
  const state = fixture(), user = actor()
  const cardRetained = await removed(state, user)
  cardRetained.agenda.teams = structuredClone(state.agenda.teams)
  assert.throws(() => authorizeIncomingState(cardRetained, state, user), /permiso/)
  const noMarker = await removed(state, user)
  delete noMarker.agenda.weekly[state.history[1].date].removedTaskIds
  assert.throws(() => authorizeIncomingState(noMarker, state, user), /permiso/)
})

test('planning.remove no autoriza cancelar una jornada iniciada o con informe', async () => {
  for (const work of [{ startedAt: '2099-01-06T12:00:00Z' }, { technicalStatus: 'Avance registrado' }, { technicalObservation: 'Informe técnico legado' }, { technicalReportedAt: '2099-01-06T12:30:00Z' }, { completedAt: '2099-01-06T12:30:00Z' }]) {
    const state = fixture(), proposed = await removed(state)
    Object.assign(state.history[1], work)
    Object.assign(proposed.history.find(record => record.id === 'visit-2'), work)
    assert.throws(() => authorizeIncomingState(proposed, state, actor()), /permiso/)
  }
})

test('la excepción de baja no permite modificar identidad, observaciones ni campos ajenos', async () => {
  for (const patch of [{ detail: 'Reemplazo del informe' }, { customerId: 'other' }, { estimatedMinutes: 120 }, { serviceJourney: { id: 'journey', index: 2, total: 3 } }]) {
    const state = fixture(), proposed = await removed(state)
    Object.assign(proposed.history.find(record => record.id === 'visit-2'), patch)
    assert.throws(() => authorizeIncomingState(proposed, state, actor()), /permiso/)
  }
  const state = fixture(), proposed = await removed(state)
  const denied = actor(); denied.permissions['planning.remove'] = false
  assert.throws(() => authorizeIncomingState(proposed, state, denied), /planning.remove/)
})
