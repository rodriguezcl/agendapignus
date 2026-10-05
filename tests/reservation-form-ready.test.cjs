const test = require('node:test')
const assert = require('node:assert/strict')
test('only PIG reservations with complete form and nonempty email are ready', async () => {
  const { reservationFormReady: ready } = await import('../src/domain/agenda/reservation-form-ready.mjs')
  const record = { subscriberReservation: true, form: 'Completo', formEmail: 'cliente@example.com' }
  assert.equal(ready(record), true)
  for (const patch of [{ subscriberReservation: false }, { form: '' }, { form: 'Incompleto (Abonado completa a mano)' }, { formEmail: '' }, { formEmail: '  ' }, { formEmail: undefined }]) assert.equal(ready({ ...record, ...patch }), false)
  assert.equal(ready(undefined), false)
})
