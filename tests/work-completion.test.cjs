const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../api/_lib/work-completion.cjs')
const policy = require('../api/_lib/completed-service-policy.cjs')
const { manageWorkCompletion } = require('../api/_lib/work-completion-management.cjs')
const actor = { id: 'tech', name: 'Técnico' }, admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const at = '2026-10-26T15:00:00Z'
const types = [{ id: 4, name: 'Service de alarma' }, { id: 5, name: 'Service de cámaras' }]
const fixture = (patch = {}) => ({ id: 'work', date: '2026-10-26', sourceTaskId: 'task', client: 'PIG-6299 Cliente', status: 'Pendiente', serviceId: 4, service: types[0].name, serviceTypes: types, amount: '83160', paymentMethod: 'Efectivo', technicianIds: ['tech'], ...patch })
const report = (record, statuses = ['completed', 'pending']) => model.applyResults(record, { ...record, status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Alarma reparada; cámaras requieren otra visita.', completedAt: at }, types.map((t, i) => ({ id: t.id, status: statuses[i] })), actor, at)

test('cada trabajo exige resultado explícito; acepta todos realizados sin alterar términos', () => {
  const record = fixture()
  for (const input of [undefined, [], [null, null], [{ id: 4, status: 'completed' }], [{ id: 4, status: 'completed' }, { id: 4, status: 'pending' }], [{ id: 4, status: 'completed' }, { id: 5, status: 'inventado' }]]) assert.throws(() => model.results(record, input, actor, at), { statusCode: 400 })
  const next = report(record, ['completed', 'completed'])
  assert.deepEqual(next.serviceTypes, types); assert.equal(next.amount, record.amount); assert.equal(next.collectionReview, undefined)
  assert.equal(next.workCompletion.items.length, 2); assert.equal(next.workCompletion.byId, 'tech')
  assert.equal(model.results({ serviceId: 4 }, undefined, actor, at), null)
})

test('alarma sin cargo terminada y cámaras pendientes: no genera deuda y conserva antecedentes', async () => {
  const record = fixture({ serviceCharges: [{ id: 4, amount: '0' }, { id: 5, amount: '83160' }] }), snapshot = structuredClone(record)
  const next = report(record)
  assert.deepEqual(record, snapshot); assert.equal(next.amount, '0'); assert.equal(next.paymentMethod, 'No aplica')
  assert.equal(next.status, 'Completado'); assert.deepEqual(next.serviceTypes, [types[0]])
  assert.equal(next.workCompletion.originalAmount, '83160'); assert.deepEqual(next.workCompletion.originalCharges, record.serviceCharges)
  assert.equal(next.collectionCancellation.original.amount, '83160'); assert.equal(next.completedAt, at)
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const notices = selectDashboardNotifications({ history: [next], today: '2026-10-26', user: admin, permissions: { collections: true } })
  assert.equal(notices.some(n => n.target.type === 'collection'), false)
  const { collectionSegments } = await import('../src/domain/collections/collection-segments.mjs')
  assert.equal(collectionSegments([next], { today: '2026-10-26' })[0].pending.total, 0)
  assert.doesNotThrow(() => policy.assertCompletedServices({ history: [next] }, { history: [record] }, { workCompletionWriteId: record.id }))
})

test('distribución explícita cobra sólo lo realizado; ninguno realizado no figura completado', () => {
  const record = fixture({ amount: '100', serviceCharges: [{ id: 4, amount: '25.50' }, { id: 5, amount: '74.50' }] })
  const next = report(record)
  assert.equal(next.amount, '25.5'); assert.deepEqual(next.serviceCharges, [{ id: 4, amount: '25.50' }]); assert.equal(next.collectionReview, undefined)
  const none = report(record, ['pending', 'pending'])
  assert.equal(none.status, 'Requiere revisión'); assert.equal(none.completedAt, ''); assert.equal(none.amount, '0')
  for (const rows of [[null, null], [{ id: 4, amount: '-1' }, { id: 5, amount: '101' }], [{ id: 4, amount: '' }, { id: 5, amount: '100' }], [{ id: 4, amount: '25' }, { id: 5, amount: '76' }]]) assert.throws(() => model.validateCharges({ ...record, serviceCharges: rows }), { statusCode: 400 })
})

test('sin distribución el importe queda en revisión y exige rectificación explícita antes del cobro', async () => {
  const { manageCollection, collectionBase, collectionPending } = await import('../src/domain/collections/collections.mjs')
  const next = report(fixture()), state = { history: [next] }
  assert.ok(next.collectionReview); assert.equal(next.amount, '83160'); assert.equal(collectionPending(next), false)
  const input = { recordId: next.id, base: collectionBase(next), amount: '2000', paymentMethod: 'Efectivo' }
  assert.throws(() => manageCollection(state, { ...input, action: 'confirm' }, admin), { statusCode: 409 })
  assert.throws(() => manageCollection(state, { ...input, action: 'correct' }, admin), /motivo/)
  const corrected = manageCollection(state, { ...input, action: 'correct', note: 'Sólo se cobra la reparación realizada' }, admin, at)
  assert.equal(corrected.after.amount, '2000'); assert.equal(corrected.after.collectionReview, undefined)
  assert.equal(corrected.after.collection.original.amount, '83160'); assert.equal(corrected.after.collection.status, 'pending')
  assert.doesNotThrow(() => policy.assertCompletedServices(corrected.state, state, { collectionCorrectionId: next.id }))
})

test('anulación conserva traza, sincroniza todas las jornadas y no admite pagos confirmados', async () => {
  const { manageCollection, collectionBase } = await import('../src/domain/collections/collections.mjs')
  const root = report(fixture()), state = { history: [root] }, input = { recordId: root.id, base: collectionBase(root), action: 'void', note: 'Trabajo cobrado no realizado' }
  const result = manageCollection(state, input, admin, at)
  assert.equal(result.after.amount, '0'); assert.equal(result.after.collectionCancellation.original.amount, '83160')
  assert.throws(() => manageCollection(result.state, { ...input, base: collectionBase(result.after) }, admin), /anulada/)
  assert.throws(() => manageCollection(state, { ...input, note: '' }, admin), /motivo/)
  assert.throws(() => manageCollection(state, { ...input, base: {} }, admin), { statusCode: 409 })
  const paid = { ...root, collection: { status: 'confirmed', confirmedAt: at } }
  assert.throws(() => manageCollection({ history: [paid] }, { ...input, base: collectionBase(paid) }, admin), /confirmado/)
  const journey = { ...fixture(), serviceJourney: { id: 'work', index: 1 } }, second = { ...journey, id: 'second', sourceTaskId: 'task2', serviceJourney: { id: 'work', index: 2 } }
  const journeyState = { history: [journey, second], agenda: { teams: [{ tasks: [{ taskId: 'task2', amount: '83160' }] }] } }
  const cancelled = manageCollection(journeyState, { ...input, base: collectionBase(journey) }, admin)
  assert.equal(cancelled.state.history[1].amount, '0'); assert.equal(cancelled.state.agenda.teams[0].tasks[0].amount, '0')
})

test('pago recibido se conserva aun cuando requiere revisión; varias jornadas retienen planificación y cobranza única', async () => {
  const paid = fixture({ collection: { status: 'confirmed', confirmedAt: at, events: [] }, serviceCharges: [{ id: 4, amount: '0' }, { id: 5, amount: '83160' }] })
  const next = report(paid)
  assert.deepEqual(next.collection, paid.collection); assert.equal(next.amount, '83160'); assert.ok(next.collectionReview); assert.equal(next.collectionCancellation, undefined)
  const { collectionSegments } = await import('../src/domain/collections/collection-segments.mjs')
  assert.equal(collectionSegments([next], { today: '2026-10-26' })[0].confirmed.total, 83160)
  const root = fixture({ serviceJourney: { id: 'work', index: 1 } }), second = { ...root, id: 'second', serviceJourney: { id: 'work', index: 2 } }
  const partial = report(second)
  assert.equal(partial.status, 'Requiere revisión'); assert.deepEqual(partial.serviceTypes, types)
  assert.ok(model.applyToHistory([root, second], second, partial)[0].collectionReview)
})

test('traza protegida, cierre genérico bloqueado y gestión con permiso y control de concurrencia', () => {
  const before = fixture(), next = report(before), state = { history: [next], customers: [] }
  assert.throws(() => policy.assertCompletedServiceChange(before, next), /resultado por trabajo/)
  assert.throws(() => policy.assertCompletedServiceChange(before, { ...before, status: 'Completado' }), /varios trabajos/)
  assert.throws(() => policy.assertCompletedServices({ history: [] }, state), /informe por trabajo/)
  assert.throws(() => require('../api/_lib/history-record-removal.cjs').removeHistoryRecord(state, next.id), /informe por trabajo/)
  const input = { recordId: next.id, reportedAt: next.workCompletion.at, note: 'Coordinado desde Ticket 1000015 para la próxima visita' }
  assert.throws(() => manageWorkCompletion(state, input, { ...actor, roleCode: 'technician' }), { statusCode: 403 })
  assert.throws(() => manageWorkCompletion(state, { ...input, reportedAt: 'stale' }, admin), { statusCode: 409 })
  const result = manageWorkCompletion(state, input, admin, at)
  assert.deepEqual(result.after.workCompletion.items, next.workCompletion.items); assert.equal(result.after.workCompletion.management.byId, 'admin')
  assert.throws(() => manageWorkCompletion(result.state, input, admin), { statusCode: 409 })
  assert.doesNotThrow(() => policy.assertCompletedServices(result.state, state, { workCompletionWriteId: next.id }))
})

test('proyección técnica oculta antecedentes financieros; transporte conserva resultados', async () => {
  const next = report(fixture())
  const safe = require('../api/_lib/core.cjs').technicianSafeRecord(next)
  assert.equal(safe.amount, undefined); assert.equal(safe.collectionReview, undefined); assert.equal(safe.workCompletion.originalAmount, undefined)
  assert.deepEqual(safe.workCompletion.items, next.workCompletion.items)
  const { submitTechnicianStatus } = await import('../src/infrastructure/http/technician-status.mjs')
  const workResults = types.map(t => ({ id: t.id, status: 'completed' }))
  await submitTechnicianStatus({ recordId: next.id, type: 'Completado', observation: 'Realizado', workResults, fetcher: async (_url, opts) => { assert.deepEqual(JSON.parse(opts.body).workResults, workResults); return { ok: true, json: async () => ({ record: next }) } } })
})

test('una instalación pendiente no exige zonas ni queda como instalación completada', () => {
  const record = fixture({ serviceTypes: [{ id: 4, name: 'Instalación de alarma' }, types[1]], service: 'Instalación de alarma' })
  const next = model.applyResults(record, { ...record, status: 'Completado', technicalStatus: 'Completado' }, [{ id: 4, status: 'pending' }, { id: 5, status: 'completed' }], actor, at)
  const zones = require('../api/_lib/alarm-zones.cjs')
  assert.equal(zones.installation(next), false)
  assert.doesNotThrow(() => zones.reportZones(next, 'Completado', undefined, actor, at))
  assert.equal(next.service, 'Service de cámaras')
})

test('cambiar el desglose se detecta aunque no cambie el total; descartar recupera los valores', async () => {
  const { serviceHasChanges, restoreSavedService } = await import('../src/domain/agenda/service-changes.mjs')
  const before = fixture({ serviceCharges: [{ id: 4, amount: '0' }, { id: 5, amount: '83160' }] })
  const changed = { ...before, serviceCharges: [{ id: 4, amount: '1000' }, { id: 5, amount: '82160' }] }
  assert.equal(serviceHasChanges(changed, before), true)
  assert.equal(serviceHasChanges(restoreSavedService(changed, before), before), false)
  assert.equal(restoreSavedService(changed, fixture()).serviceCharges, undefined)
})

test('avisos distinguen importe en revisión y pendiente de coordinación; gestionar no cambia resultados', async () => {
  const { selectDashboardNotifications } = await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const record = report(fixture()), args = { history: [record], today: '2026-10-26', user: admin }
  const notices = selectDashboardNotifications(args)
  assert.ok(notices.some(n => n.id === 'collection:work' && n.title.startsWith('Revisar importe')))
  assert.ok(notices.some(n => n.id === 'pending-work:work'))
  const managed = manageWorkCompletion({ history: [record], customers: [] }, { recordId: 'work', reportedAt: at, note: 'Visita coordinada mediante ticket' }, admin, at)
  assert.equal(selectDashboardNotifications({ ...args, history: managed.state.history }).some(n => n.id === 'pending-work:work'), false)
  assert.deepEqual(managed.after.workCompletion.items, record.workCompletion.items)
  const hidden = require('../api/_lib/granular-read-policy.cjs').sanitizeService(managed.after, { permissions: { __catalogV2: true, 'records.read': true, 'history.edit': true, 'history.view': true } })
  assert.equal(hidden.workCompletion.originalAmount, undefined); assert.equal(hidden.workCompletion.originalCharges, undefined)
})
