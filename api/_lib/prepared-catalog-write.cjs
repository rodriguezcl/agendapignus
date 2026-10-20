const { assertPreparedRevision, retryPreparedWrite } = require('./prepared-state-write.cjs')
const { statePersistenceChanged } = require('./core.cjs')
const { preparedSnapshots } = require('./storage-router.cjs')
const { normalizedShadowIsPrepared } = require('./operational-storage.cjs')
const { prepareNormalizedStateWrite } = require('./normalized-state-repository.cjs')

// Read and validate before taking the shared revision lock. A concurrent commit
// discards this transaction and prepares again; record-level base checks remain
// the responsibility of prepare and are never retried as overwrites.
async function executePreparedCatalogWrite(sql, { snapshots, prepare, persist, audit }) {
  const result = await retryPreparedWrite(() => sql.begin(async transaction => {
    await transaction`set local lock_timeout = '15s'`
    await transaction`set local statement_timeout = '40s'`
    await transaction`insert into pignus_preferences (key, value) values ('state_revision', '0') on conflict (key) do nothing`
    const current = await snapshots.read(transaction)
    const { next, entries, response } = await prepare(current)
    const changed = statePersistenceChanged(current, next)
    const revision = Number(current.revision) + (changed ? 1 : 0)
    let projection
    if (changed && (preparedSnapshots.has(current) || await normalizedShadowIsPrepared(transaction))) {
      require('./journey-identity.cjs').synchronizeJourneyIdentity(next, current)
      require('./service-journeys.cjs').validateServiceJourneys(next, current)
      projection = prepareNormalizedStateWrite(current, { ...next, revision })
    }
    const revisionRows = await transaction`select value from pignus_preferences where key = 'state_revision' for update`
    assertPreparedRevision(current.revision, Number(revisionRows[0]?.value || 0))
    if (changed) {
      await persist(transaction, current, next, revision, projection)
      await audit(transaction, entries, { shadowPrepared: Boolean(projection) })
    }
    return {
      state: { ...(changed ? next : current), revision },
      normalized: preparedSnapshots.has(current),
      response: { ...response, revision }
    }
  }))
  // Only committed state may become a cache hit for the next request.
  if (result.normalized) snapshots.remember(result.state)
  return result.response
}

module.exports = { executePreparedCatalogWrite }
