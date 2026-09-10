const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const postgres = require('postgres')
const { readState } = require('../api/_lib/database.cjs')
const { fingerprint } = require('../api/_lib/normalization-analysis.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const { insertPrivilegedDependencies, verifyPrivilegedDependencies } = require('../api/_lib/physical-cutover-rehearsal.cjs')
const { activateNormalizedStorageInTransaction, readStorageControl, rollbackToLegacyInTransaction } = require('../api/_lib/storage-control.cjs')
const { coordinateStateWrite } = require('../api/_lib/state-write-coordinator.cjs')
const { appendOperationalAudit, setAuxiliaryPreference, upsertVehicleControlPhoto, upsertVehicleInsuranceDocument } = require('../api/_lib/operational-storage.cjs')

const ROLLBACK_COMPLETE = 'STAGING_REHEARSAL_ROLLBACK_COMPLETE'

function client(url) {
  return postgres(url, { max: 1, prepare: false, idle_timeout: 10, connect_timeout: 15, ssl: 'require' })
}

async function productionSnapshot(url) {
  const sql = client(url)
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
  } finally { await sql.end({ timeout: 5 }) }
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--staging-postgres-rollback') throw new Error('Este ensayo sólo admite --staging-postgres-rollback.')
  const productionUrl = process.env.DATABASE_URL, stagingUrl = process.env.STAGING_DATABASE_URL
  if (!productionUrl || !stagingUrl) throw Object.assign(new Error('Falta configurar DATABASE_URL o STAGING_DATABASE_URL.'), { code: 'STAGING_DATABASE_URL_REQUIRED' })
  if (productionUrl === stagingUrl) throw Object.assign(new Error('Staging y producción no pueden usar la misma conexión.'), { code: 'STAGING_MATCHES_PRODUCTION' })
  const { state, dependencies } = await productionSnapshot(productionUrl)
  const candidate = buildShadowCandidate(state), schema = fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8')
  const staging = client(stagingUrl)
  let result
  try {
    try {
      await staging.begin(async transaction => {
        await transaction`set transaction isolation level serializable`
        await transaction`set local lock_timeout = '5s'`
        await transaction`set local statement_timeout = '120s'`
        const [existing] = await transaction`select to_regnamespace('normalized_shadow') is not null as present`
        if (existing.present) throw Object.assign(new Error('El staging ya contiene normalized_shadow; se exige una base aislada para no interferir con otro ensayo.'), { code: 'STAGING_NOT_ISOLATED' })
        await transaction.unsafe(schema)
        await insertShadowCandidate(transaction, candidate)
        const inserted = await insertPrivilegedDependencies(transaction, state, dependencies)
        const physical = await verifyPrivilegedDependencies(transaction, state, dependencies, inserted)
        const safeState = { ...state, employees: state.employees.map(({ password, passwordHash, ...employee }) => employee) }
        if (fingerprint(await readNormalizedState(transaction)) !== fingerprint(safeState)) throw Object.assign(new Error('La proyección inicial no coincide.'), { code: 'STAGING_PROJECTION_MISMATCH' })
        await transaction`update normalized_shadow.import_batch set status = 'shadow' where id = 1`

        await transaction`create temp table rehearsal_legacy_state (id integer primary key, data jsonb not null) on commit drop`
        await transaction`create temp table pignus_audit_log (id uuid primary key, occurred_at timestamptz not null, data jsonb not null) on commit drop`
        await transaction`create temp table pignus_preferences (key text primary key, value text not null, updated_at timestamptz not null default now()) on commit drop`
        await transaction`create temp table pignus_vehicle_insurance_documents (vehicle_id text primary key, file_name text not null, pdf_data bytea not null, uploaded_at timestamptz not null) on commit drop`
        await transaction`create temp table pignus_vehicle_control_photos (record_id text primary key, vehicle_id text not null, mime_type text not null, photo_data bytea not null, created_at timestamptz not null) on commit drop`
        await transaction`insert into rehearsal_legacy_state values (1, ${transaction.json(state)})`
        const writeLegacy = (sql, next) => typeof sql.query === 'function'
          ? sql.query('update rehearsal_legacy_state set data = $1 where id = 1', [next])
          : sql.unsafe('update rehearsal_legacy_state set data = $1 where id = 1', [next])
        const activated = await activateNormalizedStorageInTransaction(transaction, { expectedRevision: state.revision, expectedFingerprint: candidate.analysis.sourceFingerprint, switchId: crypto.randomUUID(), actorId: 'staging-rehearsal' })
        const changed = structuredClone(state)
        changed.revision = state.revision + 1
        if (changed.history[0]) changed.history[0] = { ...changed.history[0], detail: `${changed.history[0].detail || ''} [staging]`.trim() }
        const write = await coordinateStateWrite(transaction, state, changed, { mode: 'controlled', writeLegacy })
        const event = { id: crypto.randomUUID(), at: new Date().toISOString(), user: { name: 'Ensayo staging', role: 'Sistema' }, action: 'Ensayó corte', entity: 'Almacenamiento', entityId: 'staging', before: null, after: { revision: changed.revision } }
        await appendOperationalAudit(transaction, [event])
        await setAuxiliaryPreference(transaction, 'staging_rehearsal_marker', event.id)
        if (dependencies.insurance[0]) await upsertVehicleInsuranceDocument(transaction, { vehicleId: dependencies.insurance[0].vehicle_id, fileName: dependencies.insurance[0].file_name, data: dependencies.insurance[0].pdf_data, uploadedAt: dependencies.insurance[0].uploaded_at })
        if (dependencies.photos[0]) await upsertVehicleControlPhoto(transaction, { recordId: dependencies.photos[0].record_id, vehicleId: dependencies.photos[0].vehicle_id, mimeType: dependencies.photos[0].mime_type, data: dependencies.photos[0].photo_data, createdAt: dependencies.photos[0].created_at })

        const restored = { ...structuredClone(state), revision: state.revision + 2 }
        const restoration = await coordinateStateWrite(transaction, changed, restored, { mode: 'controlled', writeLegacy })
        const rolledBack = await rollbackToLegacyInTransaction(transaction, { expectedRevision: restored.revision, expectedFingerprint: restoration.shadow.sourceFingerprint, switchId: crypto.randomUUID(), actorId: 'staging-rehearsal' })
        const control = await readStorageControl(transaction)
        const legacy = (await transaction`select data from rehearsal_legacy_state where id = 1`)[0].data
        const normalized = await readNormalizedState(transaction)
        const safeRestored = { ...restored, employees: restored.employees.map(({ password, passwordHash, ...employee }) => employee) }
        if (fingerprint(legacy) !== fingerprint(restored) || fingerprint(normalized) !== fingerprint(safeRestored)) throw Object.assign(new Error('La restauración no coincide en ambos modelos.'), { code: 'STAGING_ROLLBACK_MISMATCH' })
        result = { sourceRevision: state.revision, history: state.history.length, customers: state.customers.length, physical,
          activation: activated.model === 'normalized', operationalWrite: write.shadowWritten, restoration: restoration.shadowWritten,
          rollback: rolledBack.model === 'legacy' && control.model === 'legacy', finalRevision: control.revision }
        throw Object.assign(new Error(ROLLBACK_COMPLETE), { code: ROLLBACK_COMPLETE })
      })
    } catch (error) {
      if (error.code !== ROLLBACK_COMPLETE) throw error
    }
    const [after] = await staging`select to_regnamespace('normalized_shadow') is not null as present`
    if (after.present) throw Object.assign(new Error('El rollback no retiró el esquema temporal del ensayo.'), { code: 'STAGING_ROLLBACK_LEFTOVERS' })
    console.log(JSON.stringify({ ...result, stagingModified: false, productionModified: false, passed: true }, null, 2))
  } finally { await staging.end({ timeout: 5 }) }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: 'No se completó el ensayo PostgreSQL de staging.', code: error.code || 'STAGING_REHEARSAL_FAILED', reason: String(error.message || '').slice(0, 500) }))
  process.exitCode = 1
})
