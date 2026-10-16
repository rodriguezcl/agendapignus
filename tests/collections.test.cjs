const test = require('node:test')
const assert = require('node:assert/strict')
const { assertCompletedServices } = require('../api/_lib/completed-service-policy.cjs')
const { removeHistoryRecord } = require('../api/_lib/history-record-removal.cjs')
const { userCan, visibleStateForUser, technicianSafeRecord } = require('../api/_lib/core.cjs')
const domain = import('../src/domain/collections/collections.mjs')
const actor = { id: 'admin', name: 'Administración' }
function fixture() {
  const record = { id: 'payment', sourceTaskId: 't', teamId: 'team', estimatedMinutes: 60, date: '2026-10-14', time: '09:00', client: 'CLI-1 Cliente', customerId: 'c', serviceId: 's', service: 'Service técnico', status: 'Completado', amount: '10000', paymentMethod: 'Efectivo', technicianIds: ['tech'], technicians: ['Técnico'], detail: 'Trabajo realizado' }
  return { revision: 1, roles: [], employees: [], services: [{ id: 's', code: 'service', name: 'Service técnico', estimatedMinutes: 60 }], customers: [{ customerId: 'c', account: 'CLI-1', name: 'Cliente' }], vehicles: [], preferences: {}, history: [record], agenda: { date: record.date, teams: [{ teamId: 'team', tasks: [{ ...record, taskId: 't', historyId: record.id }] }], weekly: {} } }
}
async function command(state, action = 'confirm', values = {}) {
  const { collectionBase } = await domain
  return { recordId: 'payment', base: collectionBase(state.history[0]), amount: '9500.50', paymentMethod: 'Transferencia', action, note: 'Transferencia verificada', ...values }
}

test('corte fijo desde el 14/10, no incluye servicios anteriores ni reprogramados antiguos, cero o sin forma de pago', async () => {
  const { hasCollection, collectionRecords } = await domain
  const base = fixture().history[0]
  for (const patch of [{ date: '2026-10-13' }, { rescheduledFrom: '2026-10-13' }, { reschedulingHistory: [{ date: '2026-10-12' }] }, { amount: '' }, { amount: '0' }, { amount: '-1' }, { amount: 'NaN' }, { paymentMethod: '' }, { paymentMethod: 'No aplica' }, { vehicleControl: true }]) assert.equal(hasCollection({ ...base, ...patch }), false, JSON.stringify(patch))
  for (const patch of [{}, { date: '2026-11-01' }, { status: 'Pendiente' }, { paymentMethod: 'A confirmar' }]) assert.equal(hasCollection({ ...base, ...patch }), true)
  assert.deepEqual(collectionRecords([{ ...base, id: 'later', date: '2026-11-01' }, base]).map(record => record.id), ['payment', 'later'])
})

test('rectificación y confirmación explícitas conservan trazabilidad y sincronizan agenda sin reabrir el servicio', async () => {
  const { manageCollection, collectionConfirmed } = await domain
  const before = fixture(), snapshot = structuredClone(before)
  const correction = manageCollection(before, await command(before, 'correct'), actor, '2026-10-14T15:00:00Z')
  assert.deepEqual(before, snapshot)
  assert.equal(collectionConfirmed(correction.after), false)
  assert.equal(correction.after.collection.events.length, 1)
  const result = manageCollection(correction.state, await command(correction.state), actor, '2026-10-14T15:05:00Z')
  assert.equal(result.after.amount, '9500.5')
  assert.equal(result.after.paymentMethod, 'Transferencia')
  assert.equal(result.after.status, 'Completado')
  assert.equal(result.after.detail, before.history[0].detail)
  assert.equal(result.after.date, before.history[0].date)
  assert.equal(result.state.agenda.teams[0].tasks[0].amount, '9500.5')
  assert.deepEqual(result.after.collection.confirmedBy, actor)
  assert.equal(result.after.collection.original.amount, '10000')
  assert.equal(result.after.collection.events.length, 2)
  assert.equal(collectionConfirmed(result.after), true)
  const rectified = manageCollection(result.state, await command(result.state, 'correct', { amount: '9600' }), actor)
  assert.equal(collectionConfirmed(rectified.after), true)
  assert.equal(rectified.after.collection.events.length, 3)
})

test('rechaza formularios obsoletos, doble confirmación y montos o medios inválidos', async () => {
  const { manageCollection } = await domain
  const state = fixture(), input = await command(state)
  for (const patch of [{ amount: '1.234' }, { amount: '-1' }, { amount: '0' }, { amount: '' }, { amount: 'Infinity' }, { amount: '1000000000' }, { paymentMethod: 'A confirmar' }, { paymentMethod: 'No aplica' }, { paymentMethod: 'otro' }, { action: 'delete' }, { note: 'x'.repeat(1001) }]) assert.throws(() => manageCollection(state, { ...input, ...patch }, actor))
  for (const patch of [{ amount: '500' }, { client: 'Otro cliente' }, { date: '2026-10-15' }, { status: 'Cancelado' }]) assert.throws(() => manageCollection(state, { ...input, base: { ...input.base, ...patch } }, actor), { statusCode: 409 })
  const result = manageCollection(state, input, actor)
  assert.throws(() => manageCollection(result.state, input, actor), { statusCode: 409 })
  const fresh = await command(result.state)
  assert.throws(() => manageCollection(result.state, fresh, actor), /ya fue confirmado/)
})

test('el guardado común no puede falsificar, borrar ni cambiar una cobranza gestionada', async () => {
  const { manageCollection } = await domain
  const state = fixture(), result = manageCollection(state, await command(state), actor)
  assert.throws(() => assertCompletedServices(result.state, state), { code: 'COLLECTION_PROTECTED' })
  assert.doesNotThrow(() => assertCompletedServices(result.state, state, { collectionCorrectionId: 'payment' }))
  const forbidden = structuredClone(result.state); forbidden.history[0].time = '11:00'
  assert.throws(() => assertCompletedServices(forbidden, state, { collectionCorrectionId: 'payment' }), { code: 'COMPLETED_SERVICE_LOCKED' })
  assert.throws(() => assertCompletedServices({ ...result.state, history: [] }, result.state), { code: 'COLLECTION_PROTECTED' })
  assert.throws(() => removeHistoryRecord(result.state, 'payment'), { code: 'COLLECTION_PROTECTED' })
  const pending = { ...result.after, status: 'Pendiente' }
  assert.throws(() => assertCompletedServices({ history: [{ ...pending, amount: '1' }] }, { history: [pending] }), { code: 'COLLECTION_PROTECTED' })
  assert.doesNotThrow(() => assertCompletedServices({ history: [{ ...pending, date: '2026-10-15' }] }, { history: [pending] }))
})

test('notificación por servicio, visible sin dashboard, persiste al consultar y desaparece al confirmar', async () => {
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const { manageCollection } = await domain
  const state = fixture(), args = { history: state.history, today: '2026-10-15', permissions: { collections: true } }
  const notices = selectDashboardNotifications(args)
  assert.equal(notices.length, 1)
  assert.deepEqual(notices[0].target, { type: 'collection', recordId: 'payment' })
  assert.deepEqual(selectDashboardNotifications(args), notices)
  assert.equal(selectDashboardNotifications({ ...args, permissions: {} }).length, 0)
  const corrected = manageCollection(state, await command(state, 'correct'), actor)
  assert.equal(selectDashboardNotifications({ ...args, history: corrected.state.history }).length, 1)
  const confirmed = manageCollection(corrected.state, await command(corrected.state), actor)
  assert.equal(selectDashboardNotifications({ ...args, history: confirmed.state.history }).length, 0)
})

test('permisos de consulta y gestión independientes; técnico no recibe trazas privadas', async () => {
  const { resolvedRolePermissions } = await import('../src/domain/access/permissions.mjs')
  const reader = { roleCode: 'custom', permissions: { collections: true } }
  assert.equal(userCan(reader, 'collections'), true)
  assert.equal(userCan(reader, 'collectionsManage'), false)
  assert.equal(userCan({ ...reader, permissions: { collectionsManage: true } }, 'collectionsManage'), false)
  assert.equal(userCan({ ...reader, permissions: { collections: true, collectionsManage: true } }, 'collectionsManage'), true)
  assert.equal(resolvedRolePermissions({ code: 'administrator' }).collectionsManage, true)
  assert.equal(resolvedRolePermissions({ code: 'user' }).collections, false)
  assert.equal(visibleStateForUser(fixture(), reader).history.length, 1)
  assert.equal(technicianSafeRecord({ ...fixture().history[0], collection: { status: 'confirmed' } }).collection, undefined)
})

test('varias jornadas generan una sola cobranza y rectifican sus importes en conjunto', async () => {
  const { manageCollection, collectionRecords } = await domain
  const state = fixture()
  state.history[0].serviceJourney = { id: 'payment', index: 1, total: 2 }
  state.history.push({ ...state.history[0], id: 'visit-2', sourceTaskId: 't2', date: '2026-10-15', serviceJourney: { id: 'payment', index: 2, total: 2 } })
  state.agenda.weekly['2026-10-15'] = { teams: [{ tasks: [{ historyId: 'visit-2', taskId: 't2', amount: '10000', paymentMethod: 'Efectivo' }] }] }
  assert.equal(collectionRecords(state.history).length, 1)
  const result = manageCollection(state, await command(state), actor)
  assert.deepEqual(result.recordIds, ['payment', 'visit-2'])
  assert.equal(result.state.history[1].amount, '9500.5')
  assert.equal(result.state.history[1].collection, undefined)
  assert.equal(result.state.agenda.weekly['2026-10-15'].teams[0].tasks[0].paymentMethod, 'Transferencia')
  assert.doesNotThrow(() => assertCompletedServices(result.state, state, { collectionCorrectionIds: result.recordIds }))
  const changed = structuredClone(result.state)
  changed.history[1].amount = '1'
  assert.throws(() => assertCompletedServices(changed, result.state), { code: 'COLLECTION_PROTECTED' })
  const old = structuredClone(state); old.history[0].date = '2026-10-13'
  assert.equal(collectionRecords(old.history).length, 0)
})

test('cancelar retira cobranzas pendientes, incluidas las rectificadas, y bloquea su gestión sin borrar trazas', async () => {
  const { manageCollection, collectionRecords } = await domain
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const initial = fixture()
  const corrected = manageCollection(initial, await command(initial, 'correct'), actor).state
  for (const source of [initial, corrected]) {
    const input = await command(source)
    for (const cancellation of [{ status: 'Cancelado' }, { technicalStatus: 'Cancelado' }]) {
      const state = structuredClone(source)
      Object.assign(state.history[0], cancellation)
      const snapshot = structuredClone(state)
      assert.deepEqual(collectionRecords(state.history), [])
      assert.deepEqual(selectDashboardNotifications({ history: state.history, today: '2026-10-16', permissions: { collections: true } }), [])
      assert.throws(() => manageCollection(state, input, actor), { statusCode: 404 })
      assert.deepEqual(state, snapshot)
    }
  }
  const paid = manageCollection(initial, await command(initial), actor).state
  paid.history[0].status = 'Cancelado'
  assert.equal(collectionRecords(paid.history).length, 1, 'Un pago recibido conserva su historial')
  assert.deepEqual(selectDashboardNotifications({ history: paid.history, today: '2026-10-16', permissions: { collections: true } }), [])
})

test('una cobranza desde la primera jornada vigente, aunque termine antes y se cancele la sobrante', async () => {
  const { collectionRecords, collectionService, manageCollection } = await domain
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const state = fixture(), base = { ...state.history[0], status: 'Pendiente' }
  state.history = [1, 2, 3].map(index => ({ ...base, id: index === 1 ? 'payment' : `visit-${index}`, sourceTaskId: `t${index}`, date: `2026-10-${13 + index}`, serviceJourney: { id: 'payment', index, total: 3 } }))
  const notices = today => selectDashboardNotifications({ history: state.history, today, permissions: { collections: true } })
  assert.equal(notices('2026-10-13').length, 0)
  assert.equal(notices('2026-10-14').length, 1)
  assert.equal(collectionRecords(state.history).length, 1)
  state.history[0].status = 'Avance registrado'
  state.history[1].status = 'Completado'
  state.history[2].status = 'Cancelado'
  assert.equal(notices('2026-10-15').length, 1)
  assert.equal(collectionService(state.history[0], state.history).date, '2026-10-14')
  state.history[0].status = 'Cancelado'
  state.history[1].status = 'Pendiente'
  assert.equal(notices('2026-10-14').length, 0)
  assert.equal(notices('2026-10-15').length, 1)
  assert.equal(collectionService(state.history[0], state.history).date, '2026-10-15')
  assert.equal(manageCollection(state, await command(state), actor).after.collection.status, 'confirmed')
  state.history[1].status = 'Cancelado'
  assert.deepEqual(collectionRecords(state.history), [])
  assert.deepEqual(notices('2026-10-16'), [])
})

test('la base normalizada conserva el historial de pagos al guardar y volver a leer', async () => {
  const fs = require('node:fs'), path = require('node:path')
  const { PGlite } = await import('@electric-sql/pglite')
  const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
  const { readNormalizedState, synchronizeNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
  const { manageCollection } = await domain
  const pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const before = fixture()
    before.reviews = []
    before.roles = [{ id: 'r', code: 'technician', name: 'Técnico' }]
    before.employees = [{ id: 'tech', roleId: 'r', name: 'Técnico' }]
    await insertShadowCandidate(pg, buildShadowCandidate(before))
    const result = manageCollection(before, await command(before), actor)
    result.state.revision = 2
    await synchronizeNormalizedState(pg, before, result.state)
    const read = await readNormalizedState(pg)
    assert.deepEqual(read.history[0].collection, result.after.collection)
    assert.equal(read.history[0].amount, '9500.5')
    assert.equal(read.agenda.teams[0].tasks[0].paymentMethod, 'Transferencia')
    // jsonb can reorder nested keys compared with the immediate API response.
    const second = manageCollection(read, await command(result.state, 'correct', { amount: '9700' }), actor)
    assert.equal(second.after.collection.events.length, 2)
    assert.doesNotThrow(() => assertCompletedServices(result.state, read))
  } finally { await pg.close() }
})
