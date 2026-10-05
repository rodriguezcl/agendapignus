const test = require('node:test')
const assert = require('node:assert/strict')
const { startTechnicianServiceRecord, assertAdvanceNotPending } = require('../api/_lib/technician-service-start.cjs')
const user = { id: 1, name: 'Técnico' }
const record = { date: '2026-10-03', time: '12:00', status: 'Pendiente', technicianIds: [1], advanceRequest: { status: 'pending', scheduledTime: '12:00' } }
test('expired advance permits starting Saturday service on Monday without approving or rescheduling', async () => {
  const { serviceHasStarted } = await import('../src/domain/agenda/service-start.mjs')
  for (const now of ['2026-10-03T15:00:00Z', '2026-10-05T12:00:00Z']) {
    assert.equal(serviceHasStarted(record, now), true)
    assert.doesNotThrow(() => assertAdvanceNotPending(record, now))
    const started = startTechnicianServiceRecord(record, user, now)
    assert.equal(started.startedAt, now)
    assert.equal(started.date, record.date)
    assert.equal(started.time, record.time)
    assert.deepEqual(started.advanceRequest, record.advanceRequest)
  }
})
test('live requests remain blocked and assigned technician is still required', async () => {
  const { serviceHasStarted } = await import('../src/domain/agenda/service-start.mjs')
  const now = '2026-10-03T14:59:59Z'
  assert.equal(serviceHasStarted(record, now), false)
  assert.throws(() => startTechnicianServiceRecord(record, user, now), /pendiente de aprobación/)
  assert.throws(() => assertAdvanceNotPending(record, now), /pendiente de aprobación/)
  assert.throws(() => startTechnicianServiceRecord(record, { id: 2 }, '2026-10-05T12:00:00Z'), /no está asignado/)
})
