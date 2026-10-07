const test = require('node:test')
const assert = require('node:assert/strict')
test('resuelve PIG por identidad o cuenta legada, sin depender del nombre', async () => {
  const { serviceMapCustomer } = await import('../src/domain/customers/service-map-customer.mjs')
  const customers = [{ customerId: 'a', account: 'PIG-7056', name: 'Mismo nombre' }, { customerId: 'b', account: 'CLI-1', name: 'Mismo nombre' }]
  assert.equal(serviceMapCustomer({ customerId: 'a' }, customers), customers[0])
  assert.equal(serviceMapCustomer({ client: 'PIG-7056 SANTIAGO' }, customers), customers[0])
  assert.equal(serviceMapCustomer({ customerId: 'b', clientAccount: 'PIG-7056' }, customers), null)
  assert.equal(serviceMapCustomer({ customerId: 'eliminado', clientAccount: 'PIG-7056' }, customers), null)
  assert.equal(serviceMapCustomer({ client: 'Mismo nombre' }, customers), null)
  for (const flag of ['newCustomer', 'subscriberReservation', 'vehicleControl']) assert.equal(serviceMapCustomer({ customerId: 'a', [flag]: true }, customers), null)
})
