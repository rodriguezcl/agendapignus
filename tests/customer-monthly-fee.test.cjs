const test = require('node:test')
const assert = require('node:assert/strict')
test('consulta el último monto completado del cliente sin inventar vigencia ni mutar historial', async () => {
  const { customerMonthlyFee } = await import('../src/domain/customers/customer-monthly-fee.mjs')
  const customer = { customerId: 'a', account: 'PIG-1' }
  const history = [
    { customerId: 'a', status: 'Completado', date: '2026-01-01', monthlyFee: '100' },
    { customerId: 'a', status: 'Pendiente', date: '2026-10-01', monthlyFee: '999' },
    { customerId: 'b', clientAccount: 'PIG-1', status: 'Completado', date: '2026-10-01', monthlyFee: '888' },
    { clientAccount: 'PIG-1', status: 'Completado', date: '2026-02-01', monthlyFee: '200' }
  ]
  const before = JSON.stringify(history)
  assert.deepEqual(customerMonthlyFee(customer, history), { amount: '200', effectiveFrom: '', serviceDate: '2026-02-01' })
  assert.equal(JSON.stringify(history), before)
  assert.equal(customerMonthlyFee({ account: 'CLI-2' }, history), null)
  assert.equal(customerMonthlyFee(customer, [{ ...history[0], monthlyFee: 0, monthlyFeeEffectiveFrom: '2026-01-15' }]).effectiveFrom, '2026-01-15')
})
