const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const { randomUUID } = require('node:crypto')
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

async function main() {
  const { repairMovedServiceStart, repairMovedServiceState } = await import('../src/domain/agenda/service-rescheduling.mjs')
  const apply = process.argv.includes('--apply'), id = option('id'), account = option('account'), expectedStart = option('expected-start')
  if ((!id && !account) || (apply && (!id || !expectedStart))) throw new Error('Simulá con --account=CLI-0164. Para aplicar indicá --id, --expected-start y --apply.')
  const sql = database()
  try {
    const result = await sql.begin(async tx => {
      await tx`set local lock_timeout = '10s'`
      await tx`set local statement_timeout = '40s'`
      if (apply) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      const current = await readApplicationState(tx)
      const candidates = current.history.filter(record => (id ? String(record.id) === id : record.clientAccount === account || String(record.client || '').startsWith(account + ' ')))
      const preview = candidates.map(record => ({ id: record.id, date: record.date, time: record.time, status: record.status, startedAt: record.startedAt, rescheduledFrom: record.rescheduledFrom, reprogrammedAt: record.reprogrammedAt, repairable: repairMovedServiceStart(record) !== record }))
      if (!apply) return { applied: false, candidates: preview }
      if (candidates.length !== 1 || candidates[0].startedAt !== expectedStart) throw new Error('El inicio del servicio cambió; volvé a simular.')
      const next = repairMovedServiceState(current, id)
      if (next === current) throw new Error('El servicio no necesita esta reparación o ya tiene una gestión posterior.')
      const record = next.history.find(item => String(item.id) === id)
      require('../api/_lib/completed-service-policy.cjs').assertCompletedServices(next, current)
      require('../api/_lib/service-journeys.cjs').validateServiceJourneys(next, current)
      next.revision = Number(current.revision) + 1
      await coordinateStateWrite(tx, current, next, { mode: 'controlled', writeLegacy: async (transaction, state, before) => {
        await replaceCollections(transaction, state, before)
        await transaction`update pignus_preferences set value = ${String(state.revision)}, updated_at = now() where key = 'state_revision'`
      } })
      await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(), user: { id: 'system', name: 'Reparación de inicio reprogramado', role: 'Sistema' }, action: 'Corrigió inicio de visita reprogramada', entity: 'Servicio / historial', entityId: id, before: candidates[0], after: record }])
      return { applied: true, id, revision: next.revision, date: record.date, time: record.time, startedAt: record.startedAt, ready: record.servicePreparation?.ready, priorVisits: record.reschedulingHistory.length }
    })
    console.log(JSON.stringify(result))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
