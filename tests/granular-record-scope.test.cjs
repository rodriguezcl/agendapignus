const test = require('node:test')
const assert = require('node:assert/strict')
const permissions = (...keys) => ({ id: 'user', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) } })

test('el alcance de escritura intersecta consulta, asignación y seguimiento CCTV', async () => {
  const { canReadRecord, canWriteRecord } = await import('../src/domain/access/record-scope.mjs')
  const customer = { customerId: 'cctv', account: 'PIG-1', cctvService: true }
  const record = { customerId: 'cctv', technicianIds: ['user'] }
  const user = permissions('scope.services.read.cctv', 'scope.services.write.assigned')
  assert.equal(canReadRecord(record, user, [customer]), true)
  assert.equal(canWriteRecord(record, user, [customer]), true)
  assert.equal(canWriteRecord({ ...record, technicianIds: ['another'] }, user, [customer]), false)
  assert.equal(canWriteRecord(record, user, [{ ...customer, cctvService: false }]), false)
  assert.equal(canWriteRecord({ ...record, supervisorVisible: true }, user), true)
  assert.equal(canWriteRecord({ ...record, supervisorVisible: true }, user, [{ ...customer, cctvService: false }]), false)
  assert.equal(canWriteRecord(record, permissions('scope.services.write.assigned', 'scope.services.write.cctv'), [customer]), false)
  assert.equal(canWriteRecord(record, { roleCode: 'supervisor' }), true, 'el alcance legacy se conserva en sus flujos actuales')
})

test('finalización anticipada requiere permiso separado y conserva controles/confirmación', async () => {
  const { canCompleteHistoryRecord } = await import('../src/features/history/application/history-action-permissions.mjs')
  const record = { date: '2026-10-20', time: '10:00' }
  const now = '2026-10-20T12:00:00Z'
  const ordinary = key => key === 'history.complete'
  const early = key => ['history.complete', 'history.completeEarly'].includes(key)
  assert.equal(canCompleteHistoryRecord(record, ordinary, now), false)
  assert.equal(canCompleteHistoryRecord(record, early, now), true)
  assert.equal(canCompleteHistoryRecord({ ...record, date: '2026-10-19' }, ordinary, now), true)
  assert.equal(canCompleteHistoryRecord({ ...record, vehicleControl: true }, early, now), false)
  assert.equal(canCompleteHistoryRecord({ ...record, awaitingConfirmation: true }, early, now), false)
  assert.equal(canCompleteHistoryRecord(record, () => false, now), false)
})

test('delegación utiliza catálogo mínimo confirmado por servidor y protege cuentas administrativas', async () => {
  const { canDelegateRole, canManageEmployeeAccount } = await import('../src/domain/access/role-delegation.mjs')
  const user = { ...permissions('employees.view', 'employees.role'), roleCode: 'coordinator' }
  assert.equal(canDelegateRole(user, { code: 'user', assignable: true }), true)
  assert.equal(canDelegateRole(user, { code: 'user', assignable: false }), false)
  assert.equal(canDelegateRole(user, { code: 'administrator', assignable: true }), false)
  assert.equal(canDelegateRole(user, { code: 'user' }), false, 'no se adivinan permisos de un rol incompleto')
  assert.equal(canManageEmployeeAccount(user, { roleId: 'admin' }, [{ id: 'admin', code: 'administrator' }]), false)
  assert.equal(canManageEmployeeAccount(user, { roleId: 'user' }, [{ id: 'user', code: 'user' }]), true)
  const restricted = permissions('history.view', 'records.read', 'scope.services.read.assigned')
  assert.equal(canDelegateRole(restricted, { permissions: { __catalogV2: true, 'history.view': true, 'records.read': true } }), false)
  assert.equal(canDelegateRole(restricted, { permissions: { __catalogV2: true, 'history.view': true, 'records.read': true, 'scope.services.read.assigned': true } }), true)
})

test('edición parcial del historial conserva campos normalizados y separa notas, contacto y vínculo', async () => {
  const { permittedHistoryEditPatch } = await import('../src/features/history/application/history-action-permissions.mjs')
  const initialDraft = { estimatedMinutes: 90, teamId: '', detail: '', internalNote: '', internalChecklist: [], address: '', phone: '' }
  const notes = permittedHistoryEditPatch({ record: {}, initialDraft, draft: { ...initialDraft, internalNote: 'Preparar material' } }, key => key === 'planning.notes')
  assert.deepEqual(notes, { internalNote: 'Preparar material' })
  const contact = permittedHistoryEditPatch({ record: {}, initialDraft, draft: { ...initialDraft, address: 'Dirección corregida', internalNote: 'No autorizado' } }, key => key === 'history.edit')
  assert.deepEqual(contact, { address: 'Dirección corregida' })
  const customerPatch = { customerId: 'c1', client: 'PIG-1 CLIENTE', address: 'Desde ficha', phone: '555', subscriberReservation: false, reservationLinkedAt: '2026-10-20' }
  const linked = permittedHistoryEditPatch({ record: { subscriberReservation: true }, initialDraft, draft: initialDraft, customerPatch }, key => key === 'planning.reservation.link')
  assert.deepEqual(linked, customerPatch)
  const rejected = permittedHistoryEditPatch({ record: { subscriberReservation: true }, initialDraft, draft: initialDraft, customerPatch }, () => false)
  assert.deepEqual(rejected, {})
})

test('corrección de categoría usa permiso granular y conserva el control legacy', async () => {
  const { correctServiceCategory } = await import('../src/domain/history/category-correction.mjs')
  const record = { id: 'record', serviceId: 'old', service: 'Anterior', status: 'Completado', amount: '1234', technicalObservation: 'Conservar informe' }
  const state = { history: [record], services: [{ id: 'new', name: 'Nueva categoría', status: 'Activo' }] }
  const input = { recordId: record.id, base: record, serviceIds: ['new'], reason: 'Corregir clasificación' }
  const user = { ...permissions('history.view', 'records.read', 'history.category'), roleCode: 'operator' }
  const corrected = correctServiceCategory(state, input, user)
  assert.equal(corrected.after.service, 'Nueva categoría')
  assert.equal(corrected.after.amount, record.amount)
  assert.equal(corrected.after.technicalObservation, record.technicalObservation)
  assert.throws(() => correctServiceCategory(state, input, permissions('history.view', 'records.read')), { statusCode: 403 })
  assert.throws(() => correctServiceCategory(state, input, { roleCode: 'operator' }), { statusCode: 403 })
  assert.equal(correctServiceCategory(state, input, { roleCode: 'administrator' }).after.service, 'Nueva categoría')
})
