const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCutoverManifest, SCHEMA_CONTRACT } = require('../api/_lib/normalization-cutover.cjs')
const { buildShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { stagingCertificationFor } = require('../scripts/plan-normalization-cutover.cjs')

function fixture() {
  return { revision: 9, roles: [{ id: 1, name: 'Técnico' }], employees: [{ id: 2, roleId: 1, name: 'Persona', passwordHash: 'SECRET' }],
    customers: [{ customerId: 'c', account: 'CLI-1', name: 'Cliente', fields: {} }], services: [{ id: 3, code: 'service', name: 'Servicio', estimatedMinutes: 60 }], vehicles: [], reviews: [],
    history: [{ id: 'h', sourceTaskId: 't', date: '2026-09-09', time: '09:00', estimatedMinutes: 60, status: 'Pendiente', customerId: 'c', serviceId: 3, teamId: 'team', technicianIds: [2] }],
    agenda: { date: '2026-09-09', teams: [], weekly: {} }, preferences: {} }
}

test('cutover manifest is deterministic, credential-free and only awaits the staging rollback drill', () => {
  const state = fixture(), first = buildCutoverManifest(state, { activeSessions: 2 }), second = buildCutoverManifest(structuredClone(state), { activeSessions: 2 })
  assert.deepEqual(first, second)
  assert.equal(first.schemaContract, SCHEMA_CONTRACT)
  assert.equal(first.sourceRevision, 9)
  assert.equal(first.safeToPrepareMigration, true)
  assert.equal(first.readyForCutover, false)
  assert.deepEqual(first.implementationBlockers, ['staging_postgres_rollback_drill_not_run'])
  assert.ok(!JSON.stringify(first).includes('SECRET'))
})

test('a certified staging rollback drill clears the final implementation barrier', () => {
  const manifest = buildCutoverManifest(fixture(), {}, { stagingPostgresRollbackDrillPassed: true })
  assert.deepEqual(manifest.implementationBlockers, [])
  assert.equal(manifest.readyForCutover, true)
})

test('staging certification is accepted only for the exact source revision and fingerprint', () => {
  const state = fixture()
  const evidence = {
    passed: true,
    rollback: true,
    stagingModified: false,
    productionModified: false,
    sourceRevision: state.revision,
    sourceFingerprint: buildShadowCandidate(state).analysis.sourceFingerprint
  }

  assert.equal(stagingCertificationFor(state, evidence).stagingPostgresRollbackDrillPassed, true)
  assert.equal(stagingCertificationFor({ ...state, revision: state.revision + 1 }, evidence).stagingPostgresRollbackDrillPassed, false)
  assert.equal(stagingCertificationFor({ ...state, customers: [] }, evidence).stagingPostgresRollbackDrillPassed, false)
})

test('physical orphans block migration preparation instead of being discarded', () => {
  const manifest = buildCutoverManifest(fixture(), { orphanVehicleInsuranceDocuments: 1 })
  assert.equal(manifest.safeToPrepareMigration, false)
  assert.deepEqual(manifest.integrityBlockers, ['orphan_vehicle_insurance_documents'])
})
