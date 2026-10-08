const test = require('node:test')
const assert = require('node:assert/strict')
const { startServiceEarly, synchronizeAgendaAdvance } = require('../api/_lib/service-advance.cjs')
const user = { id: 'tech', name: 'Técnico' }
const record = { id: 'h', date: '2026-10-08', time: '14:00', service: 'Service de alarma', technicianIds: ['tech'], status: 'Pendiente' }
const now = '2026-10-08T14:57:23.000Z'
test('adelanta e inicia sin administrador, conserva original y sincroniza ambas agendas', () => {
  for (const status of [undefined, 'pending', 'denied']) {
    const next = startServiceEarly({ ...record, advanceRequest: status ? { status } : undefined }, user, now)
    assert.equal(next.startedAt, now)
    assert.equal(next.startedById, user.id)
    assert.equal(next.time, '11:57')
    assert.equal(next.originalScheduledTime, '14:00')
    assert.equal(next.advanceRequest.status, 'approved')
    assert.equal(next.advanceRequest.automatic, true)
    assert.equal(startServiceEarly(next, user, '2026-10-08T15:00:00Z'), next)
    const teams = [{ tasks: [{ historyId: 'h' }] }]
    const agenda = synchronizeAgendaAdvance({ teams, weekly: { [record.date]: { teams } } }, next)
    assert.equal(agenda.teams[0].tasks[0].startedAt, now)
    assert.equal(agenda.weekly[record.date].teams[0].tasks[0].startedById, user.id)
  }
})
test('mantiene asignación, confirmación, fecha y reglas vehiculares', () => {
  for (const patch of [{ technicianIds: ['other'] }, { awaitingConfirmation: true }, { vehicleControl: true }, { date: '2026-10-09' }, { status: 'Completado' }]) {
    assert.throws(() => startServiceEarly({ ...record, ...patch }, user, now))
  }
})
