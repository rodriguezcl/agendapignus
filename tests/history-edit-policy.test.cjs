const test = require('node:test')
const assert = require('node:assert/strict')

test('started, reported and previously rescheduled services protect identity', async () => {
  const { hasServiceActivity, protectServiceIdentity } = await import('../src/domain/history/history-edit-policy.mjs')
  for (const activity of [{ startedAt: '2026-09-18T14:00:00Z' }, { technicalStatus: 'Reprogramación solicitada' }, { technicalObservation: 'Trabajo realizado' }, { status: 'Completado' }, { reschedulingHistory: [{}] }]) {
    const record = { ...activity, customerId: 'c', client: 'Cliente', serviceId: 's', service: 'Service', address: 'Dirección original', phone: '123' }
    assert.equal(hasServiceActivity(record), true)
    const patch = protectServiceIdentity(record, { customerId: 'otro', serviceId: 'otro', address: 'otra', phone: '456', estimatedMinutes: 120, detail: 'Nueva visita', internalNote: 'Preparar' })
    for (const key of ['customerId', 'client', 'serviceId', 'service', 'address', 'phone']) assert.equal(patch[key], record[key])
    assert.equal(patch.estimatedMinutes, 120)
    assert.equal(patch.detail, 'Nueva visita')
    assert.equal(patch.internalNote, 'Preparar')
  }
})

test('unstarted pending services remain editable and missing legacy fields are not fabricated', async () => {
  const { hasServiceActivity, protectServiceIdentity } = await import('../src/domain/history/history-edit-policy.mjs')
  assert.equal(hasServiceActivity({ status: 'Pendiente' }), false)
  assert.equal(protectServiceIdentity({ status: 'Pendiente' }, { customerId: 'nuevo' }).customerId, 'nuevo')
  assert.equal(Object.hasOwn(protectServiceIdentity({ technicalStatus: 'Completado' }, { customerId: 'inventado' }), 'customerId'), false)
})
