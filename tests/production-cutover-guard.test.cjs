const test = require('node:test')
const assert = require('node:assert/strict')
const { buildShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { assertCertified, safeState } = require('../scripts/manage-normalized-production.cjs')

const state = {
  revision: 7,
  roles: [{ id: 'r', name: 'Técnico' }],
  employees: [{ id: 'e', roleId: 'r', name: 'Persona', passwordHash: 'secret' }],
  customers: [{ customerId: 'c', account: 'CLI-1', name: 'Cliente', fields: {} }],
  services: [{ id: 's', code: 'service', name: 'Servicio', estimatedMinutes: 60 }],
  vehicles: [], reviews: [],
  history: [{ id: 'h', sourceTaskId: 't', date: '2026-09-09', time: '09:00', estimatedMinutes: 60, status: 'Pendiente', customerId: 'c', serviceId: 's', teamId: 'team', technicianIds: ['e'] }],
  agenda: { date: '2026-09-09', weekly: {}, teams: [] },
  preferences: {}
}

test('production guard accepts only an exact, rolled-back staging certification', () => {
  const sourceFingerprint = buildShadowCandidate(state).analysis.sourceFingerprint
  const certification = { passed: true, rollback: true, stagingModified: false, productionModified: false, sourceRevision: 7, sourceFingerprint }
  assert.equal(assertCertified(state, certification), sourceFingerprint)
  assert.throws(() => assertCertified({ ...state, revision: 8 }, certification), { code: 'STALE_STAGING_CERTIFICATION' })
  assert.throws(() => assertCertified(state, { ...certification, rollback: false }), { code: 'STALE_STAGING_CERTIFICATION' })
})

test('post-cutover comparisons exclude credentials without mutating the source', () => {
  assert.deepEqual(safeState(state).employees, [{ id: 'e', roleId: 'r', name: 'Persona' }])
  assert.equal(state.employees[0].passwordHash, 'secret')
})
