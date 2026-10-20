function recordChanges(previous = [], next = [], key = 'id') {
  if (previous === next) return { removed: [], changed: [] }
  const before = new Map(previous.map(record => [String(record[key]), record]))
  const after = new Map(next.map(record => [String(record[key]), record]))
  return {
    removed: [...before.keys()].filter(id => !after.has(id)),
    changed: next.filter(record => {
      const existing = before.get(String(record[key]))
      return existing !== record && JSON.stringify(existing) !== JSON.stringify(record)
    })
  }
}
module.exports = { recordChanges }
