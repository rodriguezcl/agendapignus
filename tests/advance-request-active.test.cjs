const test = require('node:test')
const assert = require('node:assert/strict')
test('advance reminder expires at original time in Argentina', async () => {
  const { isAdvanceRequestActive: active } = await import('../src/domain/agenda/advance-request-active.mjs')
  const record = { date: '2026-10-03', time: '12:00', status: 'Pendiente', advanceRequest: { status: 'pending', scheduledTime: '12:00' } }
  assert.equal(active(record, '2026-10-03T14:59:59Z'), true)
  for (const now of ['2026-10-03T15:00:00Z', '2026-10-03T16:52:00Z', '2026-10-04T13:00:00Z', '2026-10-02T13:00:00Z']) assert.equal(active(record, now), false)
  for (const patch of [{ startedAt: '2026-10-03T14:00:00Z' }, { status: 'Completado' }, { technicalStatus: 'Cancelado' }, { advanceRequest: { status: 'approved' } }, { awaitingConfirmation: true }]) assert.equal(active({ ...record, ...patch }, '2026-10-03T14:00:00Z'), false)
})
