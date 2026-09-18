const test = require('node:test')
const assert = require('node:assert/strict')
const { completeExpiredMonthlyMeetings } = require('../api/_lib/monthly-meeting-completion.cjs')
const fixture = () => {
  const record = { id: 'm', sourceTaskId: 't', service: 'Reunión Mensual', status: 'Pendiente', date: '2026-09-25', time: '15:00', technicianIds: ['a', 'b'] }
  const team = { tasks: [{ taskId: 't', historyId: 'm', status: 'Pendiente' }] }
  return { history: [record], agenda: { teams: [team], weekly: { '2026-09-25': { teams: [team] } } } }
}
test('Friday meeting closes at 20:00 Argentina, synchronizes agendas and is idempotent', () => {
  const state = fixture()
  assert.equal(completeExpiredMonthlyMeetings(state, '2026-09-25T22:59:59Z').changes.length, 0)
  const result = completeExpiredMonthlyMeetings(state, '2026-09-25T23:00:00Z')
  assert.equal(result.changes.length, 1)
  assert.equal(result.state.history[0].completedAt, '2026-09-25T23:00:00.000Z')
  assert.equal(result.state.history[0].status, 'Completado')
  assert.equal(result.state.agenda.teams[0].tasks[0].status, 'Completado')
  assert.equal(result.state.agenda.weekly['2026-09-25'].teams[0].tasks[0].status, 'Completado')
  assert.equal(completeExpiredMonthlyMeetings(result.state, '2026-09-28T15:00:00Z').changes.length, 0)
  assert.equal(state.history[0].status, 'Pendiente')
})
test('does not overwrite manual completion, review, cancelled, vehicle or ordinary services', () => {
  for (const patch of [{ status: 'Completado' }, { completedAt: '2026-09-25T19:00:00Z' }, { status: 'Cancelado' }, { technicalStatus: 'Reprogramación solicitada' }, { technicianRequest: 'Reprogramación solicitada' }, { status: 'Requiere revisión' }, { vehicleControl: true }, { service: 'Service de alarma' }]) {
    const state = fixture(); Object.assign(state.history[0], patch)
    assert.equal(completeExpiredMonthlyMeetings(state, '2026-09-28T15:00:00Z').changes.length, 0)
  }
})
test('other weekdays and Saturday use their own closing time and started meeting can close', () => {
  for (const [date, time] of [['2026-09-24', '20:00:00Z'], ['2026-09-26', '15:00:00Z']]) {
    const state = fixture(); Object.assign(state.history[0], { date, startedAt: `${date}T14:00:00Z` })
    const end = new Date(`${date}T${time}`)
    assert.equal(completeExpiredMonthlyMeetings(state, new Date(end.getTime() - 1)).changes.length, 0)
    assert.equal(completeExpiredMonthlyMeetings(state, end).changes.length, 1)
  }
})
