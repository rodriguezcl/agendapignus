const { database, readState } = require('../api/_lib/database.cjs')
const { buildCutoverManifest } = require('../api/_lib/normalization-cutover.cjs')
const { rehearseNormalization } = require('../api/_lib/normalization-rehearsal.cjs')
const fs = require('node:fs')
const path = require('node:path')

function stagingCertificationFor(state, suppliedEvidence) {
  try {
    const evidence = suppliedEvidence || JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/staging-cutover-certification.json'), 'utf8'))
    const { buildShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
    const fingerprint = buildShadowCandidate(state).analysis.sourceFingerprint
    return { stagingPostgresRollbackDrillPassed: evidence.passed === true && evidence.rollback === true && evidence.stagingModified === false && evidence.productionModified === false && Number(evidence.sourceRevision) === Number(state.revision) && evidence.sourceFingerprint === fingerprint }
  } catch {
    return { stagingPostgresRollbackDrillPassed: false }
  }
}

async function main() {
  if (!process.argv.slice(2).every(argument => argument === '--production-read-only')) throw new Error('Este planificador solo admite --production-read-only.')
  const sql = database()
  let state, dependencies
  try {
    ;({ state, dependencies } = await sql.begin(async transaction => {
      await transaction`set transaction isolation level repeatable read, read only`
      await transaction`set local statement_timeout = '20000'`
      const state = await readState(transaction)
      const sessions = await transaction`select employee_id from pignus_sessions where expires_at > now()`
      const photos = await transaction`select record_id, vehicle_id from pignus_vehicle_control_photos`
      const insurance = await transaction`select vehicle_id from pignus_vehicle_insurance_documents`
      const [audit] = await transaction`select count(*)::integer as total, min(occurred_at) as earliest, max(occurred_at) as latest from pignus_audit_log`
      const employeeIds = new Set(state.employees.map(item => String(item.id)))
      const historyIds = new Set(state.history.map(item => String(item.id)))
      const vehicleIds = new Set(state.vehicles.map(item => String(item.id)))
      return { state, dependencies: {
        activeSessions: sessions.length,
        auditEvents: audit.total,
        auditEarliest: audit.earliest,
        auditLatest: audit.latest,
        vehicleControlPhotos: photos.length,
        vehicleInsuranceDocuments: insurance.length,
        orphanSessions: sessions.filter(item => !employeeIds.has(String(item.employee_id))).length,
        orphanVehicleControlPhotos: photos.filter(item => !historyIds.has(String(item.record_id)) || !vehicleIds.has(String(item.vehicle_id))).length,
        orphanVehicleInsuranceDocuments: insurance.filter(item => !vehicleIds.has(String(item.vehicle_id))).length
      } }
    }))
  } finally {
    await sql.end({ timeout: 5 })
  }
  const manifest = buildCutoverManifest(state, dependencies, stagingCertificationFor(state))
  const rehearsal = await rehearseNormalization(state)
  console.log(JSON.stringify({ manifest, dependencyWindow: { auditEarliest: dependencies.auditEarliest, auditLatest: dependencies.auditLatest }, rehearsal: rehearsal.verification,
    productionModified: false }, null, 2))
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: 'No se completó el plan de corte. No se aplicaron cambios a producción.', code: error.code || 'CUTOVER_PLAN_FAILED', reason: String(error.message || 'Error sin detalle').slice(0, 500), ...(error.mismatchPaths ? { mismatchPaths: error.mismatchPaths } : {}) }))
  process.exitCode = 1
})

module.exports = { stagingCertificationFor }
