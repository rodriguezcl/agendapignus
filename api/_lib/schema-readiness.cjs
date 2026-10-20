const readiness = new WeakMap()

// Call with the pool, before the operation transaction. Remember success only
// after the schema transaction commits, and share concurrent initialization.
async function ensureCommittedSchema(sql, key, initialize) {
  let schemas = readiness.get(sql)
  if (!schemas) { schemas = new Map(); readiness.set(sql, schemas) }
  if (!schemas.has(key)) {
    const pending = Promise.resolve().then(() => sql.begin(initialize))
    schemas.set(key, pending)
    pending.catch(() => { if (schemas.get(key) === pending) schemas.delete(key) })
  }
  return schemas.get(key)
}

module.exports = { ensureCommittedSchema }
