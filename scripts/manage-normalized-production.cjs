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

const CERTIFICATION_PATH = path.join(__dirname, '../docs/staging-cutover-certification.json')

function safeState(state) {
  return { ...state, employees: (state.employees || []).map(({ password, passwordHash, ...employee }) => employee) }
}

function assertCertified(state, certification) {
  const sourceFingerprint = buildShadowCandidate(state).analysis.sourceFingerprint
  const valid = certification?.passed === true && certification?.rollback === true && certification?.stagingModified === false &&
    certification?.productionModified === false && Number(certification?.sourceRevision) === Number(state.revision) &&
    certification?.sourceFingerprint === sourceFingerprint
  if (!valid) throw Object.assign(new Error('La certificación de staging no coincide exactamente con el estado productivo bloqueado.'), { code: 'STALE_STAGING_CERTIFICATION' })
  return sourceFingerprint
}

async function dependenciesFrom(sql) {
  const audit = await sql`select id, occurred_at, data from pignus_audit_log order by occurred_at, id`
  const sessions = await sql`select count(*)::integer as count from pignus_sessions`
  const loginAttempts = await sql`select fingerprint, attempts, blocked_until, updated_at from pignus_login_attempts order by fingerprint`
  const photos = await sql`select record_id, vehicle_id, mime_type, photo_data, created_at from pignus_vehicle_control_photos order by record_id`
  const insurance = await sql`select vehicle_id, file_name, pdf_data, uploaded_at from pignus_vehicle_insurance_documents order by vehicle_id`
  const preferences = await sql`select key, value, updated_at from pignus_preferences where key not in ('state_revision','theme','vehicles') order by key`
  return { audit, sessionCount: Number(sessions[0]?.count || 0), loginAttempts, photos, insurance, preferences }
}

function connection() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Falta DATABASE_URL.'), { code: 'DATABASE_URL_REQUIRED' })
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 10, connect_timeout: 15, ssl: 'require' })
}

async function activate(sql, expectedManifest) {
  const certification = JSON.parse(fs.readFileSync(CERTIFICATION_PATH, 'utf8'))
  return sql.begin(async transaction => {
    await transaction`set transaction isolation level serializable`
    await transaction`set local lock_timeout = '10s'`
    await transaction`set local statement_timeout = '180s'`
    await transaction`select value from pignus_preferences where key = 'state_revision' for update`
    const [existing] = await transaction`select to_regnamespace('normalized_shadow') is not null as present`
    if (existing.present) throw Object.assign(new Error('El esquema normalizado ya existe; no se permite una segunda preparación.'), { code: 'NORMALIZED_SCHEMA_ALREADY_PRESENT' })
    const state = await readState(transaction)
    const sourceFingerprint = assertCertified(state, certification)
    if (certification.manifestFingerprint !== expectedManifest) throw Object.assign(new Error('La confirmación no coincide con el manifiesto certificado.'), { code: 'MANIFEST_CONFIRMATION_MISMATCH' })
    const dependencies = await dependenciesFrom(transaction)
    const candidate = buildShadowCandidate(state)
    const schema = fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8')
    await transaction.unsafe(schema)
    await insertShadowCandidate(transaction, candidate)
    const inserted = await insertPrivilegedDependencies(transaction, state, dependencies)
    const physical = await verifyPrivilegedDependencies(transaction, state, dependencies, inserted)
    const normalized = await readNormalizedState(transaction)
    if (fingerprint(normalized) !== fingerprint(safeState(state))) throw Object.assign(new Error('La proyección normalizada no coincide antes de activar.'), { code: 'PRODUCTION_PROJECTION_MISMATCH' })
    await transaction`update normalized_shadow.import_batch set status = 'shadow' where id = 1`
    const control = await activateNormalizedStorageInTransaction(transaction, {
      expectedRevision: state.revision,
      expectedFingerprint: sourceFingerprint,
      switchId: crypto.randomUUID(),
      actorId: 'production-cutover'
    })
    await transaction`delete from pignus_sessions`
    return { sourceRevision: state.revision, sourceFingerprint, counts: candidate.analysis.summary, physical, sessionsInvalidated: dependencies.sessionCount, control }
  })
}

async function rollback(sql, expectedFingerprint) {
  return sql.begin(async transaction => {
    await transaction`set transaction isolation level serializable`
    await transaction`set local lock_timeout = '10s'`
    await transaction`set local statement_timeout = '120s'`
    await transaction`select value from pignus_preferences where key = 'state_revision' for update`
    const control = await readStorageControl(transaction, { lock: true })
    if (control.model !== 'normalized' || control.fingerprint !== expectedFingerprint) throw Object.assign(new Error('El selector activo no coincide con la reversión solicitada.'), { code: 'ROLLBACK_CONFIRMATION_MISMATCH' })
    const legacy = await readState(transaction)
    const normalized = await readNormalizedState(transaction, { includeCredentials: true })
    if (Number(legacy.revision) !== Number(normalized.revision) || fingerprint(safeState(legacy)) !== fingerprint(safeState(normalized))) {
      throw Object.assign(new Error('Los modelos no coinciden; la reversión automática fue bloqueada.'), { code: 'ROLLBACK_MODEL_MISMATCH' })
    }
    const result = await rollbackToLegacyInTransaction(transaction, {
      expectedRevision: control.revision,
      expectedFingerprint: control.fingerprint,
      switchId: crypto.randomUUID(),
      actorId: 'production-rollback'
    })
    await transaction`delete from pignus_sessions`
    return result
  })
}

async function verifyActivated(sql, result) {
  const control = await readStorageControl(sql)
  const legacy = await readState(sql)
  const normalized = await readNormalizedState(sql, { includeCredentials: true })
  const [sessions] = await sql`select count(*)::integer as count from pignus_sessions`
  if (control.model !== 'normalized' || control.revision !== result.sourceRevision || control.fingerprint !== result.sourceFingerprint ||
      Number(legacy.revision) !== Number(normalized.revision) || fingerprint(safeState(legacy)) !== fingerprint(safeState(normalized)) || Number(sessions.count) !== 0) {
    throw Object.assign(new Error('La verificación posterior al commit no coincide.'), { code: 'POST_CUTOVER_VERIFICATION_FAILED' })
  }
  return { model: control.model, revision: control.revision, sourceFingerprint: control.fingerprint, legacyPreserved: true, normalizedMatchesLegacy: true, activeSessions: 0 }
}

async function main() {
  const argument = process.argv[2] || ''
  const [operation, confirmation] = argument.split('=')
  if (!confirmation || !['--activate-production', '--rollback-production'].includes(operation) || process.argv.length !== 3) {
    throw Object.assign(new Error('Se exige una operación y su huella explícita.'), { code: 'EXPLICIT_CONFIRMATION_REQUIRED' })
  }
  const sql = connection()
  try {
    if (operation === '--rollback-production') {
      const result = await rollback(sql, confirmation)
      console.log(JSON.stringify({ operation: 'rollback', model: result.model, revision: result.revision, productionModified: true, legacyPreserved: true }, null, 2))
      return
    }
    const result = await activate(sql, confirmation)
    const verification = await verifyActivated(sql, result)
    console.log(JSON.stringify({ operation: 'activation', ...verification, counts: { history: result.counts.history, customers: result.counts.customers }, physical: result.physical, sessionsInvalidated: result.sessionsInvalidated, productionModified: true }, null, 2))
  } finally { await sql.end({ timeout: 5 }) }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: 'No se completó la operación normalizada de producción.', code: error.code || 'PRODUCTION_CUTOVER_FAILED', reason: String(error.message || '').slice(0, 500) }))
  process.exitCode = 1
})

module.exports = { assertCertified, safeState }
