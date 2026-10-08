const test = require('node:test')
const assert = require('node:assert/strict')
const { validateFrozenMonths } = require('../api/_lib/frozen-months.cjs')
const record = { id: 'h', freezeMonthlyFee: true, frozenMonths: 4 }
test('inicia con 4 y 6 meses, valida catálogo y preserva contratos anteriores', () => {
  assert.doesNotThrow(() => validateFrozenMonths({ history: [record] }))
  assert.doesNotThrow(() => validateFrozenMonths({ history: [{ ...record, frozenMonths: 6 }] }))
  assert.throws(() => validateFrozenMonths({ history: [{ ...record, frozenMonths: 5 }] }))
  const next = { agenda: { weekly: { _frozenMonthOptions: [6] } }, history: [record] }
  assert.doesNotThrow(() => validateFrozenMonths(next, { history: [record] }))
  assert.throws(() => validateFrozenMonths(next))
  assert.throws(() => validateFrozenMonths({ agenda: { weekly: { _frozenMonthOptions: [0] } } }))
  assert.doesNotThrow(() => validateFrozenMonths({ agenda: { weekly: { _frozenMonthOptions: [] } }, history: [{ freezeMonthlyFee: false }] }))
})
test('cambiar congelamiento activa guardado sin ensuciar servicios antiguos', async () => {
  const { serviceHasChanges } = await import('../src/domain/agenda/service-changes.mjs')
  assert.equal(serviceHasChanges({ freezeMonthlyFee: false, frozenMonths: 0 }, {}), false)
  assert.equal(serviceHasChanges(record, {}), true)
  assert.equal(serviceHasChanges({ ...record, frozenMonths: 6 }, record), true)
})
