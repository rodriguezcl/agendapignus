const test = require('node:test')
const assert = require('node:assert/strict')

const { startTechnicianServiceRecord, assertTechnicianServiceStarted } = require('../api/_lib/technician-service-start.cjs')

test('completar exige inicio registrado, salvo controles vehiculares', () => {
  assert.throws(() => assertTechnicianServiceStarted({}), { statusCode: 409 })
  assert.doesNotThrow(() => assertTechnicianServiceStarted({ startedAt: '2026-09-16T15:00:00Z' }))
  assert.doesNotThrow(() => assertTechnicianServiceStarted({ vehicleControl: true }))
})

const user = { id: 'tech-1', name: 'Pascual Gonzalez', roleCode: 'technician' }
const pending = {
  id: 'service-1',
  date: '2026-09-13',
  time: '09:00',
  status: 'Pendiente',
  technicianIds: ['tech-1']
}
const now = '2026-09-13T15:00:00.000Z' // 12:00 en Argentina

test('el técnico asignado puede iniciar un servicio disponible', () => {
  const result = startTechnicianServiceRecord(pending, user, now)
  assert.equal(result.startedAt, now)
  assert.equal(result.startedById, user.id)
  assert.equal(result.startedByName, user.name)
  assert.equal(pending.startedAt, undefined)
})

test('iniciar el mismo servicio es idempotente', () => {
  const started = { ...pending, startedAt: now, startedById: user.id }
  assert.equal(startTechnicianServiceRecord(started, user, '2026-09-13T16:00:00.000Z'), started)
})

test('impide iniciar servicios ajenos, resueltos o controles vehiculares', () => {
  assert.throws(() => startTechnicianServiceRecord(pending, { ...user, id: 'tech-2' }, now), error => error.statusCode === 403)
  assert.throws(() => startTechnicianServiceRecord({ ...pending, status: 'Completado' }, user, now), error => error.statusCode === 409)
  assert.throws(() => startTechnicianServiceRecord({ ...pending, vehicleControl: true }, user, now), error => error.statusCode === 400)
})

test('impide iniciar antes de la fecha u hora programadas', () => {
  assert.throws(() => startTechnicianServiceRecord({ ...pending, date: '2026-09-14' }, user, now), /fecha y hora programadas/)
  assert.throws(() => startTechnicianServiceRecord({ ...pending, time: '12:01' }, user, now), /fecha y hora programadas/)
  assert.doesNotThrow(() => startTechnicianServiceRecord({ ...pending, time: '12:00' }, user, now))
})
