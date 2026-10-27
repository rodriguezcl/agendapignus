const test = require('node:test')
const assert = require('node:assert/strict')
const { prepareCompletionCorrection: correct } = require('../api/_lib/completion-correction.cjs')
const policy = require('../api/_lib/completed-service-policy.cjs')
const zones = require('../api/_lib/alarm-zones.cjs')
const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const at = '2026-10-27T16:00:00Z'
const types = [{ id: 'alarm', name: 'Instalación de alarma' }, { id: 'other', name: 'Otro service' }]
const zone = { number: 1, name: 'Puerta', attribute: 'Demorada', sensor: 'Magnético cableado', sensorOther: '' }
const fixture = patch => ({ id: 'work', sourceTaskId: 'task', status: 'Pendiente', date: '2026-10-27', time: '09:30', serviceId: 'alarm', service: types[0].name, serviceTypes: types, technicalStatus: 'Reprogramación solicitada', technicianRequest: 'Reprogramación solicitada', technicalObservation: 'No se realizó', technicalReportedByName: 'Técnico', workCompletion: { items: types.map(t => ({ ...t, status: 'pending' })), at: '2026-10-27T15:00:00Z', byName: 'Técnico', management: { note: '-', byName: 'Administrador' } }, ...patch })
const state = record => ({ history: [record], customers: [], services: types, agenda: { weekly: [{ tasks: [{ taskId: 'task', historyId: 'work', ...record }] }] } })
const input = record => ({ recordId: record.id, base: record, completedIds: ['alarm', 'other'], reason: 'El técnico seleccionó reprogramar por error; ambos trabajos fueron realizados.', alarmZones: [zone, zones.emptyZone(2), zones.emptyZone(3)] })

test('corrección de reprogramación completa ambos trabajos, zonas y agenda; conserva informe y autor originales', () => {
  const before = fixture(), snapshot = structuredClone(before)
  const result = correct(state(before), input(before), admin, at)
  assert.equal(result.after.status, 'Completado')
  assert.equal(result.after.technicianRequest, '')
  assert.equal(result.after.technicalReportedByName, admin.name)
  assert.equal(result.after.completedAt, at)
  assert.deepEqual(result.after.alarmZones.zones, [zone])
  assert.equal(result.after.workCompletion.items.every(t => t.status === 'completed'), true)
  assert.equal(result.after.workCompletion.corrections[0].previous.technicalReportedByName, 'Técnico')
  assert.deepEqual(result.after.workCompletion.corrections[0].previousResult.items, before.workCompletion.items)
  assert.equal(result.state.agenda.weekly[0].tasks[0].technicalStatus, 'Completado')
  assert.deepEqual(before, snapshot)
  assert.throws(() => policy.assertCompletedServices(result.state, state(before)), { statusCode: 409 })
  assert.doesNotThrow(() => policy.assertCompletedServices(result.state, state(before), result.policyOptions))
})
test('rechaza permisos, desactualización, motivo ausente, trabajos sin confirmar y zonas incompletas', () => {
  const before = fixture(), source = state(before), valid = input(before)
  assert.throws(() => correct(source, valid, { ...admin, roleCode: 'technician' }, at), { statusCode: 403 })
  assert.throws(() => correct(source, { ...valid, base: { ...before, detail: 'antiguo' } }, admin, at), { statusCode: 409 })
  for (const patch of [{ reason: '' }, { reason: 'x'.repeat(1001) }, { completedIds: ['alarm'] }, { completedIds: ['alarm', 'alarm'] }, { alarmZones: [] }, { alarmZones: [zones.emptyZone(1)] }]) assert.throws(() => correct(source, { ...valid, ...patch }, admin, at), { statusCode: 400 })
  for (const patch of [{ status: 'Completado' }, { status: 'Cancelado' }, { vehicleControl: true }, { serviceJourney: { id: 'journey' } }, { awaitingConfirmation: true }]) { const before = fixture(patch); assert.throws(() => correct(state(before), input(before), admin, at), { statusCode: 409 }) }
})
test('conserva zonas ya confirmadas en SoftGuard y evita repetir una corrección guardada', () => {
  const before = fixture({ alarmZones: { version: 1, complete: true, zones: [zone], reportedById: 'tech', softguard: { completedAt: at } } })
  const result = correct(state(before), input(before), admin, at)
  assert.deepEqual(result.after.alarmZones, before.alarmZones)
  assert.throws(() => correct(result.state, input(before), admin, at), { statusCode: 409 })
})
test('recupera anulación automática para revisión; nunca confirma pago ni deshace anulación manual', () => {
  const cancel = { automatic: true, original: { amount: '100', paymentMethod: 'Efectivo' } }
  const before = fixture({ amount: '0', paymentMethod: 'No aplica', collectionCancellation: cancel })
  const result = correct(state(before), input(before), admin, at)
  assert.equal(result.after.amount, '100'); assert.ok(result.after.collectionReview); assert.equal(result.after.collectionCancellation, undefined)
  assert.equal(result.after.collection, undefined)
  assert.deepEqual(result.after.workCompletion.corrections[0].previousCancellation, cancel)
  const manual = fixture({ collectionCancellation: { ...cancel, automatic: false }, amount: '0' })
  assert.deepEqual(correct(state(manual), input(manual), admin, at).after.collectionCancellation, manual.collectionCancellation)
})
