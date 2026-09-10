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

test('solo importa los diez campos autorizados y arma la dirección sin provincia', async () => {
  const { CUSTOMER_IMPORT_FIELDS, customerFromImportRow } = await import('../src/customer-import.mjs')
  const headers = ['Dealer/Cuenta', 'Nombre', 'Tipo de Cuenta', 'Calle', 'Localidad', 'Provincia/Estado', 'Teléfono', 'IMEI', 'Clave', 'Ubicación de la cuenta', 'Estado', 'Situación', 'Último Test']
  const row = [' pig-0100 ', 'Abonado', 'Residencial', 'San Martín 123', 'Córdoba', 'Córdoba', '3510000000', '123456789', '4321', 'Casa', 'Activo', 'Normal', 'Ayer']

  const customer = customerFromImportRow(headers, row)

  assert.equal(customer.account, 'PIG-0100')
  assert.equal(customer.address, 'San Martín 123, Córdoba')
  assert.equal(customer.province, 'Córdoba')
  assert.deepEqual(Object.keys(customer.fields), CUSTOMER_IMPORT_FIELDS.map(([label]) => label))
  assert.equal(customer.fields.IMEI, '123456789')
  assert.equal(customer.fields.Clave, '4321')
  assert.equal(customer.fields['Ubicación de la cuenta'], 'Casa')
  assert.equal(customer.fields.Estado, undefined)
})

test('al actualizar elimina campos residuales y cuenta solo cambios reales', async () => {
  const { customerFromImportRow, mergeImportedCustomers } = await import('../src/customer-import.mjs')
  const headers = ['Dealer/Cuenta', 'Nombre', 'Calle', 'Localidad', 'Provincia/Estado', 'Teléfono', 'IMEI', 'Clave', 'Ubicación de la cuenta']
  const imported = customerFromImportRow(headers, ['PIG-0100', 'ABONADO', 'San Martín 123', 'Córdoba', 'Córdoba', '351', '123', '456', 'Casa'])
  const current = [{ ...imported, customerId: 'customer-existing', address: 'San Martín 123, Córdoba, Córdoba', fields: { ...imported.fields, Estado: 'Activo' } }]

  const cleaned = mergeImportedCustomers(current, [imported], () => 'new-id')
  const unchanged = mergeImportedCustomers(cleaned.customers, [imported], () => 'new-id')

  assert.equal(cleaned.updated, 1)
  assert.equal(cleaned.customers[0].address, 'San Martín 123, Córdoba')
  assert.equal(cleaned.customers[0].fields.Estado, undefined)
  assert.equal(unchanged.updated, 0)
  assert.equal(unchanged.created, 0)
})
