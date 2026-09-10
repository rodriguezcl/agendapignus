const fs = require('node:fs')
const path = require('node:path')
const { database, readState } = require('../api/_lib/database.cjs')
const { fingerprint } = require('../api/_lib/normalization-analysis.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const { rehearsePrivilegedDependencies } = require('../api/_lib/physical-cutover-rehearsal.cjs')
const { activateNormalizedStorage, readStorageControl, rollbackToLegacy } = require('../api/_lib/storage-control.cjs')
const { executeStateWrite } = require('../api/_lib/state-write-coordinator.cjs')

async function readSnapshot() {
  const sql = database()
  try {
    return await sql.begin(async transaction => {
      await transaction`set transaction isolation level repeatable read, read only`
      await transaction`set local statement_timeout = '30000'`
      const state = await readState(transaction)
      const audit = await transaction`select id, occurred_at, data from pignus_audit_log order by occurred_at, id`
      const sessions = await transaction`select count(*)::integer as count from pignus_sessions`
      const loginAttempts = await transaction`select fingerprint, attempts, blocked_until, updated_at from pignus_login_attempts order by fingerprint`
      const photos = await transaction`select record_id, vehicle_id, mime_type, photo_data, created_at from pignus_vehicle_control_photos order by record_id`
      const insurance = await transaction`select vehicle_id, file_name, pdf_data, uploaded_at from pignus_vehicle_insurance_documents order by vehicle_id`
      const preferences = await transaction`select key, value, updated_at from pignus_preferences where key not in ('state_revision','theme','vehicles') order by key`
      return { state, dependencies: { audit, sessionCount: Number(sessions[0]?.count || 0), loginAttempts, photos, insurance, preferences } }
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--production-read-only') throw new Error('Este ensayo sólo admite --production-read-only.')
  const { state, dependencies } = await readSnapshot()
  const candidate = buildShadowCandidate(state)
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec('begin')
    const schema = fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8')
    await pg.exec(schema)
    await pg.exec(schema)
    await insertShadowCandidate(pg, candidate)
    const physical = await rehearsePrivilegedDependencies(pg, state, dependencies)
    const safeState = { ...state, employees: state.employees.map(({ password, passwordHash, ...employee }) => employee) }
    if (fingerprint(await readNormalizedState(pg)) !== fingerprint(safeState)) throw Object.assign(new Error('La copia física no reconstruyó el estado exacto.'), { code: 'PHYSICAL_STATE_MISMATCH' })
    await pg.exec('commit')

    await pg.exec('create temp table rehearsal_legacy_state (id integer primary key, data jsonb not null)')
    await pg.query('insert into rehearsal_legacy_state values (1, $1)', [state])
    const writeLegacy = (transaction, next) => transaction.query('update rehearsal_legacy_state set data = $1 where id = 1', [next])
    await pg.query("update normalized_shadow.import_batch set status = 'shadow' where id = 1")
    const activated = await activateNormalizedStorage(pg, { expectedRevision: state.revision, expectedFingerprint: candidate.analysis.sourceFingerprint, switchId: 'physical-rehearsal-activation' })
    const postCutover = structuredClone(state)
    postCutover.revision = state.revision + 1
    postCutover.history[0] = { ...postCutover.history[0], detail: `${postCutover.history[0].detail || ''} [ensayo efímero]`.trim() }
    const postWrite = await executeStateWrite(pg, state, postCutover, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy })
    const restored = { ...structuredClone(state), revision: state.revision + 2 }
    const restoration = await executeStateWrite(pg, postCutover, restored, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy })
    const rolledBack = await rollbackToLegacy(pg, { expectedRevision: restored.revision, expectedFingerprint: restoration.shadow.sourceFingerprint, switchId: 'physical-rehearsal-rollback' })
    const control = await readStorageControl(pg)
    const legacyRestored = (await pg.query('select data from rehearsal_legacy_state where id = 1')).rows[0].data
    const normalizedRestored = await readNormalizedState(pg)
    const safeRestored = { ...restored, employees: restored.employees.map(({ password, passwordHash, ...employee }) => employee) }
    if (fingerprint(legacyRestored) !== fingerprint(restored) || fingerprint(normalizedRestored) !== fingerprint(safeRestored)) throw Object.assign(new Error('La reversión posterior a escrituras no restauró ambos modelos.'), { code: 'PHYSICAL_ROLLBACK_MISMATCH' })
    console.log(JSON.stringify({
      source: { revision: state.revision, fingerprint: candidate.analysis.sourceFingerprint, history: state.history.length, customers: state.customers.length },
      physical,
      switch: { activated: activated.model === 'normalized', postCutoverWriteCommitted: postWrite.shadowWritten, baselineRestored: true,
        rolledBack: rolledBack.model === 'legacy', finalModel: control.model, monotonicRevisionPreserved: control.revision === state.revision + 2 },
      productionModified: false, readyForCutover: false
    }, null, 2))
  } finally { await pg.close() }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: 'No se completó el ensayo físico. No se aplicaron cambios a producción.', code: error.code || 'PHYSICAL_CUTOVER_REHEARSAL_FAILED', reason: String(error.message || '').slice(0, 500) }))
  process.exitCode = 1
})
