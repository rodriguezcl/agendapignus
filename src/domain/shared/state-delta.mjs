const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const collections = { roles: 'id', employees: 'id', services: 'id', vehicles: 'id', customers: 'customerId', history: 'id', reviews: 'id' }

// A delta is only applicable to the exact snapshot named by baseRevision.
// Missing/duplicate identities fall back to a full section replacement.
export function stateDelta(before, after) {
  const changes = {}
  for (const key of Object.keys(after)) {
    if (key === 'revision' || equal(before[key], after[key])) continue
    const id = collections[key], old = before[key], next = after[key]
    const valid = rows => Array.isArray(rows) && rows.every(row => row?.[id] != null) && new Set(rows.map(row => String(row[id]))).size === rows.length
    if (id && valid(old) && valid(next)) {
      const previous = new Map(old.map(row => [String(row[id]), row]))
      const order = next.map(row => String(row[id]))
      const ids = new Set(order)
      changes[key] = { id, upsert: next.filter(row => !equal(previous.get(String(row[id])), row)), removed: old.filter(row => !ids.has(String(row[id]))).map(row => String(row[id])) }
      if (!equal(old.map(row => String(row[id])), order)) changes[key].order = order
    } else if (key === 'agenda' && old && next) {
      const { weekly: oldWeekly = {}, ...oldDaily } = old
      const { weekly: nextWeekly = {}, ...nextDaily } = next
      const weekly = {}
      for (const day of new Set([...Object.keys(oldWeekly), ...Object.keys(nextWeekly)])) {
        if (!equal(oldWeekly[day], nextWeekly[day])) weekly[day] = Object.hasOwn(nextWeekly, day) ? { value: nextWeekly[day] } : { remove: true }
      }
      changes[key] = { weekly, ...(!equal(oldDaily, nextDaily) ? { daily: nextDaily } : {}) }
    } else changes[key] = { value: after[key] }
  }
  return { baseRevision: Number(before.revision), revision: Number(after.revision), changes }
}

export function applyStateDelta(base, delta) {
  if (!base || Number(base.revision) !== delta.baseRevision || delta.revision < delta.baseRevision) throw new Error('La respuesta no corresponde a la versión local.')
  const next = { ...base, revision: delta.revision }
  for (const [key, change] of Object.entries(delta.changes)) {
    if (!Object.hasOwn(collections, key) && !['agenda', 'preferences'].includes(key)) throw new Error('Sección de respuesta inválida.')
    if (Object.hasOwn(change, 'value')) next[key] = change.value
    else if (key === 'agenda') {
      const weekly = { ...base.agenda.weekly }
      for (const [day, patch] of Object.entries(change.weekly)) {
        if (['__proto__', 'prototype', 'constructor'].includes(day)) throw new Error('Ruta inválida.')
        if (patch.remove) delete weekly[day]; else weekly[day] = patch.value
      }
      next.agenda = { ...(change.daily || base.agenda), weekly }
    } else {
      if (change.id !== collections[key]) throw new Error('Identidad inválida.')
      const rows = new Map(base[key].map(row => [String(row[change.id]), row]))
      for (const id of change.removed) rows.delete(id)
      for (const row of change.upsert) rows.set(String(row[change.id]), row)
      next[key] = (change.order || [...rows.keys()]).map(id => {
        if (!rows.has(id)) throw new Error('Registro ausente en la respuesta.')
        return rows.get(id)
      })
    }
  }
  return next
}
