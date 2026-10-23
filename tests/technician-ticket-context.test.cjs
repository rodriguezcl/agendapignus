const test = require('node:test')
const assert = require('node:assert/strict')
const { visibleStateForUser, visibleTechnicianStateForUser, technicianSafeRecord } = require('../api/_lib/core.cjs')
const { sanitizeService } = require('../api/_lib/granular-read-policy.cjs')
const { restoreHidden } = require('../api/_lib/granular-write-policy.cjs')

const followup = {
  id: 'followup:shared', createdById: 'tech-1', assigneeId: 'support',
  description: 'Observación privada del primer técnico',
  events: [{ byId: 'tech-1', note: 'Información privada de la solicitud' }]
}
const record = {
  id: 'shared', customerId: 'customer-1', date: '2999-01-01', status: 'Pendiente',
  technicianIds: ['tech-1', 'tech-2'], technicalObservation: 'Informe operativo compartido',
  sourceTicketId: 'complaint-1', ticketNumber: '1000001', ticketResolution: { resolved: false, ticketIds: ['complaint-1'] },
  followup
}
const granular = {
  __catalogV2: true, 'tickets.view': true, 'tickets.fromService': true,
  'records.read': true, 'technical.view': true, 'technical.history': true, 'service.documents.read': true
}

function context(permissions) {
  const role = { id: 'technical-role', code: 'technician', name: 'Técnico', permissions }
  const employees = ['tech-1', 'tech-2'].map(id => ({ id, name: id, roleId: role.id, status: 'Activo' }))
  const user = { ...employees[1], role: role.name, roleCode: role.code, permissions }
  return { user, state: {
    revision: 1, roles: [role], employees, vehicles: [], services: [], customers: [{ customerId: 'customer-1', account: 'PIG-1' }],
    agenda: {}, preferences: {}, history: [structuredClone(record)]
  } }
}

for (const [label, permissions] of [['heredado', {}], ['granular', granular]]) {
  test(`Estado ${label}: compartir visita no expone la solicitud del otro técnico`, () => {
    const { user, state } = context(permissions)
    for (const project of [visibleStateForUser, visibleTechnicianStateForUser]) {
      const hidden = project(state, user).history[0]
      assert.equal(hidden.followup, undefined)
      assert.equal(hidden.hasFollowup, true)
      assert.equal(hidden.technicalObservation, record.technicalObservation)
      assert.equal(hidden.sourceTicketId, record.sourceTicketId, 'se conserva el reclamo que debe atender en su visita')
      assert.equal(JSON.stringify(hidden).includes(followup.description), false)
      const own = project(state, { ...user, id: 'tech-1' }).history[0]
      assert.deepEqual(own.followup, followup)
      assert.equal(own.hasFollowup, undefined)
    }
    assert.deepEqual(state.history[0].followup, followup, 'la proyección no modifica los datos guardados')
  })
}

test('La asignación directa permite consultar la solicitud y los IDs numéricos se comparan sin nombres', () => {
  const assigned = { ...record, followup: { ...followup, assigneeId: 42 } }
  const user = { id: '42', name: 'Otra persona', roleCode: 'technician', permissions: granular }
  assert.deepEqual(sanitizeService(assigned, user).followup, assigned.followup)
  assert.deepEqual(technicianSafeRecord(assigned, user).followup, assigned.followup)
  const sameName = { ...user, id: 'different', name: 'tech-1' }
  assert.equal(sanitizeService(assigned, sameName).followup, undefined)
  assert.equal(technicianSafeRecord(assigned, sameName).hasFollowup, true)
})

test('El historial de otra visita no revela referencias ni resolución de un ticket ajeno', () => {
  const { user, state } = context({})
  const previous = { ...record, id: 'previous', date: '2026-10-01', status: 'Completado', technicianIds: ['tech-1'] }
  state.history.push(previous)
  const visible = visibleStateForUser(state, user).history.find(item => item.id === previous.id)
  assert.ok(visible, 'se conserva el antecedente operativo del cliente')
  for (const hidden of [visible, sanitizeService(previous, { ...user, permissions: granular })]) {
    assert.equal(hidden.followup, undefined)
    assert.equal(hidden.hasFollowup, true)
    assert.equal(hidden.sourceTicketId, undefined)
    assert.equal(hidden.ticketNumber, undefined)
    assert.equal(hidden.ticketResolution, undefined)
    assert.equal(hidden.technicalObservation, record.technicalObservation)
  }
})

test('Administración y soporte conservan su alcance aunque también realicen servicios técnicos', () => {
  for (const roleCode of ['administrator', 'coordinator']) {
    const user = { id: 'support', roleCode, technicalEnabled: true, permissions: granular }
    assert.deepEqual(sanitizeService(record, user).followup, followup)
    assert.deepEqual(technicianSafeRecord(record, user).followup, followup)
    assert.equal(sanitizeService(record, user).sourceTicketId, record.sourceTicketId)
  }
  const { state } = context({})
  state.roles.push({ id: 'support-role', code: 'coordinator', name: 'Soporte', permissions: {} })
  state.employees.push({ id: 'support', name: 'Soporte', roleId: 'support-role', technicalEnabled: true })
  state.history[0].technicianIds.push('support')
  state.history[0].followup.assigneeId = 'someone-else'
  const projected = visibleTechnicianStateForUser(state, { id: 'support', roleCode: 'coordinator', technicalEnabled: true })
  assert.deepEqual(projected.history[0].followup, state.history[0].followup)
})

test('La respuesta técnica sin identidad no revela una solicitud privada', () => {
  const visible = technicianSafeRecord(record)
  assert.equal(visible.followup, undefined)
  assert.equal(visible.hasFollowup, true)
})

test('Al guardar una proyección se conserva el seguimiento oculto sin persistir el marcador de interfaz', () => {
  const user = { id: 'tech-2', roleCode: 'technician', permissions: granular }
  const visible = sanitizeService(record, user)
  const restored = restoreHidden(visible, record, visible)
  assert.deepEqual(restored.followup, followup)
  assert.equal(Object.hasOwn(restored, 'hasFollowup'), false)
})
