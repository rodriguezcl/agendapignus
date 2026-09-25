// Explicitly authorized account capability change; preserves the existing role.
const postgres = require('postgres')
const { randomUUID } = require('node:crypto')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { replaceCollections } = require('../api/_lib/database.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
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
      const previous = current.employees.find(e => String(e.id) === '1786104063545')
      const actor = current.employees.find(e => String(e.id) === '1786158982393')
      if (previous?.name !== 'Gonzalo Rivadero' || String(previous.roleId) !== '2' || previous.status !== 'Activo' || actor?.name !== 'Leonardo Rodríguez' || String(actor.roleId) !== '1') throw Object.assign(new Error('La cuenta cambió'), { code: 'TARGET_CHANGED' })
      if (previous.technicalEnabled === true) return { alreadyEnabled: true }
      const next = { ...previous, technicalEnabled: true }
      if (apply) {
        const state = { ...current, employees: current.employees.map(e => String(e.id) === String(next.id) ? next : e), revision: Number(current.revision) + 1 }
        await coordinateStateWrite(tx, current, state, { mode: 'controlled', writeLegacy: async (db, after, before) => {
          await replaceCollections(db, after, before)
          await db`update pignus_preferences set value = ${String(after.revision)}, updated_at = now() where key = 'state_revision'`
        } })
        await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(), user: { id: actor.id, name: actor.name, role: actor.role },
          action: 'Habilitó función técnica adicional mediante Codex (autorización expresa)', entity: 'Empleado', entityId: String(next.id),
          before: { id: previous.id, name: previous.name, roleId: previous.roleId, technicalEnabled: false },
          after: { id: next.id, name: next.name, roleId: next.roleId, technicalEnabled: true } }])
      }
      return { applied: apply, name: next.name, role: next.role, technicalEnabled: true }
    })
    console.log(JSON.stringify(result))
  } finally { await sql.end({ timeout: 2 }) }
}
main().catch(error => { console.error(error.code || 'ENABLE_FAILED'); process.exitCode = 1 })
