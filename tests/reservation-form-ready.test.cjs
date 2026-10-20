const test = require('node:test')
const assert = require('node:assert/strict')
test('only PIG reservations with complete form and nonempty email are ready', async () => {
  const { reservationFormReady: ready } = await import('../src/domain/agenda/reservation-form-ready.mjs')
  const record = { subscriberReservation: true, form: 'Completo', formEmail: 'cliente@example.com' }
  assert.equal(ready(record), true)
  for (const patch of [{ subscriberReservation: false }, { form: '' }, { form: 'Incompleto (Abonado completa a mano)' }, { formEmail: '' }, { formEmail: '  ' }, { formEmail: undefined }]) assert.equal(ready({ ...record, ...patch }), false)
  assert.equal(ready(undefined), false)
})

test('dashboard notifies a future reservation as soon as its saved form and email are ready', async () => {
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const record = { id: 'reservation', subscriberReservation: true, date: '2099-10-14', time: '08:30', client: 'Reserva futura', status: 'Pendiente', form: 'Completo', formEmail: 'cliente@example.com' }
  const notification = patch => selectDashboardNotifications({
    history: [{ ...record, ...patch }], today: '2026-10-20', isAdministrator: true
  }).find(notice => notice.id === 'reservation:reservation')
  assert.match(notification({}).detail, /Formulario completo disponible para crear el abonado en SoftGuard/)
  assert.match(notification({}).detail, /cliente@example.com/)
  for (const patch of [{ form: '' }, { formEmail: '' }, { subscriberReservation: false }, { status: 'Cancelado' }, { status: 'Completado' }]) assert.equal(notification(patch), undefined)
  assert.match(notification({ date: '2020-01-01', form: '', formEmail: '' }).title, /Reserva pendiente de vincular con un PIG/)
  assert.deepEqual(notification({}).target, { type: 'reservation', recordId: 'reservation' })
})
