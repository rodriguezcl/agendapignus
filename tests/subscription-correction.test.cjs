const test = require('node:test')
const assert = require('node:assert/strict')
const { assertCompletedServices } = require('../api/_lib/completed-service-policy.cjs')
const { subscriptionColumns } = require('../api/_lib/subscription-report.cjs')
const domain = import('../src/domain/customers/subscription-correction.mjs')
const actor = { id: 'admin', name: 'Administrador' }
function fixture() {
  const record = { id: 'old', customerId: 'a', clientAccount: 'PIG-1', client: 'PIG-1 CLIENTE', status: 'Completado', serviceId: 'alarm', service: 'Instalación de alarma', installationZone: 'residencial', date: '2025-02-01', time: '08:30', startedAt: '2025-02-01T12:00:00Z', completedAt: '2025-02-01T14:00:00Z', sourceTaskId: 'task1' }
  return { customers: [{ customerId: 'a', account: 'PIG-1' }, { customerId: 'b', account: 'PIG-2' }], services: [{ id: 'alarm', code: 'alarm-installation' }], history: [record, { ...record, id: 'other', sourceTaskId: 'task2' }], agenda: { teams: [{ tasks: [{ taskId: 'task1', historyId: 'old', status: 'Completado', time: '08:30' }] }], weekly: { _frozenMonthOptions: [4, 6], '2025-02-01': { teams: [{ tasks: [{ historyId: 'old', status: 'Completado' }] }] } } } }
}
async function command(state) {
  const { subscriptionCorrectionBase } = await domain
  return { customerId: 'a', recordId: 'old', base: subscriptionCorrectionBase(state.history[0]), values: { monthlyFee: '80000,50', monthlyFeeEffectiveFrom: '2025-02-05', freezeMonthlyFee: true, frozenMonths: 4 } }
}
test('corrige instalación histórica, reportes y ficha sin reabrir agenda ni mutar original', async () => {
  const { correctSubscription } = await domain
  const state = fixture(), original = structuredClone(state)
  const result = correctSubscription(state, await command(state), actor, '2026-10-08T15:00:00Z')
  assert.deepEqual(state, original)
  assert.equal(result.after.monthlyFee, '80000.5')
  for (const field of ['status', 'date', 'time', 'startedAt', 'completedAt', 'customerId']) assert.equal(result.after[field], state.history[0][field])
  assert.deepEqual(result.state.history[1], state.history[1])
  assert.deepEqual(subscriptionColumns(result.after), ['$ 80.000,50', 'Sí', '4'])
  const { customerMonthlyFee } = await import('../src/domain/customers/customer-monthly-fee.mjs')
  assert.deepEqual(customerMonthlyFee(state.customers[0], result.state.history), { amount: '80000.5', effectiveFrom: '2025-02-05', serviceDate: '2025-02-01' })
  for (const plan of [result.state.agenda, result.state.agenda.weekly['2025-02-01']]) {
    assert.equal(plan.teams[0].tasks[0].status, 'Completado')
    assert.equal(plan.teams[0].tasks[0].monthlyFee, '80000.5')
  }
  assert.deepEqual(result.after.subscriptionCorrectedBy, actor)
  assert.equal(result.after.subscriptionCorrectedAt, '2026-10-08T15:00:00Z')
})
test('el bloqueo normal continúa; excepción sólo para campos comerciales del registro elegido', async () => {
  const { correctSubscription } = await domain
  const before = fixture(), result = correctSubscription(before, await command(before), actor)
  assert.throws(() => assertCompletedServices(result.state, before), { code: 'COMPLETED_SERVICE_LOCKED' })
  assert.doesNotThrow(() => assertCompletedServices(result.state, before, { subscriptionCorrectionId: 'old' }))
  result.state.history[0].time = '15:00'
  assert.throws(() => assertCompletedServices(result.state, before, { subscriptionCorrectionId: 'old' }), { code: 'COMPLETED_SERVICE_LOCKED' })
  result.state.history[0].time = '08:30'
  result.state.history[1] = { ...result.state.history[1], monthlyFee: '12' }
  assert.throws(() => assertCompletedServices(result.state, before, { subscriptionCorrectionId: 'old' }), { code: 'COMPLETED_SERVICE_LOCKED' })
})
test('excluye Docta, Nobu, sin monitoreo, pendientes, reinstalaciones y reservas', async () => {
  const { correctSubscription, isResidentialInstallation } = await domain
  for (const patch of [{ installationZone: 'docta' }, { installationZone: 'nobu-town' }, { installationZone: 'no-monitoreada' }, { installationZone: '', address: 'Docta Córdoba' }, { status: 'Pendiente' }, { subscriberReservation: true }, { serviceId: 'reinstall', service: 'Reinstalación de alarma' }]) {
    const state = fixture(); Object.assign(state.history[0], patch)
    assert.equal(isResidentialInstallation(state.history[0], state.services), false)
    const input = await command(state)
    assert.throws(() => correctSubscription(state, input, actor), /Sólo se pueden/)
  }
})
test('instalación combinada y vínculo legacy por cuenta exacta, sin confundir clientes', async () => {
  const { isResidentialInstallation, recordBelongsToCustomer, correctSubscription } = await domain
  const state = fixture()
  assert.equal(isResidentialInstallation({ ...state.history[0], serviceTypes: [{ id: 'camera', name: 'Instalación de cámaras' }, { id: 'alarm', name: 'Instalación de alarma' }] }, state.services), true)
  assert.equal(recordBelongsToCustomer({ client: 'PIG-1 CLIENTE' }, state.customers[0]), true)
  assert.equal(recordBelongsToCustomer({ customerId: 'b', clientAccount: 'PIG-1' }, state.customers[0]), false)
  assert.throws(() => correctSubscription(state, { ...state, customerId: 'b', recordId: 'old' }, actor), /Sólo se pueden/)
})
test('rechaza cambios simultáneos, campos ajenos y valores inválidos', async () => {
  const { correctSubscription } = await domain
  const state = fixture(), input = await command(state)
  assert.throws(() => correctSubscription(state, { ...input, base: { ...input.base, monthlyFee: '5' } }, actor), { statusCode: 409 })
  for (const patch of [{ time: '10:00' }, { monthlyFee: '-1' }, { monthlyFee: '' }, { monthlyFee: '1.001' }, { monthlyFee: 'NaN' }, { monthlyFeeEffectiveFrom: '2025-02-30' }, { monthlyFeeEffectiveFrom: '' }, { freezeMonthlyFee: '' }, { frozenMonths: 5 }, { frozenMonths: 4.5 }]) {
    assert.throws(() => correctSubscription(state, { ...input, values: { ...input.values, ...patch } }, actor))
  }
  const zero = correctSubscription(state, { ...input, values: { ...input.values, monthlyFee: '0', freezeMonthlyFee: false, frozenMonths: 6 } }, actor)
  assert.equal(zero.after.monthlyFee, '0'); assert.equal(zero.after.frozenMonths, 0)
})
test('permite conservar plazo anterior, pero no elegir plazos retirados nuevos', async () => {
  const { correctSubscription } = await domain
  const state = fixture()
  state.history[0].freezeMonthlyFee = true; state.history[0].frozenMonths = 9
  const input = await command(state)
  assert.doesNotThrow(() => correctSubscription(state, { ...input, values: { ...input.values, frozenMonths: 9 } }, actor))
  assert.throws(() => correctSubscription(state, { ...input, values: { ...input.values, frozenMonths: 12 } }, actor))
})
