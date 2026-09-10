const crypto = require('node:crypto')
const { database } = require('../api/_lib/database.cjs')

const DATE = '2026-09-07'
const TASK_ID = '40da2eeb-03a0-4c55-9248-289d61d282ed'
const HISTORY_ID = 'work-40da2eeb-03a0-4c55-9248-289d61d282ed'
const BACKUP_KEY = 'backup_remove_unperformed_agenda_card_20260907'

function removeConfirmedCard(agenda) {
  const next = structuredClone(agenda)
  const plan = next.weekly?.[DATE]
  if (!plan || !Array.isArray(plan.teams)) throw new Error('No existe la agenda esperada del 07/09/2026.')
  let removed = 0
  for (const team of plan.teams) {
    team.tasks = (team.tasks || []).filter(task => {
      const matches = String(task.taskId || '') === TASK_ID && String(task.historyId || '') === HISTORY_ID
      if (!matches) return true
      if (task.time !== '14:00' || String(task.customerId || '') !== '94fae970-7d34-42c1-829c-9cf58d9840d5' || String(task.clientAccount || '') !== 'PIG-6686' || String(task.serviceId || '') !== '1') throw new Error('La tarjeta cambió en campos protegidos; se canceló la eliminación.')
      removed += 1
      return false
    })
  }
  if (removed !== 1) throw new Error(`Se esperó una tarjeta exacta y se encontraron ${removed}.`)
  return next
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--confirm never-performed') throw new Error('Falta la confirmación exacta del trabajo no realizado.')
  const sql = database()
  try {
    const report = await sql.begin(async transaction => {
      await transaction`set local statement_timeout = '30000'`
      await transaction`insert into pignus_preferences (key, value) values ('state_revision', '0') on conflict (key) do nothing`
      const revisions = await transaction`select value from pignus_preferences where key = 'state_revision' for update`
      const revision = Number(revisions[0]?.value || 0)
      const prior = await transaction`select key from pignus_preferences where key = ${BACKUP_KEY} for update`
      if (prior.length) throw new Error('La eliminación confirmada ya fue aplicada y no se repetirá.')
      const rows = await transaction`select data from pignus_agendas where id = 'current' for update`
      if (!rows.length) throw new Error('No existe la agenda actual.')
      const agenda = rows[0].data
      const history = await transaction`select id from pignus_work_history where id = ${HISTORY_ID}`
      if (history.length) throw new Error('El trabajo volvió a existir en el historial; se requiere revisar antes de eliminar la tarjeta.')
      const beforeCount = await transaction`select count(*)::integer total from pignus_work_history`
      const next = removeConfirmedCard(agenda)
      const backup = { version: 1, createdAt: new Date().toISOString(), revisionBefore: revision, date: DATE, plan: agenda.weekly[DATE], taskId: TASK_ID, historyId: HISTORY_ID }
      await transaction`insert into pignus_preferences (key, value, updated_at) values (${BACKUP_KEY}, ${JSON.stringify(backup)}, now())`
      await transaction`update pignus_agendas set data = ${transaction.json(next)}, updated_at = now() where id = 'current'`
      const nextRevision = revision + 1
      await transaction`update pignus_preferences set value = ${String(nextRevision)}, updated_at = now() where key = 'state_revision'`
      const afterCount = await transaction`select count(*)::integer total from pignus_work_history`
      if (beforeCount[0].total !== afterCount[0].total) throw new Error('Cambió inesperadamente la cantidad de trabajos del historial.')
      const event = { id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: 'system', name: 'Conciliación confirmada', role: 'Sistema' },
        action: 'Quitó tarjeta no realizada', entity: 'Agenda técnica', entityId: HISTORY_ID,
        before: { revision, date: DATE, taskId: TASK_ID }, after: { revision: nextRevision, removedFromAgenda: true, historyUnchanged: true }, backupKey: BACKUP_KEY }
      await transaction`insert into pignus_audit_log (id, occurred_at, data) values (${event.id}, ${event.at}, ${transaction.json(event)})`
      return { revisionBefore: revision, revisionAfter: nextRevision, backupKey: BACKUP_KEY, totalHistory: afterCount[0].total }
    })
    console.log(JSON.stringify({ applied: true, ...report }, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(`No se eliminó la tarjeta: ${error.message}`); process.exitCode = 1 })
module.exports = { BACKUP_KEY, removeConfirmedCard }
