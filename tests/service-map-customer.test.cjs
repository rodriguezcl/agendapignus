const test = require('node:test')
const assert = require('node:assert/strict')
test('resuelve PIG y CLI por identidad o cuenta legada, sin depender del nombre', async () => {
  const { serviceMapCustomer } = await import('../src/domain/customers/service-map-customer.mjs')
  const customers = [{ customerId: 'a', account: 'PIG-7056', name: 'Mismo nombre' }, { customerId: 'b', account: 'CLI-1', name: 'Mismo nombre' }]
  assert.equal(serviceMapCustomer({ customerId: 'a' }, customers), customers[0])
  assert.equal(serviceMapCustomer({ client: 'PIG-7056 SANTIAGO' }, customers), customers[0])
  assert.equal(serviceMapCustomer({ customerId: 'b', clientAccount: 'PIG-7056' }, customers), customers[1])
  assert.equal(serviceMapCustomer({ clientAccount: 'CLI-1' }, customers), customers[1])
  assert.equal(serviceMapCustomer({ client: 'CLI-1 Mismo nombre' }, customers), customers[1])
  assert.equal(serviceMapCustomer({ customerId: 'eliminado', clientAccount: 'PIG-7056' }, customers), null)
  assert.equal(serviceMapCustomer({ client: 'Mismo nombre' }, customers), null)
  for (const flag of ['newCustomer', 'subscriberReservation', 'vehicleControl']) assert.equal(serviceMapCustomer({ customerId: 'a', [flag]: true }, customers), null)
})

test('CLI usa coordenadas válidas o dirección y aclara cuando falta ubicación', async () => {
  const { serviceMapCustomer } = await import('../src/domain/customers/service-map-customer.mjs')
  const { customerMapLocation } = await import('../src/domain/customers/customer-location.mjs')
  const customer = { customerId: 'cli', account: 'CLI-0083', address: 'Ituzaingó 1237, Córdoba' }
  const resolve = entry => customerMapLocation(serviceMapCustomer({ customerId: 'cli' }, [entry]))
  assert.ok(resolve(customer).embedUrl.includes('Ituza'))
  assert.ok(resolve({ ...customer, fields: { 'Ubicación de la cuenta': '-31.4,-64.2' } }).embedUrl.includes('-31.4%2C-64.2'))
  assert.equal(resolve({ ...customer, address: '' }).unresolved, true)
})
