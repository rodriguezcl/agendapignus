const test = require('node:test')
const assert = require('node:assert/strict')
const { preserveCustomerTrackingFlags } = require('../api/_lib/customer-import.cjs')
const { mapCustomer } = require('../api/_lib/subscriber-map-access.cjs')

test('automonitoreo y exclusión manual usan el mismo padrón en mapa y porcentaje', async () => {
  const { activeSubscriberCount } = await import('../src/domain/dashboard/subscriber-growth.mjs')
  const { subscriberMapRows } = await import('../src/domain/customers/subscriber-map.mjs')
  const { customerKindLabel } = await import('../src/features/customers/application/customer-model.mjs')
  const customers = [
    { name: 'Cuenta normal' },
    { name: 'Cliente (AUTOMONITOREO - SIN ABONO MENSUAL)' },
    { name: 'Cliente auto-monitoreo' },
    { name: 'Otra cuenta', excludeFromSubscriberCount: true, cctvService: true },
    { name: 'Automonitoreo corregido', excludeFromSubscriberCount: false },
    { name: 'Baja', subscriptionEndedAt: '2026-10-01' }
  ].map((row, i) => ({ customerId: String(i), account: `PIG-${i}`, kind: 'subscriber', ...row }))
  const before = structuredClone(customers)
  assert.equal(activeSubscriberCount(customers), 2)
  assert.deepEqual(subscriberMapRows(customers.map(mapCustomer)).map(row => row.customer.customerId).sort(), ['0', '4'])
  assert.equal(customerKindLabel(customers[1]), 'Cuenta PIG sin abono')
  assert.equal(customerKindLabel(customers[4]), 'Abonado')
  assert.deepEqual(customers, before)
})

test('importación conserva ambas decisiones manuales e ignora flags del archivo', () => {
  for (const flag of [true, false]) {
    const current = { customerId: '1', account: 'PIG-1', excludeFromSubscriberCount: flag }
    const imported = { ...current, name: 'Nombre actualizado', excludeFromSubscriberCount: !flag }
    assert.equal(preserveCustomerTrackingFlags([current], [imported])[0].excludeFromSubscriberCount, flag)
    const fresh = preserveCustomerTrackingFlags([], [imported])[0]
    assert.equal(Object.hasOwn(fresh, 'excludeFromSubscriberCount'), false)
  }
})
