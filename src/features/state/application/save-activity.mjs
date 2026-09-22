export function operationScopes(operations) {
  const scopes = new Set()
  for (const op of operations) {
    const path = op.path || []
    if (path[0] === 'history') scopes.add(`history:${path[1]?.id}`)
    else if (path[0] === 'agenda') {
      const task = path.find(segment => segment?.key === 'taskId')
      if (task) scopes.add(`task:${task.id}`)
      else return ['*'] // team/configuration/date changes affect multiple services
    } else return ['*']
    for (const value of [op.before, op.after]) {
      if (value?.sourceTaskId) scopes.add(`task:${value.sourceTaskId}`)
      if (value?.historyId) scopes.add(`history:${value.historyId}`)
    }
  }
  return [...scopes]
}

export function createSaveActivity() {
  const active = new Map()
  return {
    acquire(scopes = ['*']) {
      for (const held of active.values()) {
        if (held.includes('*') || scopes.includes('*') || scopes.some(key => held.includes(key))) {
          throw new Error('Este servicio o su planificación ya se está guardando. Esperá su confirmación.')
        }
      }
      const token = Symbol()
      active.set(token, scopes)
      return () => active.delete(token)
    },
    get size() { return active.size }
  }
}

// Keep newer local edits while a save is in flight. Arrays of services merge by
// identity, never by position; the remote snapshot remains the save baseline.
export function preserveLocalDraft(base, local, remote) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const object = v => v && typeof v === 'object' && !Array.isArray(v)
  let conflict = false
  function merge(before, current, incoming, field = '') {
    if (equal(before, current)) return incoming
    if (equal(current, incoming)) return incoming
    if (Array.isArray(before) && Array.isArray(current) && Array.isArray(incoming)) {
      const key = field === 'customers' ? 'customerId' : field === 'tasks' ? 'taskId' : field === 'teams' ? 'teamId' : 'id'
      const valid = list => list.every(item => item?.[key] != null) && new Set(list.map(item => String(item[key]))).size === list.length
      if (valid(before) && valid(current) && valid(incoming)) {
        const maps = [before, current, incoming].map(list => new Map(list.map(item => [String(item[key]), item])))
        const order = [...new Set([...incoming, ...current].map(item => String(item[key])))]
        return order.flatMap(id => {
          const value = merge(maps[0].get(id), maps[1].get(id), maps[2].get(id), key)
          return value === undefined ? [] : [value]
        })
      }
    }
    if (object(before) && object(current) && object(incoming)) {
      const result = {}
      for (const key of new Set([...Object.keys(before), ...Object.keys(current), ...Object.keys(incoming)])) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
        const value = merge(before[key], current[key], incoming[key], key)
        if (value !== undefined) result[key] = value
      }
      return result
    }
    if (!equal(before, incoming)) conflict = true
    return current
  }
  return { state: merge(base, local, remote), conflict }
}
