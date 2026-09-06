const test = require('node:test')
const assert = require('node:assert/strict')

test('la importación conserva el CustomerId de una cuenta existente', async () => {
  const { mergeImportedCustomers } = await import('../src/customer-import.mjs')
  const current = [{
    customerId: 'customer-existing', account: 'PIG-0182', name: 'NOMBRE ANTERIOR',
    street: 'Calle anterior', locality: 'Córdoba', province: 'Córdoba', phone: '351', fields: { Anterior: 'sí' }
  }]
  const imported = [{
    customerId: '', account: 'PIG-0182', name: 'NOMBRE ACTUALIZADO',
    street: 'Calle nueva', locality: 'Córdoba', province: 'Córdoba', phone: '352', fields: { Nuevo: 'sí' }
  }]

  const result = mergeImportedCustomers(current, imported, () => 'customer-generated')

  assert.equal(result.updated, 1)
  assert.equal(result.created, 0)
  assert.equal(result.customers[0].customerId, 'customer-existing')
  assert.equal(result.customers[0].name, 'NOMBRE ACTUALIZADO')
})

test('la importación asigna CustomerId a cuentas nuevas o registros históricos incompletos', async () => {
  const { mergeImportedCustomers } = await import('../src/customer-import.mjs')
  let sequence = 0
  const createId = () => `customer-generated-${++sequence}`
  const current = [{ customerId: '', account: 'PIG-0182', name: 'LEGACY', street: '-', fields: {} }]
  const imported = [
    { customerId: '', account: 'PIG-0182', name: 'LEGACY ACTUALIZADO', street: '-', fields: {} },
    { customerId: '', account: 'PIG-9999', name: 'NUEVO', street: 'Calle 1', fields: {} }
  ]

  const result = mergeImportedCustomers(current, imported, createId)

  assert.deepEqual(result.customers.map(customer => customer.customerId), ['customer-generated-1', 'customer-generated-2'])
  assert.equal(result.updated, 1)
  assert.equal(result.created, 1)
})
