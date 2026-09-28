const test = require('node:test')
const assert = require('node:assert/strict')
const { assertCompletedServiceChange, assertCompletedServices } = require('../api/_lib/completed-service-policy.cjs')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const record = { id: 'retirement', customerId: 'martin', client: 'CLI-1 MARTIN VARGAS', service: 'Retiro de equipo', status: 'Completado', detail: 'Retiro realizado' }

test('un retiro completado no puede trasladarse a otra persona ni editarse', () => {
  for (const patch of [{ customerId: 'diego', client: 'PIG-2 DIEGO RIZZO' }, { detail: 'Otra observación' }, { service: 'Instalación' }, { time: '15:00' }]) {
    assert.throws(() => assertCompletedServiceChange(record, { ...record, ...patch }), { code: 'COMPLETED_SERVICE_LOCKED' })
  }
  assert.doesNotThrow(() => assertCompletedServiceChange(record, { ...record }))
  assert.doesNotThrow(() => assertCompletedServiceChange({ ...record, status: 'Pendiente' }, { ...record, customerId: 'diego' }))
})

test('rechaza el borrador pendiente si el servidor ya recibió la finalización técnica', () => {
  const current = { history: [{ ...record, status: 'Pendiente', technicalStatus: 'Completado' }] }
  assert.throws(() => applyStateOperations(current, [{ path: ['history', { key: 'id', id: record.id }], existed: true, exists: true, before: { ...record, status: 'Pendiente' }, after: { ...record, customerId: 'diego' } }]), { code: 'COMPLETED_SERVICE_LOCKED' })
  assert.equal(current.history[0].customerId, 'martin')
})

test('permite actualizar un pendiente conservando el completado del mismo día', () => {
  const previous = { history: [record, { ...record, id: 'pending', status: 'Pendiente' }] }
  assert.doesNotThrow(() => assertCompletedServices({ history: [record, { ...previous.history[1], detail: 'Nueva visita' }] }, previous))
})
