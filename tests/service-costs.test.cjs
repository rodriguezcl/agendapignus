const test = require('node:test')
const assert = require('node:assert/strict')
const types = [{ id: 4, name: 'Service de alarma' }, { id: 5, name: 'Service de cámaras' }, { id: 6, name: 'Otro service' }]
const base = { serviceId: 4, service: types[0].name, serviceTypes: types.slice(0, 2), paymentMethod: 'Efectivo' }

test('el total surge de los costos, distingue vacío de cero y suma centavos exactos', async () => {
  const { serviceChargePatch, serviceChargesComplete, serviceChargesTotal } = await import('../src/domain/services/multi-service.mjs')
  let task = { ...base, ...serviceChargePatch(base, 4, '0') }
  assert.equal(task.amount, '0'); assert.equal(serviceChargesComplete(task), false)
  task = { ...task, ...serviceChargePatch(task, 5, '83160.25') }
  assert.equal(task.amount, '83160.25'); assert.equal(serviceChargesComplete(task), true)
  const { validateCharges } = require('../api/_lib/work-completion.cjs')
  assert.doesNotThrow(() => validateCharges(task))
  assert.equal(serviceChargesTotal([{ amount: '0.1' }, { amount: '0.2' }]), '0.3')
  assert.equal(serviceChargesTotal([{ amount: '' }, { amount: '' }]), '')
  assert.equal(serviceChargesTotal([{ amount: '0' }, { amount: '0' }]), '0')
  assert.equal(serviceChargesTotal([{ amount: '-1' }, { amount: '10' }]), '')
})

test('cambiar tipos conserva sus costos y recalcula sin trasladar el importe de un trabajo eliminado', async () => {
  const { multiServicePatch } = await import('../src/domain/services/multi-service.mjs')
  const task = { ...base, amount: '100', serviceCharges: [{ id: 4, amount: '25' }, { id: 5, amount: '75' }] }
  const changed = multiServicePatch(task, ['5', '6'], types)
  assert.deepEqual(changed.serviceCharges, [{ id: 5, amount: '75' }, { id: 6, amount: '' }]); assert.equal(changed.amount, '75')
  const single = multiServicePatch(task, ['4'], types)
  assert.equal(single.amount, '25'); assert.equal(single.serviceCharges, undefined)
  const added = multiServicePatch({ ...single }, ['4', '5'], types)
  assert.deepEqual(added.serviceCharges, [{ id: 4, amount: '25' }, { id: 5, amount: '' }])
  const legacy = multiServicePatch({ ...base, amount: '100' }, ['4', '5'], types)
  assert.equal(legacy.serviceCharges, undefined); assert.equal(legacy.amount, undefined)
})

test('guardado exige costo explícito en cada trabajo, acepta cero y mantiene el monto manual para uno solo', async () => {
  const { weeklyTaskMissingFields, normalizeCurrencyAmount } = await import('../src/features/services/application/service-fields.mjs')
  const task = { ...base, time: '08:30', customerId: 'c', address: 'Dirección', phone: '123', detail: 'Revisión', amount: '0', serviceCharges: [{ id: 4, amount: '0' }, { id: 5, amount: '' }] }
  assert.deepEqual(weeklyTaskMissingFields(task, types[0]), ['costo de cada trabajo (usá 0 si es sin cargo)'])
  assert.deepEqual(weeklyTaskMissingFields({ ...task, serviceCharges: [{ id: 4, amount: '0' }, { id: 5, amount: '0' }] }, types[0]), [])
  assert.deepEqual(weeklyTaskMissingFields({ ...task, amount: '', serviceTypes: [types[0]], serviceCharges: undefined }, types[0]), ['monto'])
  assert.deepEqual(weeklyTaskMissingFields({ ...task, paymentMethod: 'No aplica', amount: '', serviceCharges: undefined }, types[0]), [])
  assert.equal(normalizeCurrencyAmount('125,50'), '125.50'); assert.equal(normalizeCurrencyAmount('125.50'), '125.50')
})
