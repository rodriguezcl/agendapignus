const { randomUUID } = require('node:crypto')
const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const id = 'work-2cfe7b0c-1e61-401a-80f1-75832cf0f41f'
const taskId = '2cfe7b0c-1e61-401a-80f1-75832cf0f41f'
const day = '2026-10-05'
async function main() {
  const apply = process.argv.includes('--apply')
  const sql = database()
  try {
    const result = await sql.begin(async tx => {
      if (apply) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      else await tx`set transaction read only`
      const before = await readApplicationState(tx)
      const next = structuredClone(before)
      const record = next.history.find(item => item.id === id)
      const matches = task => task.taskId === taskId || task.historyId === id
      const copies = next.agenda.weekly[day].teams.flatMap(team => team.tasks || []).filter(matches)
      const daily = next.agenda.date === day ? next.agenda.teams.flatMap(team => team.tasks || []).filter(matches) : []
      if (!record || record.date !== day || record.sourceTaskId !== taskId || !record.client.includes('ANTIGUA ESTANCIA') || record.status !== 'Pendiente' || record.startedAt || record.technicalStatus || record.time !== '08:30' || copies.length !== 1 || ![15, 300].includes(record.estimatedMinutes) || ![315, 300].includes(copies[0].estimatedMinutes)) throw new Error('TARGET_CHANGED')
      const prior = structuredClone(record)
      for (const item of [record, ...copies, ...daily]) Object.assign(item, { estimatedMinutes: 300, estimatedMinutesCustomized: true })
      if (apply) {
        next.revision = Number(before.revision) + 1
        await coordinateStateWrite(tx, before, next, { mode: 'controlled', writeLegacy: async (db, after, previous) => {
          await replaceCollections(db, after, previous)
          await db`update pignus_preferences set value = ${String(after.revision)}, updated_at = now() where key = 'state_revision'`
        } })
        await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(), user: { id: 'codex-maintenance', name: 'Corrección autorizada mediante Codex', role: 'Mantenimiento' }, action: 'Unificó duración de Antigua Estancia a 300 minutos por confirmación expresa del usuario', entity: 'Servicio / historial', entityId: id, before: prior, after: record }])
        const saved = await readApplicationState(tx)
        if (saved.history.find(item => item.id === id)?.estimatedMinutes !== 300 || saved.agenda.weekly[day].teams.flatMap(team => team.tasks || []).filter(matches).some(item => item.estimatedMinutes !== 300)) throw new Error('VERIFY_FAILED')
      }
      return { applied: apply, id, date: day, time: record.time, estimatedMinutes: record.estimatedMinutes, weeklyCopies: copies.length, dailyCopies: daily.length }
    })
    console.log(JSON.stringify(result))
  } finally { await sql.end({ timeout: 5 }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
