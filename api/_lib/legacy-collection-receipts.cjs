const catalog = require('./permission-catalog.cjs')
const receiptKeys = new Set(['receipt', 'receipts', 'receiptBefore', 'receiptAfter'])
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const identity = row => object(row) ? ['id', 'taskId', 'historyId', 'teamId', 'customerId'].find(key => row[key] != null) : null
const hidden = user => !catalog.isGranular(user) && !(catalog.can(user, 'collections.view') && catalog.can(user, 'records.financial'))

// Legacy history/planning keeps its existing projection. Only the new private
// receipt metadata is removed, including receipt references in payment events.
function project(value, inCollection = false) {
  if (Array.isArray(value)) {
    const rows = value.map(row => project(row, inCollection))
    return rows.some((row, index) => row !== value[index]) ? rows : value
  }
  if (!object(value)) return value
  let changed = false
  const entries = []
  for (const [key, child] of Object.entries(value)) {
    if (inCollection && receiptKeys.has(key)) { changed = true; continue }
    const next = project(child, inCollection || key === 'collection')
    if (next !== child) changed = true
    entries.push([key, next])
  }
  return changed ? Object.fromEntries(entries) : value
}

function restore(proposed, current, inCollection = false) {
  if (Array.isArray(proposed)) {
    const before = Array.isArray(current) ? current : []
    const key = [...before, ...proposed].map(identity).find(Boolean)
    const rows = key ? new Map(before.map(row => [String(row?.[key]), row])) : null
    return proposed.map((row, index) => restore(row, rows ? rows.get(String(row?.[key])) : before[index], inCollection))
  }
  if (!object(proposed)) return proposed
  const result = {}
  for (const [key, value] of Object.entries(proposed)) {
    if (inCollection && receiptKeys.has(key)) continue
    result[key] = key === 'collection' && !object(value) && object(current?.collection)
      ? current.collection : restore(value, current?.[key], inCollection || key === 'collection')
  }
  if (inCollection) {
    for (const key of receiptKeys) if (Object.hasOwn(current || {}, key)) result[key] = current[key]
  } else if (!Object.hasOwn(proposed, 'collection') && object(current?.collection)) {
    result.collection = current.collection
  }
  return result
}

function projectLegacyCollectionReceipts(value, user) {
  return hidden(user) ? project(value) : value
}
function restoreLegacyCollectionReceipts(proposed, current, user) {
  return hidden(user) ? restore(proposed, current) : proposed
}

module.exports = { projectLegacyCollectionReceipts, restoreLegacyCollectionReceipts }
