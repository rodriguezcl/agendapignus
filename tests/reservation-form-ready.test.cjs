const test = require('node:test')
const assert = require('node:assert/strict')
test('only PIG reservations with complete form and nonempty email are ready', async () => {
  const { reservationFormReady: ready } = await import('../src/domain/agenda/reservation-form-ready.mjs')
  const record = { subscriberReservation: true, form: 'Completo', formEmail: 'cliente@example.com' }
  assert.equal(ready(record), true)
  for (const patch of [{ subscriberReservation: false }, { form: '' }, { form: 'Incompleto (Abonado completa a mano)' }, { formEmail: '' }, { formEmail: '  ' }, { formEmail: undefined }]) assert.equal(ready({ ...record, ...patch }), false)
  assert.equal(ready(undefined), false)
})

test('dashboard shows a future reservation as soon as its saved form and email are ready', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { SubscriberReservationReminders } = require('./helpers/load-app.cjs')(['SubscriberReservationReminders'])
  const record = { id: 'reservation', subscriberReservation: true, date: '2099-10-14', time: '08:30', client: 'Reserva futura', status: 'Pendiente', form: 'Completo', formEmail: 'cliente@example.com' }
  const render = patch => renderToStaticMarkup(React.createElement(SubscriberReservationReminders, { history: [{ ...record, ...patch }] }))
  assert.match(render({}), /Formulario completo disponible para crear el abonado en SoftGuard/)
  assert.match(render({}), /cliente@example.com/)
  for (const patch of [{ form: '' }, { formEmail: '' }, { subscriberReservation: false }, { status: 'Cancelado' }, { status: 'Completado' }]) assert.equal(render(patch), '')
  assert.match(render({ date: '2020-01-01', form: '', formEmail: '' }), /Reserva pendiente de vincular con un PIG/)
})
