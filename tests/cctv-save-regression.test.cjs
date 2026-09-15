const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeStateForSave, auditChanges, visibleStateForUser } = require('../api/_lib/core.cjs')

function fixture() {
  return {
    roles: [], employees: [], services: [], vehicles: [], history: [], reviews: [],
    customers: Array.from({ length: 1223 }, (_, i) => ({ customerId: `c-${i}`, account: `CLI-${i}`, kind: 'client', name: `CLIENTE ${i}` })),
    agenda: { teams: [], weekly: {} }, preferences: { theme: 'light' }
  }
}

test('saving a new service does not migrate 1223 legacy CCTV flags or audit unrelated customers', () => {
  const current = fixture()
  const edited = structuredClone(current)
  edited.history.push({ id: 'new-service', customerId: 'c-0', date: '2099-01-05', status: 'Pendiente', detail: 'Nuevo servicio' })
  const saved = normalizeStateForSave(edited, current)
  assert.deepEqual(saved.customers, current.customers)
  assert.equal(auditChanges(current.customers, saved.customers, 'customerId', 'Cliente', {}).length, 0)
  assert.equal(auditChanges(current.history, saved.history, 'id', 'Servicio', {}).length, 1)
})

test('explicit CCTV selection and removal remain persistent and control Supervisor visibility', () => {
  const current = fixture()
  current.history = [{ id: 'h', customerId: 'c-0' }]
  const enabled = structuredClone(current)
  enabled.customers[0].cctvService = true
  const saved = normalizeStateForSave(enabled, current)
  assert.equal(auditChanges(current.customers, saved.customers, 'customerId', 'Cliente', {}).length, 1)
  assert.equal(visibleStateForUser(saved, { roleCode: 'supervisor' }).history.length, 1)
  const disabled = structuredClone(saved)
  disabled.customers[0].cctvService = false
  const removed = normalizeStateForSave(disabled, saved)
  assert.equal(removed.customers[0].cctvService, false)
  assert.equal(visibleStateForUser(removed, { roleCode: 'supervisor' }).history.length, 0)
  assert.equal(auditChanges(saved.customers, removed.customers, 'customerId', 'Cliente', {}).length, 1)
})
