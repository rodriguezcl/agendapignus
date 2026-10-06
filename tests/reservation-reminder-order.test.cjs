const test = require('node:test')
const assert = require('node:assert/strict')

test('reservas por fecha y hora ascendente, con pendientes anteriores primero', async () => {
  const { compareReservationReminders } = await import('../src/domain/agenda/reservation-reminder-order.mjs')
  const records = [
    { id: 'cristina', date: '2026-10-07', time: '14:00' },
    { id: 'santiago', date: '2026-10-07', time: '08:30' },
    { id: 'eugenia', date: '2026-10-07', time: '14:00' },
    { id: 'marisa', date: '2026-10-06', time: '14:00' },
    { id: 'anterior', date: '2026-09-30', time: '15:00' },
    { id: 'sin-hora', date: '2026-10-07' },
    { id: 'alternativa', date: '2026-10-07', scheduledTime: '9:00' }
  ]
  const snapshot = structuredClone(records)
  assert.deepEqual([...records].sort(compareReservationReminders).map(r => r.id), ['anterior', 'marisa', 'santiago', 'alternativa', 'cristina', 'eugenia', 'sin-hora'])
  assert.deepEqual(records, snapshot)
})
