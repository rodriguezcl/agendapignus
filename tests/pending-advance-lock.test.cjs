const test = require('node:test')
const assert = require('node:assert/strict')
const { assertAdvanceNotPending, startTechnicianServiceRecord } = require('../api/_lib/technician-service-start.cjs')

test('pending advance blocks all reports and starting even after scheduled time', async () => {
  const { serviceHasStarted } = await import('../src/domain/agenda/service-start.mjs')
  const record = { date: '2026-09-25', time: '14:00', technicianIds: ['tech'], advanceRequest: { status: 'pending' } }
  const now = '2026-09-25T18:00:00.000Z'
  assert.throws(() => assertAdvanceNotPending(record), { statusCode: 409 })
  assert.throws(() => startTechnicianServiceRecord(record, { id: 'tech' }, now), { statusCode: 409 })
  assert.equal(serviceHasStarted(record, now), false)
  const approved = { ...record, advanceRequest: { status: 'approved' } }
  assert.doesNotThrow(() => assertAdvanceNotPending(approved))
  assert.equal(serviceHasStarted(approved, now), true)
  assert.equal(startTechnicianServiceRecord(approved, { id: 'tech' }, now).startedAt, now)
})
