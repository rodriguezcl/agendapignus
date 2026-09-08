function recordChanges(previous = [], next = [], key = 'id') {
  const before = new Map(previous.map(record => [String(record[key]), record]))
  const after = new Map(next.map(record => [String(record[key]), record]))
  return {
    removed: [...before.keys()].filter(id => !after.has(id)),
    changed: next.filter(record => JSON.stringify(before.get(String(record[key]))) !== JSON.stringify(record))
  }
}
module.exports = { recordChanges }
