const test = require('node:test')
const assert = require('node:assert/strict')

test('cuenta solo abonados activos sin duplicar cuentas o identidades', async () => {
  const { activeSubscriberCount } = await import('../src/domain/dashboard/subscriber-growth.mjs')
  const customers = [
    { account: 'PIG-1', customerId: '1' },
    { account: ' pig-1 ', customerId: 'copia' },
    { account: 'PIG-2', customerId: '1' },
    { account: 'PIG-3', status: 'Inactivo' },
    { account: 'PIG-4', subscriptionEndedAt: '2026-10-01' },
    { account: 'CLI-1', kind: 'client' },
    { account: 'PIG-5', kind: 'client' },
    { kind: 'subscriber', customerId: '6' },
    { kind: 'subscriber' }
  ]
  assert.equal(activeSubscriberCount(customers), 2)
  assert.equal(activeSubscriberCount([]), 0)
})

test('calcula crecimiento confirmado y proyectado sobre la misma base explícita', async () => {
  const { subscriberGrowthPercentages } = await import('../src/domain/dashboard/subscriber-growth.mjs')
  const result = subscriberGrowthPercentages({ baseCount: 1460, netGrowth: 24, projectedNetGrowth: 35 })
  assert.equal(result.confirmedPercent.toFixed(2), '1.64')
  assert.equal(result.projectedPercent.toFixed(2), '2.40')
  assert.equal(subscriberGrowthPercentages({ baseCount: 100, netGrowth: -5, projectedNetGrowth: 0 }).confirmedPercent, -5)
  assert.equal(subscriberGrowthPercentages({ baseCount: 100, netGrowth: 0, projectedNetGrowth: null }).confirmedPercent, 0)
  assert.equal(subscriberGrowthPercentages({ baseCount: 100, projectedNetGrowth: null }).projectedPercent, null)
})

test('no inventa porcentajes ante una base desconocida, vacía o inválida', async () => {
  const { subscriberGrowthPercentages } = await import('../src/domain/dashboard/subscriber-growth.mjs')
  for (const baseCount of [undefined, null, 0, -1, 1.5, '1460', NaN, Infinity]) {
    assert.deepEqual(subscriberGrowthPercentages({ baseCount, netGrowth: 24, projectedNetGrowth: 35 }), { baseCount: null, confirmedPercent: null, projectedPercent: null })
  }
})
