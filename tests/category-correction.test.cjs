const test = require('node:test')
const assert = require('node:assert/strict')
const { prepareCategoryCorrection } = require('../api/_lib/category-correction.cjs')
const { assertCompletedServices } = require('../api/_lib/completed-service-policy.cjs')
const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const before = { id: 'retirement', sourceTaskId: 'task', customerId: 'customer', client: 'CLI-0170 OFICINA', clientAccount: 'CLI-0170', clientNameAtService: 'OFICINA', serviceId: 'removal', service: 'Retiro de equipo', status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Trabajo realizado', technicalReportedAt: '2026-10-14T15:00:00Z', completedAt: '2026-10-14T15:00:00Z', date: '2026-10-14', time: '11:00', estimatedMinutes: 60, amount: '10000', paymentMethod: 'Transferencia', monthlyFee: '65000', freezeMonthlyFee: true, frozenMonths: 4, collection: { status: 'confirmed', events: [] } }
const fixture = () => ({ history: [{ ...before }], services: [{ id: 'other', name: 'Otro service', status: 'Activo' }], customers: [{ customerId: 'customer', account: 'CLI-0170', kind: 'client', name: 'OFICINA', convertedFromAccount: 'PIG-6625', convertedFromType: 'Abonado', phone: '12345', address: 'Recta 5248' }], reviews: [], agenda: { teams: [{ tasks: [{ ...before, taskId: 'task', historyId: before.id }] }] } })
const input = (state) => ({ recordId: before.id, base: state.history[0], serviceIds: ['other'], reason: 'Mudanza: mantiene el servicio.' })
const prepare = async (state = fixture(), changes = {}, user = admin) => {
  const { correctServiceCategory } = await import('../src/domain/history/category-correction.mjs')
  return prepareCategoryCorrection(state, { ...input(state), ...changes }, user, correctServiceCategory, '2026-10-14T17:00:00Z')
}

test('corrige la baja, restituye el PIG y conserva informe, fecha, cobro y abono', async () => {
  const state = fixture(), saved = await prepare(state)
  assert.equal(saved.after.service, 'Otro service')
  assert.equal(saved.after.clientAccount, 'PIG-6625')
  assert.equal(saved.state.customers[0].kind, 'subscriber')
  for (const key of ['status', 'technicalStatus', 'technicalObservation', 'completedAt', 'technicalReportedAt', 'date', 'time', 'estimatedMinutes', 'amount', 'paymentMethod', 'monthlyFee', 'freezeMonthlyFee', 'frozenMonths', 'collection']) assert.deepEqual(saved.after[key], before[key], key)
  assert.equal(saved.state.agenda.teams[0].tasks[0].service, 'Otro service')
  assert.equal(saved.state.agenda.teams[0].tasks[0].clientAccount, 'PIG-6625')
  assert.equal(saved.after.categoryCorrections[0].reason, 'Mudanza: mantiene el servicio.')
  assert.equal(saved.after.categoryCorrections[0].before.service, 'Retiro de equipo')
  assert.equal(state.history[0].service, 'Retiro de equipo', 'no muta el estado original')
  assert.throws(() => assertCompletedServices(saved.state, state), { statusCode: 409 })
  assert.throws(() => assertCompletedServices({ ...saved.state, history: [{ ...saved.after, categoryCorrections: [] }] }, saved.state), /trazabilidad/)
})

test('no restituye el PIG mientras exista otra baja completada', async () => {
  const state = fixture(); state.history.push({ ...before, id: 'another' })
  const saved = await prepare(state)
  assert.equal(saved.state.customers[0].kind, 'client')
  assert.equal(saved.conversions.length, 0)
})

test('restituye referencias si el PIG ya fue importado nuevamente', async () => {
  const state = fixture()
  state.customers.push({ customerId: 'imported', account: 'PIG-6625', kind: 'subscriber', name: 'OFICINA', phone: '12345', address: 'Recta 5248' })
  state.history.push({ ...before, id: 'previous', service: 'Service de alarma' })
  const saved = await prepare(state)
  assert.equal(saved.after.customerId, 'imported')
  assert.equal(saved.state.history[1].customerId, 'imported')
  assert.equal(saved.state.customers.length, 1)
})

test('bloquea permisos, conflictos, motivos vacíos y categorías inventadas', async () => {
  await assert.rejects(prepare(fixture(), {}, { roleCode: 'technician' }), { statusCode: 403 })
  await assert.rejects(prepare(fixture(), { base: { ...before, amount: '1' } }), { statusCode: 409 })
  await assert.rejects(prepare(fixture(), { reason: '' }), /motivo/)
  await assert.rejects(prepare(fixture(), { serviceIds: ['fake'] }), /catálogo/)
  const state = fixture(); state.history[0].vehicleControl = true
  await assert.rejects(prepare(state), /individuales/)
  const saved = await prepare(fixture(), { amount: '1', technicalObservation: 'Inventada', status: 'Pendiente' })
  assert.equal(saved.after.amount, before.amount)
  assert.equal(saved.after.technicalObservation, before.technicalObservation)
})

test('admite los campos derivados de registros antiguos sin sobrescribirlos', async () => {
  const saved = await prepare(fixture(), { base: { ...before, estimatedMinutesCustomized: true, clientNameAtService: 'Nombre hidratado' } })
  assert.equal(saved.after.service, 'Otro service')
  assert.equal(saved.after.estimatedMinutesCustomized, undefined)
})

test('la persistencia normalizada conserva categoría corregida, motivo y PIG restituido', async () => {
  const fs = require('node:fs'), path = require('node:path')
  const { PGlite } = await import('@electric-sql/pglite')
  const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
  const { readNormalizedState, synchronizeNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
  const pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const current = fixture()
    current.roles = []; current.employees = []; current.vehicles = []
    current.revision = 1; current.preferences = {}
    current.agenda.date = before.date; current.agenda.weekly = {}
    current.agenda.teams[0].teamId = 'team'
    current.services[0].estimatedMinutes = 60; current.services[0].code = 'other'
    current.services.push({ id: 'removal', code: 'retirement', name: 'Retiro de equipo', status: 'Activo', estimatedMinutes: 60 })
    await insertShadowCandidate(pg, buildShadowCandidate(current))
    const correction = await prepare(current)
    correction.state.revision = 2
    await synchronizeNormalizedState(pg, current, correction.state)
    const read = await readNormalizedState(pg)
    assert.equal(read.history[0].service, 'Otro service')
    assert.equal(read.customers[0].account, 'PIG-6625')
    assert.deepEqual(read.history[0].categoryCorrections, correction.after.categoryCorrections)
    assert.equal(read.history[0].technicalObservation, before.technicalObservation)
  } finally { await pg.close() }
})
