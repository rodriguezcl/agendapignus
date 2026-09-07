const test = require('node:test')
const assert = require('node:assert/strict')
const { applyServiceCatalogOperation } = require('../api/_lib/service-catalog-operation.cjs')

const service = { id: 'service-1', code: 'service-1', category: 'service', name: 'Mantenimiento', description: '', estimatedMinutes: 60, status: 'Activo' }

test('el catálogo aplica altas, ediciones y estados como operaciones de un registro', () => {
  const state = { services: [service], history: [], agenda: {} }
  const created = applyServiceCatalogOperation(state, {
    operation: 'create',
    service: { id: 'service-2', code: 'service-2', category: 'service', name: 'Visita', description: '', estimatedMinutes: 30, status: 'Activo' }
  })
  assert.equal(created.services.length, 2)
  const updated = applyServiceCatalogOperation({ ...state, services: created.services }, {
    operation: 'update', serviceId: 'service-1', base: service,
    service: { ...service, name: 'Mantenimiento preventivo', estimatedMinutes: 45 }
  })
  assert.equal(updated.service.name, 'Mantenimiento preventivo')
  assert.equal(updated.service.estimatedMinutes, 45)
  const toggled = applyServiceCatalogOperation({ ...state, services: updated.services }, { operation: 'toggle-status', serviceId: 'service-1', base: updated.service })
  assert.equal(toggled.service.status, 'Inactivo')
})

test('una baja referenciada se vuelve inactiva y una baja libre se elimina', () => {
  const referenced = applyServiceCatalogOperation({ services: [service], history: [{ serviceId: service.id }], agenda: {} }, { operation: 'delete', serviceId: service.id, base: service })
  assert.equal(referenced.outcome, 'deactivated')
  assert.equal(referenced.service.status, 'Inactivo')
  const removed = applyServiceCatalogOperation({ services: [service], history: [], agenda: {} }, { operation: 'delete', serviceId: service.id, base: service })
  assert.equal(removed.outcome, 'deleted')
  assert.deepEqual(removed.services, [])
})

test('rechaza una edición cuando el mismo servicio cambió en otra sesión', () => {
  const current = { ...service, description: 'Cambio remoto' }
  assert.throws(() => applyServiceCatalogOperation({ services: [current], history: [], agenda: {} }, {
    operation: 'update', serviceId: service.id, base: service, service: { ...service, name: 'Cambio local' }
  }), error => error.statusCode === 409 && error.code === 'SERVICE_WRITE_CONFLICT')
})
