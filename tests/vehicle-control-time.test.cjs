const test = require('node:test')
const assert = require('node:assert/strict')

test('15:45 default and early release agree in browser and server', async () => {
  const browser = await import('../src/domain/vehicles/vehicle-control-window.mjs')
  const server = require('../api/_lib/vehicle-control-window.cjs')
  const { VEHICLE_CONTROL_TIME } = await import('../src/domain/vehicles/vehicle-controls.mjs')
  assert.equal(VEHICLE_CONTROL_TIME, '15:45')
  const control = { date: '2026-09-25', vehicleControl: true }
  const pending = { date: control.date, status: 'Pendiente' }
  for (const api of [browser, server]) {
    assert.equal(api.vehicleControlScheduledAt(control).toISOString(), '2026-09-25T18:45:00.000Z')
    assert.equal(api.vehicleControlIsOpen(control, '2026-09-25T18:44:59Z', [pending]), false)
    assert.equal(api.vehicleControlIsOpen(control, '2026-09-25T18:45:00Z', [pending]), true)
    assert.equal(api.vehicleControlIsOpen(control, '2026-09-25T17:00:00Z', [{ ...pending, status: 'Completado' }]), true)
    assert.equal(api.vehicleControlIsOpen(control, '2026-09-24T17:00:00Z', []), false)
    assert.equal(api.vehicleControlScheduledAt({ ...control, time: '15:30' }).toISOString(), '2026-09-25T18:30:00.000Z')
  }
})
