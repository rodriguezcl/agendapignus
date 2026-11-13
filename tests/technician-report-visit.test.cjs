const test = require('node:test')
const assert = require('node:assert/strict')
const { assertReportVisit } = require('../api/_lib/technician-report-visit.cjs')

test('a late report cannot mark the replacement visit as requiring rescheduling', () => {
  const opened = { date: '2026-11-12', time: '14:30', reprogrammedAt: '' }
  const moved = { date: '2026-11-17', time: '08:30', reprogrammedAt: '2026-11-12T17:50:26.159Z' }
  assert.throws(() => assertReportVisit(moved, opened), { statusCode: 409, code: 'TECHNICIAN_VISIT_CHANGED' })
  assert.throws(() => assertReportVisit(moved), { statusCode: 409 })
  assert.doesNotThrow(() => assertReportVisit(moved, moved))
  assert.doesNotThrow(() => assertReportVisit({ ...moved, technicalStatus: 'Completado' }, moved))
  for (const patch of [{ time: '09:00' }, { reprogrammedAt: '2026-11-13T12:00:00Z' }]) {
    assert.throws(() => assertReportVisit({ ...moved, ...patch }, moved), { statusCode: 409 })
  }
  assert.doesNotThrow(() => assertReportVisit(opened))
})

test('the HTTP client retains the opened visit when retrying a report', async () => {
  const { submitTechnicianStatus } = await import('../src/infrastructure/http/technician-status.mjs')
  const visit = { date: '2026-11-17', time: '08:30', reprogrammedAt: '2026-11-12T17:50:26.159Z' }
  const bodies = []
  const fetcher = async (_url, options) => {
    bodies.push(JSON.parse(options.body))
    return bodies.length === 1 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, json: async () => ({ record: { id: 'r' } }) }
  }
  await submitTechnicianStatus({ recordId: 'r', type: 'Reprogramación solicitada', observation: 'Sin acceso', visit, fetcher, retryDelay: 0 })
  assert.equal(bodies.length, 2)
  for (const body of bodies) assert.deepEqual(body.visit, visit)
})
