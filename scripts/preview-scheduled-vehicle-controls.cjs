const { database, readState } = require('../api/_lib/database.cjs')
const { analyzeNormalization } = require('../api/_lib/normalization-analysis.cjs')
const { restoreScheduledVehicleControls } = require('../api/_lib/scheduled-vehicle-control-repair.cjs')
async function main() {
  const sql = database(); let state
  try { state = await sql.begin(async tx => { await tx`set transaction isolation level repeatable read, read only`; return readState(tx) }) }
  finally { await sql.end({ timeout: 5 }) }
  const before = analyzeNormalization(state), result = restoreScheduledVehicleControls(state), after = analyzeNormalization(result.state)
  console.log(JSON.stringify({ revision: state.revision, productionModified: false, totalHistoryBefore: state.history.length, totalHistoryAfter: result.state.history.length,
    restoredIds: result.records.map(record => record.id), completedByMonthUnchanged: JSON.stringify(before.summary.completedByMonth) === JSON.stringify(after.summary.completedByMonth),
    findingsBefore: before.summary.byType, findingsAfter: after.summary.byType }, null, 2))
}
main().catch(() => { console.error('No se completó la vista previa. No se aplicaron cambios a producción.'); process.exitCode = 1 })
