const test = require('node:test')
const assert = require('node:assert/strict')
test('distribución usa cuentas activas únicas y coincide con el mapa', async () => {
  const { subscriberDistribution } = await import('../src/domain/dashboard/subscriber-distribution.mjs')
  const { subscriberMapRows } = await import('../src/domain/customers/subscriber-map.mjs')
  const customers = [
    { account: 'PIG-1', locality: 'Córdoba - Docta' },
    { account: ' pig-1 ', locality: 'Centro' },
    { account: 'PIG-2', address: 'Nobu Town' },
    { account: 'PIG-3', address: 'Centro' },
    { account: 'PIG-4', name: 'AUTOMONITOREO' },
    { account: 'PIG-5', excludeFromSubscriberCount: true },
    { account: 'PIG-6', status: 'Baja' },
    { account: 'CLI-1', kind: 'client' }
  ]
  const model = subscriberDistribution(customers)
  assert.equal(model.total, 3)
  assert.deepEqual(model.items.map(item => item.count), [1, 1, 1])
  for (const item of model.items) {
    assert.equal(item.count, subscriberMapRows(customers).filter(row => row.zone === item.key).length)
    assert.ok(Math.abs(item.percentage - 100 / 3) < 1e-10)
  }
  assert.deepEqual(subscriberDistribution([]).items.map(item => item.percentage), [0, 0, 0])
})
