const { readState: readLegacyState } = require('./database.cjs')
const { fingerprint } = require('./normalization-analysis.cjs')
const { readNormalizedState } = require('./normalized-state-repository.cjs')
const { normalizedShadowIsPrepared } = require('./operational-storage.cjs')
const { readStorageControl } = require('./storage-control.cjs')

let lastDiagnostic = ''

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
  const state = await readApplicationState(sql, options)
  return Number(state.revision || 0)
}

module.exports = { compareApplicationStates, readApplicationRevision, readApplicationState, storageMode }
