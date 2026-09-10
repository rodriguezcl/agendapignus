const test = require('node:test')
const assert = require('node:assert/strict')
const { customerImportChanges, normalizeImportedCustomers, restoreCustomerImportBackup, validateImportedCustomers, validateIncrementalCustomerImport } = require('../api/_lib/customer-import.cjs')
const { bulkDeleteRows, bulkUpsertRows } = require('../api/_lib/normalized-state-repository.cjs')

test('la sincronización secundaria agrupa más de mil abonados en una escritura masiva', async () => {
  const queries = []
  const sql = { query: async (statement, parameters) => { queries.push({ statement, parameters }); return { rows: [] } } }
  const rows = Array.from({ length: 1028 }, (_, index) => ({
    id: `customer-${index}`,
    account: `PIG-${index}`,
    name: `ABONADO ${index}`,
    original_payload: { customerId: `customer-${index}`, account: `PIG-${index}` }
  }))

  assert.equal(await bulkUpsertRows(sql, 'customers', ['id'], rows), 1028)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].parameters.length, 4112)
  assert.match(queries[0].statement, /insert into normalized_shadow\.customers/)
  assert.match(queries[0].statement, /on conflict \(id\) do update/)
})

test('la sincronización secundaria elimina miles de campos residuales en pocos lotes', async () => {
  const queries = []
  const sql = { query: async (statement, parameters) => { queries.push({ statement, parameters }); return { rows: [] } } }
  const rows = Array.from({ length: 12_324 }, (_, index) => ({
    customer_id: `customer-${Math.floor(index / 12)}`,
    field_name: `residual-${index % 12}`
  }))

  assert.equal(await bulkDeleteRows(sql, 'customer_import_fields', ['customer_id', 'field_name'], rows), 12_324)
  assert.equal(queries.length, 13)
  assert.equal(queries.reduce((total, query) => total + query.parameters.length, 0), 24_648)
  assert.ok(queries.every(query => query.parameters.length <= 2_000))
  assert.match(queries[0].statement, /delete from normalized_shadow\.customer_import_fields/)
  assert.match(queries[0].statement, /where \(customer_id,field_name\) in/)
})

const customer = (account, customerId, name = account) => ({ account, customerId, name, fields: {} })

test('la importación escribe solamente los clientes que cambiaron', () => {
  const unchanged = customer('PIG-0001', 'customer-1', 'CLIENTE UNO')
  const changed = customer('PIG-0002', 'customer-2', 'CLIENTE DOS')
  const created = customer('PIG-0003', 'customer-3', 'CLIENTE TRES')
  const changes = customerImportChanges([unchanged, changed], [unchanged, { ...changed, phone: '3510000000' }, created])

  assert.deepEqual(changes.upsert.map(item => item.account), ['PIG-0002', 'PIG-0003'])
  assert.deepEqual(changes.remove, [])
  assert.deepEqual(changes.backup.before, [changed])
  assert.deepEqual(changes.backup.createdAccounts, ['PIG-0003'])
})

test('el respaldo incremental restaura modificaciones, altas y bajas', () => {
  const before = [customer('PIG-0001', 'customer-1', 'ANTERIOR'), customer('PIG-0002', 'customer-2')]
  const after = [customer('PIG-0001', 'customer-1', 'NUEVO'), customer('PIG-0003', 'customer-3')]
  const changes = customerImportChanges(before, after)

  assert.deepEqual(restoreCustomerImportBackup(after, changes.backup), normalizeImportedCustomers(before))
})

test('se mantienen compatibles los respaldos completos anteriores', () => {
  const previous = [customer('PIG-0001', 'customer-1', ' nombre  anterior ')]
  assert.deepEqual(restoreCustomerImportBackup([], { customers: previous })[0], { ...previous[0], kind: 'subscriber', name: 'NOMBRE ANTERIOR' })
})

test('la validación rechaza cuentas e identificadores repetidos', () => {
  assert.throws(() => validateImportedCustomers([customer('PIG-0001', 'customer-1'), customer('PIG-0001', 'customer-2')]), /duplicados/)
  assert.throws(() => validateImportedCustomers([customer('PIG-0001', 'customer-1'), customer('PIG-0002', 'customer-1')]), /duplicados/)
  assert.equal(normalizeImportedCustomers([customer('PIG-0001', 'customer-1', ' cliente   uno ')])[0].name, 'CLIENTE UNO')
})

test('la importación incremental nunca puede eliminar registros existentes', () => {
  const current = [customer('PIG-0001', 'customer-1'), customer('CLI-0001', 'customer-2')]
  assert.throws(
    () => validateIncrementalCustomerImport(current, [customer('PIG-0001', 'customer-1')]),
    /no puede eliminar abonados ni clientes existentes/
  )
  assert.doesNotThrow(() => validateIncrementalCustomerImport(current, [...current, customer('PIG-0002', 'customer-3')]))
})
