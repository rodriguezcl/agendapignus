const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const day = '2096-09-11'
const sourceDay = '2096-09-10'
const fixture = () => {
  const record = { id: 'h1', sourceTaskId: 't1', date: sourceDay, time: '08:45', teamId: 'a', team: 'Equipo 1', serviceId: 's', service: 'Service', estimatedMinutes: 90, status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada', technicianRequest: 'Reprogramación solicitada', technicalObservation: 'Cambiar central', startedAt: '2096-09-10T12:00:00Z', formEmail: 'cliente@example.com' }
  const team = { teamId: 'b', label: 'Equipo 2', memberIds: ['tech2'], members: ['Técnico 2'], tasks: [] }
  const source = { teamId: 'a', label: 'Equipo 1', memberIds: ['tech1'], members: ['Técnico 1'], tasks: [{ ...record, taskId: 't1', historyId: 'h1' }] }
  return { history: [record], services: [], agenda: { date: day, teams: [structuredClone(team)], weekly: { [sourceDay]: { teams: [source] }, [day]: { teams: [team] } } } }
}
const command = state => ({ base: state.history[0], day, time: '14:00', team: state.agenda.weekly[day].teams[0], today: sourceDay })

test('confirmed reschedule moves both agendas, resets technician workflow and removes reminder', async () => {
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  const { dashboardPendingGroups } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  const state = fixture()
  const operations = historyRescheduleOperations(state, command(state))
  const next = applyStateOperations(state, operations)
  const record = next.history[0]
  assert.equal(record.date, day)
  assert.equal(record.time, '14:00')
  assert.equal(record.teamId, 'b')
  assert.deepEqual(record.technicianIds, ['tech2'])
  assert.equal(record.status, 'Pendiente')
  assert.equal(record.startedAt, '')
  assert.equal(record.technicalStatus, '')
  assert.equal(record.technicianRequest, '')
  assert.equal(record.reschedulingHistory[0].technicalObservation, 'Cambiar central')
  assert.equal(record.formEmail, 'cliente@example.com')
  assert.equal(next.agenda.weekly[sourceDay].teams[0].tasks.length, 0)
  assert.equal(next.agenda.weekly[day].teams[0].tasks[0].time, '14:00')
  assert.equal(next.agenda.teams[0].tasks[0].historyId, 'h1')
  assert.equal(dashboardPendingGroups(next.history, sourceDay).rescheduling.length, 0)
  assert.equal(dashboardPendingGroups([...next.history, { ...state.history[0], id: 'h2' }], sourceDay).rescheduling.length, 1)
  assert.doesNotThrow(() => validateChangedAgendaSchedules(next, state))
  assert.equal(state.history[0].status, 'Requiere revisión')
})

test('rejects stale record, invalid date, time or missing team', async () => {
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  const state = fixture(), input = command(state)
  for (const patch of [{ day: '2000-01-01' }, { time: '25:00' }, { team: null }, { base: { ...input.base, detail: 'stale' } }]) {
    assert.throws(() => historyRescheduleOperations(state, { ...input, ...patch }))
  }
})

test('destination overlap is rejected by the same server validation as agenda saves', async () => {
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  const state = fixture()
  state.agenda.weekly[day].teams[0].tasks.push({ taskId: 'other', serviceId: 's', service: 'Otro', time: '14:00', estimatedMinutes: 90 })
  const next = applyStateOperations(state, historyRescheduleOperations(state, command(state)))
  assert.throws(() => validateChangedAgendaSchedules(next, state), /conflicto de horarios/)
})

test('same-day reassignment and history-only records do not duplicate the service', async () => {
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  const state = fixture()
  state.history[0].technicalStatus = ''
  state.history[0].technicianRequest = ''
  state.agenda.weekly[sourceDay].teams.push({ ...state.agenda.weekly[day].teams[0] })
  const next = applyStateOperations(state, historyRescheduleOperations(state, { ...command(state), day: sourceDay }))
  assert.equal(next.agenda.weekly[sourceDay].teams[0].tasks.length, 0)
  assert.equal(next.agenda.weekly[sourceDay].teams[1].tasks.length, 1)
  assert.equal(next.history.length, 1)
  delete state.agenda.weekly[sourceDay]
  const restored = applyStateOperations(state, historyRescheduleOperations(state, command(state)))
  assert.equal(restored.agenda.weekly[day].teams[0].tasks[0].historyId, 'h1')
  assert.equal(restored.history.length, 1)
})
