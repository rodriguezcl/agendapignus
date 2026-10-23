const test = require('node:test')
const assert = require('node:assert/strict')
const domain = require('../api/_lib/tickets.cjs')
const technician = { id: 'tech-1', roleCode: 'custom', permissions: { __catalogV2: true, 'tickets.view': true, 'tickets.fromService': true, 'records.read': true, 'technical.view': true, 'technical.history': true, 'scope.services.read': 'all' } }
const item = { id: 'ticket-1', serviceIds: ['visit-1'], createdById: 'operator', requesterId: 'operator', participantIds: [], areaId: '' }
const state = { history: [{ id: 'visit-1', customerId: 'client-1', technicianIds: ['tech-1'], status: 'Pendiente' }, { id: 'visit-2', customerId: 'client-1', technicianIds: ['tech-2'], status: 'Pendiente' }], customers: [{ customerId: 'client-1', account: 'PIG-1' }] }

test('Ticket asociado: un técnico solo accede al caso vinculado a su visita asignada y legible', () => {
  assert.equal(domain.visible(item, technician, state, domain.defaultConfig()), true)
  assert.equal(domain.visible({ ...item, serviceIds: ['visit-2'] }, technician, state, domain.defaultConfig()), false)
  assert.equal(domain.visible({ ...item, serviceIds: [] }, technician, state, domain.defaultConfig()), false)
  assert.equal(domain.visible(item, { ...technician, id: 'tech-2' }, state, domain.defaultConfig()), false)
  assert.equal(domain.visible(item, { ...technician, permissions: { ...technician.permissions, 'tickets.fromService': false } }, state, domain.defaultConfig()), false)
  assert.equal(domain.visible(item, { ...technician, permissions: { ...technician.permissions, 'tickets.view': false } }, state, domain.defaultConfig()), false)
  assert.equal(domain.visible(item, technician, { ...state, history: [{ ...state.history[0], awaitingConfirmation: true }] }, domain.defaultConfig()), false)
})
