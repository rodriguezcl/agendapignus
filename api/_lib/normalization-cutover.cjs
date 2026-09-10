const { analyzeNormalization, fingerprint } = require('./normalization-analysis.cjs')
const { buildShadowCandidate } = require('./normalization-rehearsal.cjs')

const SCHEMA_CONTRACT = 'normalized-v1-2026-09-09'

function buildCutoverManifest(state, dependencies = {}, certification = {}) {
  const analysis = analyzeNormalization(state)
  const candidate = buildShadowCandidate(state)
  const rowCounts = Object.fromEntries(Object.entries(candidate.tables).map(([table, rows]) => [table, rows.length]))
  const integrityBlockers = []
  if (analysis.summary.bySeverity.error) integrityBlockers.push('source_integrity_errors')
  if (analysis.summary.bySeverity.review) integrityBlockers.push('unresolved_reconciliation_cases')
  if (dependencies.orphanSessions) integrityBlockers.push('orphan_sessions')
  if (dependencies.orphanVehicleControlPhotos) integrityBlockers.push('orphan_vehicle_control_photos')
  if (dependencies.orphanVehicleInsuranceDocuments) integrityBlockers.push('orphan_vehicle_insurance_documents')
  const implementationBlockers = []
  if (!certification.stagingPostgresRollbackDrillPassed) implementationBlockers.push('staging_postgres_rollback_drill_not_run')
  const manifest = {
    schemaContract: SCHEMA_CONTRACT,
    sourceFingerprint: analysis.sourceFingerprint,
    sourceRevision: analysis.revision,
    sourceCounts: { history: state.history.length, customers: state.customers.length, employees: state.employees.length, services: state.services.length, vehicles: state.vehicles.length },
    normalizedRowCounts: rowCounts,
    dependencies: {
      activeSessions: Number(dependencies.activeSessions || 0),
      auditEvents: Number(dependencies.auditEvents || 0),
      vehicleControlPhotos: Number(dependencies.vehicleControlPhotos || 0),
      vehicleInsuranceDocuments: Number(dependencies.vehicleInsuranceDocuments || 0),
      orphanSessions: Number(dependencies.orphanSessions || 0),
      orphanVehicleControlPhotos: Number(dependencies.orphanVehicleControlPhotos || 0),
      orphanVehicleInsuranceDocuments: Number(dependencies.orphanVehicleInsuranceDocuments || 0)
    },
    cutoverPolicy: {
      lockRevisionRow: true,
      requireExactSourceRevisionAndFingerprint: true,
      invalidateLegacySessionsAtActivation: true,
      copyBinaryAttachmentsByStreaming: true,
      verifyBinaryCountsAndHashesBeforeForeignKeys: true,
      keepLegacyTablesForRollback: true
    },
    integrityBlockers,
    implementationBlockers,
    safeToPrepareMigration: integrityBlockers.length === 0,
    readyForCutover: integrityBlockers.length === 0 && implementationBlockers.length === 0,
    productionModified: false
  }
  return { ...manifest, manifestFingerprint: fingerprint(manifest) }
}

module.exports = { SCHEMA_CONTRACT, buildCutoverManifest }
