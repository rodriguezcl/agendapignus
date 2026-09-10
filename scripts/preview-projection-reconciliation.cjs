const manifest = require('./reconciliation-projections-20260909.json')
const { database, readState } = require('../api/_lib/database.cjs')
const { analyzeNormalization } = require('../api/_lib/normalization-analysis.cjs')
const { applyConfirmedReconciliation } = require('../api/_lib/confirmed-reconciliation.cjs')
async function main() {
  if (process.argv.length > 2) throw new Error('Esta vista previa no admite argumentos.')
  const sql = database(); let state
  try { state = await sql.begin(async tx => { await tx`set transaction isolation level repeatable read, read only`; return readState(tx) }) }
  finally { await sql.end({ timeout: 5 }) }
  const before = analyzeNormalization(state), result = applyConfirmedReconciliation(state, manifest), after = analyzeNormalization(result.state)
  console.log(JSON.stringify({ revision: state.revision, manifestFingerprint: result.manifestFingerprint, productionModified: false,
    totalHistoryBefore: state.history.length, totalHistoryAfter: result.state.history.length, affectedDates: result.affectedDates,
    completedByMonthUnchanged: JSON.stringify(before.summary.completedByMonth) === JSON.stringify(after.summary.completedByMonth),
    findingsBefore: before.summary.byType, findingsAfter: after.summary.byType }, null, 2))
}
main().catch(() => { console.error('No se completó la vista previa. No se aplicaron cambios a producción.'); process.exitCode = 1 })
