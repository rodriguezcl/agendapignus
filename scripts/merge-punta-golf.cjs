const { database } = require('../api/_lib/database.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')
const { replaceCollections } = require('../api/_lib/database.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { setAuxiliaryPreference, appendOperationalAudit } = require('../api/_lib/operational-storage.cjs')
const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual: equal } = require('node:util')
const BACKUP = 'backup_merge_cli0063_into_cli0008_20260929'

function merge(state) {
  const source = state.customers.find(c => c.account === 'CLI-0063')
  const target = state.customers.find(c => c.account === 'CLI-0008')
  if (source?.customerId !== 'customer-0b3a781b73004dbf1d553b36' || target?.customerId !== 'customer-399d45d939769aca25b9f834') throw new Error('Las identidades de las cuentas no coinciden.')
  if (source.name !== 'PUNTA DEL GOLF' || target.name !== 'PUNTA GOLF HOUSING') throw new Error('Los nombres de las cuentas cambiaron.')
  const next = structuredClone(state)
  const changed = []
  function visit(value, path) {
    if (!value || typeof value !== 'object') return
    if (String(value.customerId || '') === source.customerId || value.clientAccount === source.account || String(value.client || '').startsWith(`${source.account} `)) {
      changed.push({ path, before: structuredClone(value) })
      Object.assign(value, { customerId: target.customerId, clientAccount: target.account, clientNameAtService: target.name, client: `${target.account} ${target.name}` })
    }
    for (const [key, child] of Object.entries(value)) if (typeof child === 'object') visit(child, `${path}.${key}`)
  }
  visit(next.history, 'history'); visit(next.agenda, 'agenda'); visit(next.reviews, 'reviews')
  next.customers = next.customers.filter(c => c.customerId !== source.customerId)
  next.revision = Number(state.revision) + 1
  return { next, changed, source, target }
}

async function apply(sql, rehearsal) {
  let result
  const rollback = new Error('REHEARSAL_ROLLBACK')
  try {
    await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`
      await tx`set local statement_timeout = '60000'`
      await tx`select value from pignus_preferences where key = 'state_revision' for update`
      if ((await tx`select key from pignus_preferences where key = ${BACKUP}`).length) throw new Error('La fusión ya fue aplicada.')
      const current = await readApplicationState(tx)
      const { next, changed, source, target } = merge(current)
      await setAuxiliaryPreference(tx, BACKUP, JSON.stringify({ at: new Date().toISOString(), revision: current.revision, source, target, changed }))
      await coordinateStateWrite(tx, current, next, { mode: 'controlled', writeLegacy: async (db, state, before) => {
        await replaceCollections(db, state, before)
        await db`update pignus_preferences set value = ${String(state.revision)}, updated_at = now() where key = 'state_revision'`
      } })
      const verified = await readApplicationState(tx)
      if (!equal(verified.customers, next.customers) || !equal(verified.history, next.history) || !equal(verified.agenda, next.agenda) || !equal(verified.reviews, next.reviews) || verified.customers.length !== current.customers.length - 1 || verified.history.length !== current.history.length) throw new Error('Falló la verificación de conservación.')
      const affectedIds = changed.filter(c => c.path.startsWith('history.')).map(c => c.before.id)
      if (verified.history.filter(r => affectedIds.includes(r.id)).some(r => r.customerId !== target.customerId)) throw new Error('Persisten referencias incorrectas.')
      const event = { id: randomUUID(), at: new Date().toISOString(), user: { name: 'Fusión autorizada por administrador', role: 'Sistema' }, action: 'Fusionó CLI-0063 en CLI-0008', entity: 'Cliente', entityId: target.customerId, before: { account: source.account }, after: { account: target.account, affectedIds }, backupKey: BACKUP }
      await appendOperationalAudit(tx, [event])
      result = { rehearsal, references: changed.length, historyServices: affectedIds.length, revision: verified.revision, backup: BACKUP, survivingAccount: target.account }
      if (rehearsal) throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  return result
}

async function main() {
  const sql = database()
  try {
    if (['--rehearse', '--apply'].includes(process.argv[2])) {
      console.log(JSON.stringify(await apply(sql, process.argv[2] === '--rehearse'), null, 2))
      return
    }
    const state = await readApplicationState(sql)
    const customers = state.customers.filter(c => ['CLI-0063', 'CLI-0008'].includes(c.account))
    const source = customers.find(c => c.account === 'CLI-0063')
    if (!source || customers.length !== 2) throw new Error('No se encontraron ambas cuentas únicas.')
    const references = []
    function visit(value, path) {
      if (!value || typeof value !== 'object') return
      if (String(value.customerId || '') === String(source.customerId) || value.clientAccount === source.account || String(value.client || '').includes(source.account)) references.push({ path, ...value })
      for (const [key, child] of Object.entries(value)) if (typeof child === 'object') visit(child, `${path}.${key}`)
    }
    visit(state.agenda, 'agenda'); visit(state.history, 'history'); visit(state.reviews, 'reviews')
    const plan = merge(state)
    console.log(JSON.stringify({ revision: state.revision, customers, references: references.map(r => ({ path: r.path, id: r.id, client: r.client })), affectedReferences: plan.changed.length }, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { merge }
