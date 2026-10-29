// Read-only preview by default. --apply creates missing profiles and renames the
// existing administrator without resetting customized roles on subsequent runs.
const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const { businessRolesPlan } = require('../api/_lib/business-role-profiles.cjs')
const { isDeepStrictEqual } = require('node:util')
const { randomUUID } = require('node:crypto')
async function configureBusinessRoles(sql, { apply = false } = {}) {
    return sql.begin(async tx => {
      await tx.unsafe("set local lock_timeout = '5s'")
      await tx.unsafe("set local statement_timeout = '60s'")
      if (apply) await tx.unsafe("select value from pignus_preferences where key = 'state_revision' for update")
      const current = await readApplicationState(tx), plan = businessRolesPlan(current)
      const report = { applied: false, changes: plan.changes.map(({ before, after }) => ({ action: before ? 'rename' : 'create', code: after.code, name: after.name })), employeeAssignmentsChanged: false }
      if (!apply || !plan.changed) return report
      const next = { ...plan.state, revision: Number(current.revision) + 1 }
      await coordinateStateWrite(tx, current, next, { mode: 'controlled', writeLegacy: async (db, value, previous) => {
        await replaceCollections(db, value, previous)
        await db.unsafe("update pignus_preferences set value = $1, updated_at = now() where key = 'state_revision'", [String(value.revision)])
      } })
      const verified = await readApplicationState(tx)
      for (const key of ['roles', 'employees', 'history', 'agenda', 'customers', 'services', 'vehicles']) if (!isDeepStrictEqual(verified[key], next[key])) throw new Error(`Verificación fallida: ${key}`)
      await appendOperationalAudit(tx, plan.changes.map(({ before, after }) => ({ id: randomUUID(), at: new Date().toISOString(), user: { name: 'Cambio autorizado por usuario', role: 'Sistema' }, action: before ? 'Renombró rol como Administrador del sistema' : 'Creó rol operativo', entity: 'Rol', entityId: String(after.id), before, after })))
      return { ...report, applied: true, revision: verified.revision }
    })
}
async function run() {
  const sql = database()
  try {
    console.log(JSON.stringify(await configureBusinessRoles(sql, { apply: process.argv.includes('--apply') }), null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { configureBusinessRoles }
