const postgres = require('postgres')
const { randomUUID } = require('node:crypto')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { replaceCollections } = require('../api/_lib/database.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const id = 'work-c2d0b13e-98a1-468f-8789-8d03b24793fa'
const taskId = 'c2d0b13e-98a1-468f-8789-8d03b24793fa'
const day = '2026-09-25'
async function main() {
  const apply = process.argv.includes('--apply')
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 10 })
  try {
    const result = await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`
      await tx`set local statement_timeout = '30s'`
      if (!apply) await tx`set transaction read only`
      if (apply) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      const current = await readApplicationState(tx)
      const before = current.history.find(r => r.id === id)
      const actor = current.employees.find(e => String(e.id) === '1786158982393')
      const employee = current.employees.find(e => String(e.id) === '1786104063545')
      const plan = current.agenda?.weekly?.[day]
      const destination = plan?.teams?.find(t => t.teamId === 'a6ede9f1-1712-47e9-ab40-5bfa6a9cc00c')
      const matches = task => task.historyId === id || task.taskId === taskId
      if (!before || before.date !== day || before.clientAccount !== 'CLI-0156' || before.status !== 'Completado' ||
          before.completedAt !== '2026-09-25T15:43:27.922Z' || before.time !== '19:00' ||
          JSON.stringify(before.technicianIds) !== '[2]' || before.sourceTaskId !== taskId ||
          destination?.label !== 'Equipo 5' || JSON.stringify(destination.memberIds?.map(String)) !== '["1786104063545"]' ||
          employee?.name !== 'Gonzalo Rivadero' || actor?.name !== 'Leonardo Rodríguez' || String(actor.roleId) !== '1' ||
          plan.teams.some(t => t.tasks.some(matches))) throw Object.assign(new Error('El estado cambió'), { code: 'TARGET_CHANGED' })
      if (current.history.filter(r => r.customerId === before.customerId && r.date === day && r.service === before.service).length !== 1) throw Object.assign(new Error('Registro ambiguo'), { code: 'DUPLICATE_RECORD' })
      const next = { ...before, team: destination.label, teamId: destination.teamId, technicians: [employee.name], technicianIds: [employee.id] }
      const state = structuredClone(current)
      state.history = state.history.map(r => r.id === id ? next : r)
      const restore = target => {
        const team = target.teams.find(t => t.teamId === destination.teamId)
        if (!team) throw Object.assign(new Error('Falta equipo destino'), { code: 'MISSING_TEAM' })
        target.teams.forEach(t => { t.tasks = t.tasks.filter(task => !matches(task)) })
        team.tasks.push({ ...next, taskId, historyId: id, manualSlot: true })
        const removed = new Set([id, taskId, `history:${id}`, `task:${taskId}`])
        target.removedTaskIds = (target.removedTaskIds || []).filter(value => !removed.has(value))
      }
      restore(state.agenda.weekly[day])
      if (state.agenda.date === day) restore(state.agenda)
      state.revision = Number(current.revision) + 1
      if (apply) {
        await coordinateStateWrite(tx, current, state, { mode: 'controlled', writeLegacy: async (db, after, previous) => {
          await replaceCollections(db, after, previous)
          await db`update pignus_preferences set value = ${String(after.revision)}, updated_at = now() where key = 'state_revision'`
        } })
        await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(), user: { id: actor.id, name: actor.name, role: actor.role },
          action: 'Corrigió responsable de baja completada y restauró tarjeta en Equipo 5 mediante Codex (autorización expresa)', entity: 'Servicio / historial', entityId: id,
          before, after: next }])
      }
      return { applied: apply, id, client: next.client, status: next.status, team: next.team, technicians: next.technicians,
        time: next.time, completedAt: next.completedAt, historyCountUnchanged: current.history.length === state.history.length,
        customersUnchanged: JSON.stringify(current.customers) === JSON.stringify(state.customers),
        weeklyCards: state.agenda.weekly[day].teams.flatMap(t => t.tasks).filter(matches).length }
    })
    console.log(JSON.stringify(result, null, 2))
  } finally { await sql.end({ timeout: 2 }) }
}
main().catch(error => { console.error(error.code || 'CORRECTION_FAILED'); process.exitCode = 1 })
