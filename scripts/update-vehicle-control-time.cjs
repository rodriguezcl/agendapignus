const crypto = require('node:crypto')
const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit, setAuxiliaryPreference } = require('../api/_lib/operational-storage.cjs')
const { validateState } = require('../api/_lib/core.cjs')

function updateTimes(current) {
  const state = structuredClone(current)
  const records = state.history.filter(r => r.vehicleControl && r.date >= '2026-09-25' && r.status === 'Pendiente' && !r.technicalStatus && !r.completedAt && !r.startedAt && (r.time || r.scheduledTime) === '15:30')
  const ids = new Set(records.flatMap(r => [r.id, r.sourceTaskId].filter(Boolean).map(String)))
  const backup = { records: structuredClone(records), tasks: [] }
  const change = r => { r.time = '15:45'; if (Object.hasOwn(r, 'scheduledTime')) r.scheduledTime = '15:45' }
  records.forEach(change)
  const plans = [['daily', state.agenda], ...Object.entries(state.agenda?.weekly || {}).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key))]
  for (const [scope, plan] of plans) for (const team of plan?.teams || []) for (const task of team.tasks || []) {
    if (![task.historyId, task.taskId].filter(Boolean).some(id => ids.has(String(id)))) continue
    if (!task.vehicleControl || (task.time || task.scheduledTime) !== '15:30') throw new Error('La proyección de un control difiere del historial; se cancela la operación.')
    backup.tasks.push({ scope, teamId: team.teamId, task: structuredClone(task) })
    change(task)
  }
  return { state, records, backup }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = database()
  try {
    const report = await sql.begin(async tx => {
      if (!apply) await tx`set transaction read only`
      await tx`set local statement_timeout = '60000'`
      if (apply) await tx`select value from pignus_preferences where key='state_revision' for update`
      const current = await readApplicationState(tx)
      const result = updateTimes(current)
      validateState(result.state, current)
      const report = { applied: false, records: result.records.length, agendaCards: result.backup.tasks.length, dates: [...new Set(result.records.map(r => r.date))].sort() }
      if (!apply || !result.records.length) return report
      const backupKey = 'backup_vehicle_control_time_' + crypto.randomUUID()
      await setAuxiliaryPreference(tx, backupKey, JSON.stringify({ revision: current.revision, ...result.backup }))
      result.state.revision = Number(current.revision) + 1
      await coordinateStateWrite(tx, current, result.state, { writeLegacy: async (connection, next, previous) => {
        await replaceCollections(connection, next, previous)
        await connection`update pignus_preferences set value=${String(next.revision)}, updated_at=now() where key='state_revision'`
      } })
      await appendOperationalAudit(tx, [{ id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: 'system', name: 'Ajuste autorizado de controles', role: 'Sistema' }, action: 'Actualizó horario de controles pendientes', entity: 'Controles vehiculares', entityId: '15:45', before: { time: '15:30' }, after: { time: '15:45', ids: result.records.map(r => r.id), backupKey } }])
      return { ...report, applied: true, revision: result.state.revision, backupKey }
    })
    console.log(JSON.stringify(report))
  } finally { await sql.end() }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { updateTimes }
