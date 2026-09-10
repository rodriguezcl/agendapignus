const crypto = require('node:crypto')
const manifest = require('./reconciliation-decisions-20260909.json')
const { database, readState } = require('../api/_lib/database.cjs')
const { analyzeNormalization, fingerprint } = require('../api/_lib/normalization-analysis.cjs')
const { applyConfirmedReconciliation } = require('../api/_lib/confirmed-reconciliation.cjs')

const EXPECTED_MANIFEST = 'e531436235d68f667f62b71523ac924801f2802a7f9a0523070ef4c540eda4e8'
const BACKUP_KEY = 'backup_confirmed_reconciliation_20260909'

async function main() {
  const args = process.argv.slice(2)
  const confirmation = args.length === 2 && args[0] === '--confirm-manifest' ? args[1] : ''
  const actualManifest = fingerprint(manifest)
  if (actualManifest !== EXPECTED_MANIFEST || confirmation !== EXPECTED_MANIFEST) {
    throw new Error('La aplicación requiere confirmar la huella exacta del manifiesto ensayado.')
  }
  const sql = database()
  try {
    const report = await sql.begin(async transaction => {
      await transaction`set local statement_timeout = '30000'`
      await transaction`insert into pignus_preferences (key, value) values ('state_revision', '0') on conflict (key) do nothing`
      const revisionRows = await transaction`select value from pignus_preferences where key = 'state_revision' for update`
      const revision = Number(revisionRows[0]?.value || 0)
      const existingBackup = await transaction`select key from pignus_preferences where key = ${BACKUP_KEY} for update`
      if (existingBackup.length) throw new Error('La reparación confirmada ya tiene un respaldo aplicado; no se repetirá.')
      await transaction`select id from pignus_agendas where id = 'current' for update`
      const ids = manifest.records.map(record => String(record.id))
      await transaction`select id from pignus_work_history where id in ${transaction(ids)} for update`
      const state = await readState(transaction)
      if (state.revision !== revision) throw new Error('La revisión cambió durante la lectura protegida.')
      const before = analyzeNormalization(state)
      const result = applyConfirmedReconciliation(state, manifest)
      const after = analyzeNormalization(result.state)
      if (result.state.history.length !== state.history.length) throw new Error('La reparación alteraría la cantidad total de trabajos.')
      const changed = new Set(result.changedRecordIds)
      const backup = {
        version: 1, createdAt: new Date().toISOString(), revisionBefore: revision,
        manifestFingerprint: actualManifest, affectedDates: result.affectedDates,
        history: state.history.filter(record => changed.has(String(record.id))),
        plans: Object.fromEntries(result.affectedDates.map(date => [date, structuredClone(state.agenda?.weekly?.[date] || null)])),
        completedByMonthBefore: before.summary.completedByMonth
      }
      await transaction`insert into pignus_preferences (key, value, updated_at) values (${BACKUP_KEY}, ${JSON.stringify(backup)}, now())`
      for (const record of result.state.history.filter(record => changed.has(String(record.id)))) {
        await transaction`update pignus_work_history set work_date = ${record.date || null}, status = ${record.status || 'Pendiente'}, service_id = ${record.serviceId == null ? null : String(record.serviceId)}, customer_id = ${record.customerId == null ? null : String(record.customerId)}, data = ${transaction.json(record)} where id = ${String(record.id)}`
      }
      await transaction`update pignus_agendas set data = ${transaction.json(result.state.agenda)}, updated_at = now() where id = 'current'`
      const nextRevision = revision + 1
      await transaction`update pignus_preferences set value = ${String(nextRevision)}, updated_at = now() where key = 'state_revision'`
      const event = { id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: 'system', name: 'Conciliación confirmada', role: 'Sistema' },
        action: 'Concilió', entity: 'Historial y agenda', entityId: `manifest:${actualManifest}`,
        before: { revision, completedByMonth: before.summary.completedByMonth, findings: before.summary.byType },
        after: { revision: nextRevision, completedByMonth: after.summary.completedByMonth, findings: after.summary.byType, changedRecordIds: result.changedRecordIds, affectedDates: result.affectedDates },
        backupKey: BACKUP_KEY }
      await transaction`insert into pignus_audit_log (id, occurred_at, data) values (${event.id}, ${event.at}, ${transaction.json(event)})`
      return { revisionBefore: revision, revisionAfter: nextRevision, backupKey: BACKUP_KEY, manifestFingerprint: actualManifest,
        totalHistory: result.state.history.length, changedRecords: result.changedRecordIds.length, affectedDates: result.affectedDates,
        completedByMonthBefore: before.summary.completedByMonth, completedByMonthAfter: after.summary.completedByMonth,
        findingsBefore: before.summary.byType, findingsAfter: after.summary.byType }
    })
    console.log(JSON.stringify({ applied: true, ...report }, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(`No se aplicó la conciliación: ${error.message}`); process.exitCode = 1 })
module.exports = { BACKUP_KEY, EXPECTED_MANIFEST, main }
