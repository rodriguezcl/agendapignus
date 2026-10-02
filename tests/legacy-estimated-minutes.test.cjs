const test = require('node:test')
const assert = require('node:assert/strict')
const { migrateLegacyEstimatedMinutes } = require('../api/_lib/legacy-estimated-minutes.cjs')

test('an undated legacy agenda cannot reset a dated customized service during hydration', async () => {
  const { stateForOperationComparison } = require('../api/_lib/legacy-estimated-minutes.cjs')
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  for (const estimatedMinutes of [300, 315]) {
    const task = { taskId: 't', historyId: 'h', client: 'ANTIGUA ESTANCIA', serviceId: 5, time: '08:30', estimatedMinutes, estimatedMinutesCustomized: true }
    const state = { history: [{ ...task, id: 'h', sourceTaskId: 't', date: '2026-10-05' }], agenda: { date: '2026-10-02', teams: [], weekly: {
      '': { teams: [{ tasks: [{ ...task, estimatedMinutes: 15 }] }] },
      '2026-10-05': { teams: [{ tasks: [task, { time: '14:00' }] }] }
    } } }
    const loaded = migrateLegacyEstimatedMinutes(state, { repairUnidentifiedAgenda: true }).state
    assert.equal(loaded.history[0].estimatedMinutes, estimatedMinutes)
    assert.equal(stateForOperationComparison(state).history[0].estimatedMinutes, estimatedMinutes)
    const merged = { ...loaded.agenda.weekly['2026-10-05'].teams[0].tasks[0], ...loaded.history[0] }
    assert.deepEqual(serviceGaps([merged, { time: '14:00' }], { min: '08:00', max: '17:00', day: '2026-10-05', now: new Date('2026-10-02T15:00:00Z') }), [])
    assert.equal(state.history[0].estimatedMinutes, estimatedMinutes)
  }
})

test('migra a 15 minutos únicamente servicios persistidos sin duración', () => {
  const missingHistory = { id: 'history-missing', serviceId: 'service-1', service: 'Service de alarma' }
  const invalidHistory = { id: 'history-invalid', serviceId: 'service-1', service: 'Service de alarma', estimatedMinutes: 0 }
  const definedHistory = { id: 'history-defined', serviceId: 'service-1', service: 'Service de alarma', estimatedMinutes: 45 }
  const missingAgenda = { taskId: 'task-missing', service: 'Instalación de alarma' }
  const identifiedLegacyAgenda = { taskId: 'task-defined', historyId: 'history-linked', service: 'Service de alarma', time: '11:30', estimatedMinutes: 60 }
  const linkedHistory = { id: 'history-linked', service: 'Service de alarma', time: '11:30', estimatedMinutes: 60 }
  const emptySlot = { taskId: 'empty-slot', time: '14:00' }
  const migration = migrateLegacyEstimatedMinutes({
    history: [missingHistory, invalidHistory, definedHistory, linkedHistory],
    agenda: {
      date: '', teams: [{ tasks: [missingAgenda, identifiedLegacyAgenda, emptySlot] }],
      weekly: {
        '2026-08-14': { teams: [{ tasks: [{ taskId: 'weekly-missing', serviceId: 'service-1' }] }] },
        '': { teams: [{ tasks: [{ taskId: 'weekly-unidentified', serviceId: 'service-1', estimatedMinutes: 60 }] }] },
        _monthlyTeams: {}
      }
    }
  }, { repairUnidentifiedAgenda: true })

  assert.equal(migration.totalChanged, 6)
  assert.equal(migration.historyChanged, 2)
  assert.equal(migration.agendaChanged, 4)
  assert.deepEqual(
    [migration.state.history[0].estimatedMinutes, migration.state.agenda.teams[0].tasks[0].estimatedMinutes, migration.state.agenda.weekly['2026-08-14'].teams[0].tasks[0].estimatedMinutes],
    [15, 15, 15]
  )
  assert.equal(migration.state.history[0].estimatedMinutesCustomized, true)
  assert.equal(migration.state.history[1].estimatedMinutes, 0)
  assert.equal(migration.state.history[2].estimatedMinutes, 45)
  assert.equal(migration.state.history[3].estimatedMinutes, 15)
  assert.equal(migration.state.agenda.teams[0].tasks[1].estimatedMinutes, 15)
  assert.equal(migration.state.agenda.weekly[''].teams[0].tasks[0].estimatedMinutes, 15)
  assert.equal('estimatedMinutes' in migration.state.agenda.teams[0].tasks[2], false)
})

test('la migración es idempotente', () => {
  const first = migrateLegacyEstimatedMinutes({ history: [{ id: 'h1', service: 'Servicio', estimatedMinutes: '' }], agenda: {} })
  const second = migrateLegacyEstimatedMinutes(first.state)
  assert.equal(first.totalChanged, 1)
  assert.equal(second.totalChanged, 0)
  assert.deepEqual(second.state, first.state)
})

test('una fecha protegida conserva íntegros sus servicios de agenda e historial', () => {
  const protectedRecord = { id: 'tomorrow-history', date: '2026-09-08', service: 'Instalación', estimatedMinutes: null }
  const protectedPlan = { teams: [{ tasks: [{ taskId: 'tomorrow-task', service: 'Instalación', estimatedMinutes: null }] }] }
  const state = { history: [protectedRecord], agenda: { date: '2026-09-08', teams: protectedPlan.teams, weekly: { '2026-09-08': protectedPlan } } }
  const migration = migrateLegacyEstimatedMinutes(state, { repairUnidentifiedAgenda: true, protectedDates: ['2026-09-08'] })
  assert.equal(migration.totalChanged, 0)
  assert.deepEqual(migration.state.history, state.history)
  assert.deepEqual(migration.state.agenda, state.agenda)
})
