const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
const css = fs.readFileSync(path.join(__dirname, '../src/ui-polish.css'), 'utf8')

test('la etiqueta de reserva sólo se muestra en el estado semanal', () => {
  assert.match(app, /weekly && task\?\.subscriberReservation && <em className="role-chip subscriber-reservation-chip"/)
})

test('la agenda diaria conserva la explicación de reserva junto al abonado', () => {
  const dailyCustomer = app.slice(app.indexOf('function DailyCustomerField('), app.indexOf('function BufferedTextarea('))
  assert.match(dailyCustomer, /subscriberReservation=\{task.subscriberReservation\}/)
  assert.match(app, /subscriberReservation && <small className="subscriber-reservation-note">Reserva PIG pendiente:/)
  assert.match(css, /\.daily-field-customer > \.subscriber-reservation-note\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/)
  assert.match(css, /\.daily-agenda-task-status\s*\{[^}]*max-width: 100%;[^}]*flex-wrap: wrap;/)
})
