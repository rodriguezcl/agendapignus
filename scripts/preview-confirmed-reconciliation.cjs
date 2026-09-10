const manifest = require('./reconciliation-decisions-20260909.json')
const { database, readState } = require('../api/_lib/database.cjs')
const { analyzeNormalization } = require('../api/_lib/normalization-analysis.cjs')
const { applyConfirmedReconciliation } = require('../api/_lib/confirmed-reconciliation.cjs')
async function main() {
  if (process.argv.length > 2) throw new Error('Este comando es únicamente de vista previa y no admite argumentos.')
  const sql = database()
  let state
  try { state = await sql.begin(async tx => { await tx`set transaction isolation level repeatable read, read only`; return readState(tx) }) }
  finally { await sql.end({ timeout: 5 }) }
  const before = analyzeNormalization(state), result = applyConfirmedReconciliation(state, manifest), after = analyzeNormalization(result.state)
  console.log(JSON.stringify({ revision: state.revision, manifestFingerprint: result.manifestFingerprint, productionModified: false,
    changedRecordIds: result.changedRecordIds, affectedDates: result.affectedDates,
    completedByMonthBefore: before.summary.completedByMonth, completedByMonthAfter: after.summary.completedByMonth,
    findingsBefore: before.summary.byType, findingsAfter: after.summary.byType }, null, 2))
}
main().catch(() => { console.error('No se completó la vista previa. No se aplicaron cambios a producción.'); process.exitCode = 1 })
