const crypto = require('node:crypto')
const { inTransaction } = require('./state-write-coordinator.cjs')

async function queryRows(sql, statement, parameters = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, parameters) : await sql.unsafe(statement, parameters)
  return result.rows || result
}

async function readStorageControl(sql, { lock = false } = {}) {
  const [row] = await queryRows(sql, `select active_model, active_revision, active_fingerprint, switch_id, switched_at from normalized_shadow.storage_control where id = 1${lock ? ' for update' : ''}`)
  if (!row) { const error = new Error('Falta el control de almacenamiento normalizado.'); error.code = 'STORAGE_CONTROL_MISSING'; throw error }
  return { model: row.active_model, revision: Number(row.active_revision), fingerprint: row.active_fingerprint || null, switchId: row.switch_id || null, switchedAt: row.switched_at || null }
}

function mismatch(message) {
  const error = new Error(message)
  error.code = 'STORAGE_SWITCH_PRECONDITION_FAILED'
  return error
}

async function activateNormalizedStorageInTransaction(sql, options) {
  const [batch] = await queryRows(sql, 'select source_revision, source_fingerprint, status from normalized_shadow.import_batch where id = 1 for update')
  const control = await readStorageControl(sql, { lock: true })
  if (!batch) throw mismatch('No existe una copia normalizada preparada.')
  const revision = Number(options.expectedRevision), fingerprint = String(options.expectedFingerprint || '')
  if (Number(batch.source_revision) !== revision || batch.source_fingerprint !== fingerprint) throw mismatch('La revisión o la huella preparada ya no coincide con la autorizada.')
  if (batch.status !== 'shadow' && batch.status !== 'active') throw mismatch('La copia todavía no completó la sincronización en sombra.')
  if (control.model === 'normalized') {
    if (control.revision === revision && control.fingerprint === fingerprint) return { ...control, idempotent: true }
    throw mismatch('El almacenamiento normalizado ya está activo con otra versión.')
  }
  const switchId = options.switchId || crypto.randomUUID(), occurredAt = options.occurredAt || new Date().toISOString()
  await queryRows(sql, "update normalized_shadow.import_batch set status = 'active' where id = 1")
  await queryRows(sql, "update normalized_shadow.storage_control set active_model = 'normalized', active_revision = $1, active_fingerprint = $2, switch_id = $3, switched_at = $4 where id = 1", [revision, fingerprint, switchId, occurredAt])
  await queryRows(sql, 'insert into normalized_shadow.storage_switch_events (id, from_model, to_model, source_revision, source_fingerprint, actor_id, occurred_at) values ($1,$2,$3,$4,$5,$6,$7)',
    [switchId, 'legacy', 'normalized', revision, fingerprint, options.actorId || null, occurredAt])
  return { model: 'normalized', revision, fingerprint, switchId, switchedAt: occurredAt, idempotent: false }
}

async function rollbackToLegacyInTransaction(sql, options) {
  await queryRows(sql, 'select source_revision from normalized_shadow.import_batch where id = 1 for update')
  const control = await readStorageControl(sql, { lock: true })
  if (control.model === 'legacy') return { ...control, idempotent: true }
  if (control.revision !== Number(options.expectedRevision) || control.fingerprint !== String(options.expectedFingerprint || '')) throw mismatch('El origen activo cambió desde que se autorizó la reversión.')
  const switchId = options.switchId || crypto.randomUUID(), occurredAt = options.occurredAt || new Date().toISOString()
  await queryRows(sql, "update normalized_shadow.import_batch set status = 'shadow' where id = 1")
  await queryRows(sql, "update normalized_shadow.storage_control set active_model = 'legacy', switch_id = $1, switched_at = $2 where id = 1", [switchId, occurredAt])
  await queryRows(sql, 'insert into normalized_shadow.storage_switch_events (id, from_model, to_model, source_revision, source_fingerprint, actor_id, occurred_at) values ($1,$2,$3,$4,$5,$6,$7)',
    [switchId, 'normalized', 'legacy', control.revision, control.fingerprint, options.actorId || null, occurredAt])
  return { model: 'legacy', revision: control.revision, fingerprint: control.fingerprint, switchId, switchedAt: occurredAt, idempotent: false }
}

const activateNormalizedStorage = (sql, options) => inTransaction(sql, transaction => activateNormalizedStorageInTransaction(transaction, options))
const rollbackToLegacy = (sql, options) => inTransaction(sql, transaction => rollbackToLegacyInTransaction(transaction, options))

module.exports = { activateNormalizedStorage, activateNormalizedStorageInTransaction, readStorageControl, rollbackToLegacy, rollbackToLegacyInTransaction }
