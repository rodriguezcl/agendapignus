const { readNormalizedState } = require('./normalized-state-repository.cjs')
const { analyzeNormalization, fingerprint } = require('./normalization-analysis.cjs')
const { userForEmployee, stateSessionUser } = require('./core.cjs')
const { inTransaction } = require('./state-write-coordinator.cjs')

function failure(code) {
  return Object.assign(new Error(code), { code })
}

async function rows(sql, statement, values = []) {
  const result = typeof sql.query === 'function' ? await sql.query(statement, values) : await sql.unsafe(statement, values)
  return result.rows || result
}

async function readMetadata(sql, lock = false) {
  const suffix = lock ? ' for update' : ''
  // Match normal writes: shared revision, import batch, then storage selector.
  const [legacy] = await rows(sql, "select value from pignus_preferences where key = 'state_revision'" + suffix)
  const [batch] = await rows(sql, 'select source_revision, source_fingerprint from normalized_shadow.import_batch where id = 1' + suffix)
  const [control] = await rows(sql, 'select active_model, active_revision, active_fingerprint from normalized_shadow.storage_control where id = 1' + suffix)
  if (!legacy || !batch || !control) throw failure('SESSION_METADATA_REPAIR_MISSING_METADATA')
  const revision = Number(batch.source_revision)
  if (control.active_model !== 'normalized' || !Number.isSafeInteger(revision) || revision < 0 ||
      Number(legacy.value) !== revision || Number(control.active_revision) !== revision ||
      control.active_fingerprint !== batch.source_fingerprint) {
    throw failure('SESSION_METADATA_REPAIR_STORAGE_MISMATCH')
  }
  return { revision, fingerprint: batch.source_fingerprint, legacyValue: legacy.value }
}

function recognize(state, metadata) {
  if (Number(state.revision) !== metadata.revision) throw failure('SESSION_METADATA_REPAIR_STORAGE_MISMATCH')
  const analysis = analyzeNormalization(state)
  if (analysis.summary.bySeverity.error) throw failure('SESSION_METADATA_REPAIR_INTEGRITY_ERROR')
  const healthy = analysis.sourceFingerprint === metadata.fingerprint
  if (!healthy) {
    // Reproduce the old SHA exactly. Revision agreement alone never authorizes
    // a repair, and arbitrary discrepancies retain the normal fail-closed path.
    const safe = { ...state, employees: state.employees.map(({ password, passwordHash, ...employee }) => employee) }
    const recognized = state.employees.some(employee => {
      const user = userForEmployee(employee, state.roles)
      return user && fingerprint({ ...safe, sessionUser: stateSessionUser(state, user) }) === metadata.fingerprint
    })
    if (!recognized) throw failure('SESSION_METADATA_REPAIR_UNRECOGNIZED_FINGERPRINT')
  }
  if (!healthy && !Number.isSafeInteger(metadata.revision + 1)) throw failure('SESSION_METADATA_REPAIR_REVISION_OVERFLOW')
  const next = healthy ? analysis : analyzeNormalization({ ...state, revision: metadata.revision + 1 })
  return {
    healthy, repairable: !healthy, applied: false,
    revision: metadata.revision, fingerprint: metadata.fingerprint,
    persistentFingerprint: analysis.sourceFingerprint,
    nextRevision: next.revision, nextFingerprint: next.sourceFingerprint
  }
}

async function inspectSessionMetadataRepair(sql) {
  return inTransaction(sql, async transaction => {
    await rows(transaction, 'set transaction isolation level repeatable read read only')
    const metadata = await readMetadata(transaction)
    return recognize(await readNormalizedState(transaction), metadata)
  })
}

async function repairSessionMetadata(sql, { expectedRevision, expectedFingerprint } = {}) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-f0-9]{64}$/.test(expectedFingerprint || '')) {
    throw failure('SESSION_METADATA_REPAIR_EXPECTED_BASE_REQUIRED')
  }
  return inTransaction(sql, async transaction => {
    await rows(transaction, "set local lock_timeout = '15s'")
    await rows(transaction, "set local statement_timeout = '40s'")
    const metadata = await readMetadata(transaction, true)
    if (metadata.revision !== expectedRevision || metadata.fingerprint !== expectedFingerprint) {
      throw failure('SESSION_METADATA_REPAIR_STALE_EXPECTATION')
    }
    const state = await readNormalizedState(transaction)
    const result = recognize(state, metadata)
    if (result.healthy) return result
    const nextAnalysis = analyzeNormalization({ ...state, revision: result.nextRevision })
    const updates = [
      ["update pignus_preferences set value = $1, updated_at = now() where key = 'state_revision' and value = $2 returning key",
        [String(result.nextRevision), metadata.legacyValue]],
      ['update normalized_shadow.import_batch set source_revision = $1, source_fingerprint = $2, report = $3::jsonb where id = 1 and source_revision = $4 and source_fingerprint = $5 returning id',
        [result.nextRevision, result.nextFingerprint, JSON.stringify(nextAnalysis.summary), metadata.revision, metadata.fingerprint]],
      ["update normalized_shadow.storage_control set active_revision = $1, active_fingerprint = $2 where id = 1 and active_model = 'normalized' and active_revision = $3 and active_fingerprint = $4 returning id",
        [result.nextRevision, result.nextFingerprint, metadata.revision, metadata.fingerprint]]
    ]
    for (const [statement, values] of updates) {
      if ((await rows(transaction, statement, values)).length !== 1) throw failure('SESSION_METADATA_REPAIR_STALE_EXPECTATION')
    }
    return { ...result, applied: true }
  })
}

module.exports = { inspectSessionMetadataRepair, repairSessionMetadata }
