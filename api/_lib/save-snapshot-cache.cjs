const { readApplicationState, preparedSnapshots, storageMode } = require('./storage-router.cjs')

// Process-local acceleration, never a source of truth. Every hit checks BOTH
// database revisions and the active model in a single fresh SQL snapshot.
// Password hashes are not cached: credential changes are read on every hit.
function createSaveSnapshotCache({ readFresh = readApplicationState } = {}) {
  let cached = null
  function remember(state) {
    if (cached && Number(cached.revision) > Number(state.revision)) return
    cached = structuredClone(state)
    for (const employee of cached.employees || []) { delete employee.password; delete employee.passwordHash }
  }
  return {
    remember,
    async read(sql) {
      if (storageMode() !== 'persistent') cached = null
      if (cached) {
        const statement = `select
          (select active_model from normalized_shadow.storage_control where id=1) as model,
          (select active_revision from normalized_shadow.storage_control where id=1) as revision,
          (select source_revision from normalized_shadow.import_batch where id=1) as batch_revision,
          coalesce((select jsonb_object_agg(employee_id, password_hash) from normalized_shadow.employee_credentials), '{}'::jsonb) as credentials`
        const result = typeof sql.query === 'function' ? await sql.query(statement) : await sql.unsafe(statement)
        const [meta] = result.rows || result
        if (meta?.model === 'normalized' && Number(meta.revision) === Number(cached.revision) && Number(meta.batch_revision) === Number(cached.revision)) {
          const state = structuredClone(cached)
          const credentials = typeof meta.credentials === 'string' ? JSON.parse(meta.credentials) : meta.credentials
          for (const employee of state.employees || []) if (Object.hasOwn(credentials, String(employee.id))) employee.passwordHash = credentials[String(employee.id)]
          preparedSnapshots.add(state)
          return state
        }
      }
      const state = await readFresh(sql)
      if (preparedSnapshots.has(state)) remember(state)
      else cached = null
      return state
    }
  }
}

module.exports = { createSaveSnapshotCache }
