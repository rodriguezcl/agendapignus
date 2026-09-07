const postgres = require('postgres')
const crypto = require('node:crypto')
const { migrateLegacyEstimatedMinutes } = require('../api/_lib/legacy-estimated-minutes.cjs')

const confirmed = process.argv.includes('--confirm')
const protectedDates = process.argv.filter(argument => argument.startsWith('--protect-date=')).map(argument => argument.slice('--protect-date='.length)).filter(Boolean)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Falta configurar DATABASE_URL.')

async function run() {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 15, ssl: 'require' })
  try {
    const result = await sql.begin(async transaction => {
      const historyRows = await transaction`select id, data from pignus_work_history order by created_at, id`
      const agendaRows = await transaction`select data from pignus_agendas where id = 'current'`
      const migration = migrateLegacyEstimatedMinutes({
        history: historyRows.map(row => row.data),
        agenda: agendaRows[0]?.data || {}
      }, { repairUnidentifiedAgenda: true, protectedDates })
      const originalHistoryIds = historyRows.map(row => String(row.id)).sort()
      const migratedHistoryIds = migration.state.history.map(record => String(record.id)).sort()
      if (JSON.stringify(originalHistoryIds) !== JSON.stringify(migratedHistoryIds)) throw new Error('La migración intentó alterar la identidad o cantidad de servicios históricos.')
      for (const protectedDate of protectedDates) {
        const originalHistory = historyRows.map(row => row.data).filter(record => String(record.date || '') === protectedDate)
        const migratedHistory = migration.state.history.filter(record => String(record.date || '') === protectedDate)
        if (JSON.stringify(originalHistory) !== JSON.stringify(migratedHistory)) throw new Error(`La migración intentó modificar Historial del ${protectedDate}.`)
        const originalWeekly = agendaRows[0]?.data?.weekly?.[protectedDate]
        const migratedWeekly = migration.state.agenda?.weekly?.[protectedDate]
        if (JSON.stringify(originalWeekly) !== JSON.stringify(migratedWeekly)) throw new Error(`La migración intentó modificar Agenda semanal del ${protectedDate}.`)
        if (String(agendaRows[0]?.data?.date || '') === protectedDate && JSON.stringify(agendaRows[0]?.data?.teams || []) !== JSON.stringify(migration.state.agenda?.teams || [])) {
          throw new Error(`La migración intentó modificar Agenda del día del ${protectedDate}.`)
        }
      }
      if (!confirmed || !migration.totalChanged) return migration

      const changedHistory = migration.state.history.filter((record, index) => JSON.stringify(record) !== JSON.stringify(historyRows[index]?.data))
      for (const record of changedHistory) {
        await transaction`update pignus_work_history set data = ${transaction.json(record)} where id = ${String(record.id)}`
      }
      if (migration.agendaChanged) {
        await transaction`update pignus_agendas set data = ${transaction.json(migration.state.agenda)}, updated_at = now() where id = 'current'`
      }
      const revisionRows = await transaction`select value from pignus_preferences where key = 'state_revision' for update`
      const revision = Number(revisionRows[0]?.value || 0) + 1
      await transaction`insert into pignus_preferences (key, value, updated_at) values ('state_revision', ${String(revision)}, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`
      const audit = {
        id: crypto.randomUUID(), at: new Date().toISOString(), action: 'Migró', entity: 'Duraciones históricas', entityId: 'legacy-estimated-minutes-15',
        before: null, after: { history: migration.historyChanged, agenda: migration.agendaChanged, estimatedMinutes: 15 },
        user: { id: 'system', name: 'Sistema', email: '' }
      }
      await transaction`insert into pignus_audit_log (id, occurred_at, data) values (${audit.id}, ${audit.at}, ${transaction.json(audit)})`
      return { ...migration, revision }
    })
    const mode = confirmed ? 'APLICADA' : 'SIMULACIÓN'
    console.log(`${mode}: ${result.totalChanged} registro(s) heredado(s) por corregir; Historial=${result.historyChanged}, Agenda=${result.agendaChanged}${protectedDates.length ? `, fechas protegidas=${protectedDates.join(',')}` : ''}${result.revision ? `, revisión=${result.revision}` : ''}.`)
  } finally {
    await sql.end()
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1 })
