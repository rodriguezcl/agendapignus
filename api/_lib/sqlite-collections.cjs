const { randomUUID } = require('node:crypto')
const { recordChanges } = require('./record-changes.cjs')

function replaceSqliteRows(db, table, records, key, previous = null, identityKey = key) {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(key)) throw new Error('Invalid collection identifier.')
  const before = previous || db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(row.data))
  const delta = recordChanges(before, records || [], identityKey)
  if (!delta.changed.length && !delta.removed.length) return
  const existing = new Map(before.map(record => [String(record[identityKey]), record]))
  const remove = db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`)
  for (const id of delta.removed) remove.run(String(existing.get(id)[key]))

  // A customer's account may change while customerId stays the same. Park
  // renamed keys inside the caller's transaction, allowing swaps and preserving
  // each rowid (the local creation order) instead of replacing physical rows.
  const renamedKeys = new Map()
  if (identityKey !== key) {
    const rename = db.prepare(`UPDATE ${table} SET ${key} = ? WHERE ${key} = ?`)
    const prefix = `__pignus_${randomUUID()}__`
    for (const record of delta.changed) {
      const id = String(record[identityKey])
      const old = existing.get(id)
      if (!old || String(old[key]) === String(record[key])) continue
      const temporaryKey = prefix + id
      rename.run(temporaryKey, String(old[key]))
      renamedKeys.set(id, temporaryKey)
    }
  }

  // SQLite REPLACE deletes the old row, which changes rowid and may cascade to
  // related data. UPSERT updates the existing row in place.
  const upsert = db.prepare(`INSERT INTO ${table} (${key}, data) VALUES (?, ?) ON CONFLICT(${key}) DO UPDATE SET data = excluded.data`)
  const updateRenamed = db.prepare(`UPDATE ${table} SET ${key} = ?, data = ? WHERE ${key} = ?`)
  for (const record of delta.changed) {
    const recordKey = String(record[key])
    const serialized = JSON.stringify(record)
    const temporaryKey = renamedKeys.get(String(record[identityKey]))
    if (temporaryKey) updateRenamed.run(recordKey, serialized, temporaryKey)
    else upsert.run(recordKey, serialized)
  }
}

module.exports = { replaceSqliteRows }
