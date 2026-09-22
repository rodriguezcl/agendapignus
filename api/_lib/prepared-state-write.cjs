const RETRY = 'PREPARED_STATE_CHANGED'

function assertPreparedRevision(preparedRevision, actualRevision) {
  if (Number(preparedRevision) !== Number(actualRevision)) throw Object.assign(new Error('La base cambió durante la preparación.'), { code: RETRY })
}

// Release the transaction before rebuilding: an unrelated writer must not wait
// for validation/normalization of an obsolete snapshot while we hold its lock.
async function retryPreparedWrite(attempt, limit = 5) {
  for (let index = 0; index < limit; index++) {
    try { return await attempt(index) } catch (error) {
      if (error.code !== RETRY && error.code !== 'STORAGE_CONTROL_READ_CONFLICT') throw error
      if (index === limit - 1) throw Object.assign(new Error('Hay varios guardados simultáneos. Reintentá en un momento.'), { statusCode: 503, code: 'STATE_WRITE_BUSY' })
    }
  }
}

module.exports = { assertPreparedRevision, retryPreparedWrite }
