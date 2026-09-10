const crypto = require('node:crypto')
const { database, readState } = require('../api/_lib/database.cjs')
const { analyzeNormalization, fingerprint } = require('../api/_lib/normalization-analysis.cjs')
const { restoreScheduledVehicleControls } = require('../api/_lib/scheduled-vehicle-control-repair.cjs')
const BACKUP_KEY = 'backup_restore_scheduled_vehicle_controls_20260909'
async function main() {
  if (process.argv.slice(2).join(' ') !== '--confirm scheduled-controls') throw new Error('Falta confirmar la restauración de controles programados.')
  const sql = database()
  try {
    const report = await sql.begin(async transaction => {
      await transaction`set local statement_timeout = '30000'`
      await transaction`insert into pignus_preferences (key, value) values ('state_revision', '0') on conflict (key) do nothing`
      const revisions = await transaction`select value from pignus_preferences where key='state_revision' for update`
      const revision = Number(revisions[0]?.value || 0)
      const prior = await transaction`select key from pignus_preferences where key=${BACKUP_KEY} for update`
      if (prior.length) throw new Error('La restauración ya fue aplicada y no se repetirá.')
      await transaction`select id from pignus_agendas where id='current' for update`
      const state = await readState(transaction), before = analyzeNormalization(state)
      const result = restoreScheduledVehicleControls(state), after = analyzeNormalization(result.state)
      if (result.records.length !== 9 || result.state.history.length !== state.history.length + 9) throw new Error('La cantidad de controles a restaurar no es la esperada.')
      if (JSON.stringify(before.summary.completedByMonth) !== JSON.stringify(after.summary.completedByMonth)) throw new Error('La restauración alteraría indicadores de completados.')
      const existing = await transaction`select id from pignus_work_history where id in ${transaction(result.records.map(record => record.id))}`
      if (existing.length) throw new Error('Uno o más controles ya existen; se canceló la restauración completa.')
      const dates = [...new Set(result.records.map(record => record.date))].sort()
      const backup = { version: 1, createdAt: new Date().toISOString(), revisionBefore: revision, stateFingerprint: fingerprint(state), dates,
        plans: Object.fromEntries(dates.map(date => [date, state.agenda.weekly[date]])), recordIds: result.records.map(record => record.id) }
      await transaction`insert into pignus_preferences (key,value,updated_at) values (${BACKUP_KEY},${JSON.stringify(backup)},now())`
      await transaction`insert into pignus_work_history ${transaction(result.records.map(record => ({ id: String(record.id), work_date: record.date, status: record.status, service_id: String(record.serviceId), customer_id: null, data: transaction.json(record) })))}`
      await transaction`update pignus_agendas set data=${transaction.json(result.state.agenda)},updated_at=now() where id='current'`
      const nextRevision = revision + 1
      await transaction`update pignus_preferences set value=${String(nextRevision)},updated_at=now() where key='state_revision'`
      const event = { id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: 'system', name: 'Normalización vehicular', role: 'Sistema' }, action: 'Restauró controles programados',
        entity: 'Historial y agenda', entityId: 'vehicle-controls:2026-09', before: { revision, history: state.history.length, findings: before.summary.byType },
        after: { revision: nextRevision, history: result.state.history.length, restoredIds: result.records.map(record => record.id), findings: after.summary.byType }, backupKey: BACKUP_KEY }
      await transaction`insert into pignus_audit_log (id,occurred_at,data) values (${event.id},${event.at},${transaction.json(event)})`
      return { revisionBefore: revision, revisionAfter: nextRevision, totalHistory: result.state.history.length, restored: result.records.length, backupKey: BACKUP_KEY, findingsAfter: after.summary.byType }
    })
    console.log(JSON.stringify({ applied: true, ...report }, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(`No se restauraron los controles: ${error.message}`); process.exitCode = 1 })
module.exports = { BACKUP_KEY }
