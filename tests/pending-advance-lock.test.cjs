const test = require('node:test')
const assert = require('node:assert/strict')
const { assertAdvanceNotPending, startTechnicianServiceRecord } = require('../api/_lib/technician-service-start.cjs')

test('pending advance blocks before scheduled time and expires at the scheduled hour', async () => {
  const { serviceHasStarted } = await import('../src/domain/agenda/service-start.mjs')
  const record = { date: '2026-09-25', time: '14:00', technicianIds: ['tech'], advanceRequest: { status: 'pending' } }
  const now = '2026-09-25T16:00:00.000Z'
  assert.throws(() => assertAdvanceNotPending(record, now), { statusCode: 409 })
  assert.throws(() => startTechnicianServiceRecord(record, { id: 'tech' }, now), { statusCode: 409 })
  assert.equal(serviceHasStarted(record, now), false)
  const approved = { ...record, advanceRequest: { status: 'approved' } }
  assert.doesNotThrow(() => assertAdvanceNotPending(approved))
  assert.equal(serviceHasStarted(approved, now), false)
  const scheduled = '2026-09-25T17:00:00.000Z'
  assert.doesNotThrow(() => assertAdvanceNotPending(record, scheduled))
  assert.equal(serviceHasStarted(record, scheduled), true)
  assert.equal(startTechnicianServiceRecord(record, { id: 'tech' }, scheduled).startedAt, scheduled)
})
