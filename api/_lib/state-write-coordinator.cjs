const { synchronizeNormalizedStateInTransaction } = require('./normalized-state-repository.cjs')
const { normalizedShadowIsPrepared } = require('./operational-storage.cjs')

async function queryRows(sql, statement, parameters = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, parameters) : await sql.unsafe(statement, parameters)
  return result.rows || result
}

function writeMode(options = {}) {
  const mode = options.mode || 'controlled'
  if (mode === 'legacy' || mode === 'controlled') return mode
  if (mode === 'isolated-dual-write' && options.isolatedRehearsal === true) return mode
  const error = new Error('La escritura doble sólo está permitida dentro del ensayo aislado.')
  error.code = 'DUAL_WRITE_NOT_AUTHORIZED'
  throw error
}

async function coordinateStateWrite(transaction, current, next, options = {}) {
  if (typeof options.writeLegacy !== 'function') throw new TypeError('Falta el escritor legado de la operación.')
  const mode = writeMode(options)
  await options.writeLegacy(transaction, next, current)
  if (mode === 'legacy') return { mode, shadowWritten: false }
  if (mode === 'controlled' && !(await normalizedShadowIsPrepared(transaction))) return { mode: 'legacy', shadowWritten: false }
  const writeShadow = options.writeShadow || synchronizeNormalizedStateInTransaction
  const shadow = await writeShadow(transaction, current, next)
  const [control] = await queryRows(transaction, 'select active_model, active_revision, active_fingerprint from normalized_shadow.storage_control where id = 1 for update')
  if (!control) {
    const error = new Error('Falta el selector persistente del almacenamiento normalizado.')
    error.code = 'STORAGE_CONTROL_MISSING'
    throw error
  }
  if (control.active_model === 'normalized') {
    const expectedRevision = shadow.idempotent ? Number(next.revision) : Number(current.revision)
    const expectedFingerprint = shadow.idempotent ? shadow.sourceFingerprint : shadow.previousSourceFingerprint
    if (Number(control.active_revision) !== expectedRevision || control.active_fingerprint !== expectedFingerprint) {
      const error = new Error('El selector de almacenamiento no coincide con la base de la escritura.')
      error.code = 'STORAGE_CONTROL_WRITE_CONFLICT'
      throw error
    }
    await queryRows(transaction, 'update normalized_shadow.storage_control set active_revision = $1, active_fingerprint = $2 where id = 1', [Number(next.revision), shadow.sourceFingerprint])
  }
  return { mode, activeModel: control.active_model, shadowWritten: true, shadow }
}

async function inTransaction(sql, callback) {
  if (typeof sql.begin === 'function') return sql.begin(callback)
  if (typeof sql.exec !== 'function') {
    const error = new Error('El adaptador no permite ejecutar una transacción atómica.')
    error.code = 'ATOMIC_TRANSACTION_UNAVAILABLE'
    throw error
  }
  await sql.exec('begin')
  try {
    const result = await callback(sql)
    await sql.exec('commit')
    return result
  } catch (error) {
    await sql.exec('rollback')
    throw error
  }
}

async function executeStateWrite(sql, current, next, options = {}) {
  return inTransaction(sql, transaction => coordinateStateWrite(transaction, current, next, options))
}

module.exports = { coordinateStateWrite, executeStateWrite, inTransaction, writeMode }
