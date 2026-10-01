// Run --apply only after deploying operator access enforcement.
const { database, replaceCollections } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')

async function plan(current) {
  const { resolvedRolePermissions, roleCode } = await import('../src/domain/access/permissions.mjs')
  const existing = current.roles.filter(role => roleCode(role) === 'operator')
  if (existing.length > 1) throw new Error('Existe más de un rol Operador; revisar antes de continuar.')
  const role = { ...existing[0], id: existing[0]?.id || randomUUID(), code: 'operator', name: 'Operador', description: 'Consulta de Agenda semanal. Sin permisos de modificación.', permissions: resolvedRolePermissions({ name: 'Operador' }) }
  const next = { ...current, roles: existing.length ? current.roles.map(item => item.id === role.id ? role : item) : [...current.roles, role], revision: Number(current.revision) + 1 }
  return { next, role, previous: existing[0] || null }
}

async function main() {
  const sql = database(), apply = process.argv.includes('--apply'), rehearse = process.argv.includes('--rehearse')
  const rollback = new Error('REHEARSAL_ROLLBACK')
  let result
  try {
    try { await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`
      await tx`set local statement_timeout = '60s'`
      if (apply || rehearse) await tx`select value from pignus_preferences where key = 'state_revision' for update`
      const current = await readApplicationState(tx)
      const { next, role, previous } = await plan(current)
      const changed = !isDeepStrictEqual(previous, role)
      result = { applied: apply && changed, rehearsal: rehearse, changed, role }
      if (!changed || !(apply || rehearse)) return
      await coordinateStateWrite(tx, current, next, { mode: 'controlled', writeLegacy: async (db, after, before) => {
        await replaceCollections(db, after, before)
        await db`update pignus_preferences set value = ${String(after.revision)}, updated_at = now() where key = 'state_revision'`
      } })
      const verified = await readApplicationState(tx)
      for (const key of ['roles', 'employees', 'history', 'agenda', 'customers', 'services', 'vehicles']) {
        if (!isDeepStrictEqual(verified[key], next[key])) throw new Error(`Falló la verificación de ${key}.`)
      }
      await appendOperationalAudit(tx, [{ id: randomUUID(), at: new Date().toISOString(), user: { name: 'Cambio autorizado por usuario', role: 'Sistema' }, action: 'Configuró rol de solo lectura', entity: 'Rol', entityId: String(role.id), before: previous, after: role }])
      if (rehearse) throw rollback
    }) } catch (error) { if (error !== rollback) throw error }
    console.log(JSON.stringify(result, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { plan }
