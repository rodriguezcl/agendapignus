const test = require('node:test')
const assert = require('node:assert/strict')

test('localiza la tarjeta por identidad aunque cambie su equipo o posición', async () => {
  const { reservationTarget } = await import('../src/domain/agenda/reservation-target.mjs')
  const plan = { teams: [{ tasks: [{ historyId: 'other', client: 'Mismo nombre' }] }, { tasks: [{}, { historyId: '42', client: 'Mismo nombre' }] }] }
  assert.deepEqual(reservationTarget({ id: 42 }, plan), { teamIndex: 1, taskIndex: 1 })
  assert.equal(reservationTarget({ id: 'deleted', client: 'Mismo nombre' }, plan), null)
})

test('admite taskId sin historyId, sin abrir otra ocurrencia ni identidades vacías', async () => {
  const { reservationTarget } = await import('../src/domain/agenda/reservation-target.mjs')
  const plan = { teams: [{ tasks: [{ historyId: 'other', taskId: 'task' }, { taskId: 'task' }, {}] }] }
  assert.deepEqual(reservationTarget({ id: 'record', taskId: 'task' }, plan), { teamIndex: 0, taskIndex: 1 })
  assert.equal(reservationTarget({}, plan), null)
  assert.equal(reservationTarget({ id: 42 }, { teams: [] }), null)
})
