const { readRevision: readLegacyRevision, readState: readLegacyState } = require('./database.cjs')
const { fingerprint } = require('./normalization-analysis.cjs')
const { readNormalizedState } = require('./normalized-state-repository.cjs')
const { normalizedShadowIsPrepared } = require('./operational-storage.cjs')
const { readStorageControl } = require('./storage-control.cjs')

let lastDiagnostic = ''
const preparedSnapshots = new WeakSet()

async function readPersistentSnapshot(sql) {
  const statement = "select to_regclass('normalized_shadow.import_batch') as batch_table, to_regclass('normalized_shadow.storage_control') as control_table"
  const result = typeof sql.query === 'function' ? await sql.query(statement) : await sql.unsafe(statement)
  const [catalog] = result.rows || result
  if (!catalog?.batch_table || !catalog.control_table) return null
  // Selector, revision, credentials and payload share one PostgreSQL snapshot.
  // Avoid four sequential round trips and transient mixed-revision reads.
  const snapshot = await readNormalizedState(sql, { includeCredentials: true, includeControl: true, allowMissing: true })
  if (!snapshot) return null
  if (!snapshot.control) throw Object.assign(new Error('Falta el control de almacenamiento normalizado.'), { code: 'STORAGE_CONTROL_MISSING' })
  if (snapshot.control.model !== 'normalized') return null
  if (Number(snapshot.state.revision) !== Number(snapshot.control.revision)) throw Object.assign(new Error('La revisión normalizada no coincide con el selector persistente.'), { code: 'STORAGE_CONTROL_READ_CONFLICT' })
  preparedSnapshots.add(snapshot.state)
  return snapshot.state
}

function storageMode(environment = process.env) {
  const mode = String(environment.PIGNUS_STORAGE_MODE || 'persistent').trim().toLowerCase()
  if (!['persistent', 'legacy', 'shadow-read'].includes(mode)) throw Object.assign(new Error('El modo de almacenamiento solicitado no es válido.'), { code: 'INVALID_STORAGE_MODE' })
  return mode
}

function safeState(state) {
  return { ...state, employees: (state.employees || []).map(({ password, passwordHash, ...employee }) => employee) }
}

function compareApplicationStates(legacy, normalized) {
  const legacySafe = safeState(legacy), normalizedSafe = safeState(normalized)
  const legacyFingerprint = fingerprint(legacySafe), normalizedFingerprint = fingerprint(normalizedSafe)
  return {
    equal: legacyFingerprint === normalizedFingerprint,
    legacyFingerprint, normalizedFingerprint,
    revision: Number(legacy.revision || 0),
    counts: Object.fromEntries(['roles', 'employees', 'services', 'vehicles', 'customers', 'history', 'reviews'].map(key => [key, {
      legacy: (legacy[key] || []).length, normalized: (normalized[key] || []).length
    }]))
  }
}

function reportOnce(diagnostic, reporter) {
  const key = fingerprint(diagnostic)
  if (key === lastDiagnostic) return
  lastDiagnostic = key
  reporter(diagnostic)
}

async function readApplicationState(sql, options = {}) {
  const mode = storageMode(options.environment)
  const readLegacy = options.readLegacy || readLegacyState
  const readNormalized = options.readNormalized || readNormalizedState
  if (mode === 'persistent' && options.shadowPrepared == null && !options.readLegacy && !options.readNormalized && !options.readControl) {
    return (await readPersistentSnapshot(sql)) || readLegacy(sql)
  }
  const shadowPrepared = options.shadowPrepared == null ? (mode === 'persistent' && await normalizedShadowIsPrepared(sql)) : options.shadowPrepared
  if (mode === 'persistent' && shadowPrepared) {
    const control = await (options.readControl || readStorageControl)(sql)
    if (control.model === 'normalized') {
      const normalized = await readNormalized(sql, { includeCredentials: true })
      if (Number(normalized.revision) !== control.revision) throw Object.assign(new Error('La revisión normalizada no coincide con el selector persistente.'), { code: 'STORAGE_CONTROL_READ_CONFLICT' })
      return normalized
    }
  }
  const legacy = await readLegacy(sql)
  if (mode !== 'shadow-read') return legacy
  const reporter = options.reporter || (diagnostic => console.info('Comparación de almacenamiento:', JSON.stringify(diagnostic)))
  try {
    const normalized = await readNormalized(sql)
    const comparison = compareApplicationStates(legacy, normalized)
    reportOnce({ mode, status: comparison.equal ? 'match' : 'mismatch', ...comparison }, reporter)
  } catch (error) {
    reportOnce({ mode, status: 'unavailable', code: error.code || 'NORMALIZED_SHADOW_READ_FAILED', revision: Number(legacy.revision || 0) }, reporter)
  }
  return legacy
}

async function readApplicationRevision(sql, options = {}) {
  const mode = storageMode(options.environment)
  const readLegacy = options.readLegacyRevision || readLegacyRevision
  // Revision checks are the hot path used by every open administrator session.
  // Never rebuild customers, history and agendas just to compare one number.
  if (mode !== 'persistent') return Number(await readLegacy(sql) || 0)
  const shadowPrepared = options.shadowPrepared == null
    ? await (options.isShadowPrepared || normalizedShadowIsPrepared)(sql)
    : options.shadowPrepared
  if (!shadowPrepared) return Number(await readLegacy(sql) || 0)
  const control = await (options.readControl || readStorageControl)(sql)
  return control.model === 'normalized' ? Number(control.revision || 0) : Number(await readLegacy(sql) || 0)
}

module.exports = { compareApplicationStates, readApplicationRevision, readApplicationState, storageMode, preparedSnapshots }
