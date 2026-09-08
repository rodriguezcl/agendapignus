// Transport only the changed entities, never a replacement history snapshot.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const identityKey = path => path.at(-1) === 'customers' ? 'customerId'
  : path.at(-1) === 'tasks' ? 'taskId' : path.at(-1) === 'teams' ? 'teamId' : 'id'

export function stateOperations(base, next) {
  if (!base) throw new Error('Falta la versión de origen. Recargá antes de guardar.')
  const operations = []
  const visit = (before, after, path) => {
    if (equal(before, after)) return
    if (Array.isArray(before) && Array.isArray(after)) {
      const key = identityKey(path)
      const valid = list => list.every(item => item && item[key] != null) && new Set(list.map(item => String(item[key]))).size === list.length
      if (valid(before) && valid(after)) {
        const old = new Map(before.map(item => [String(item[key]), item]))
        const fresh = new Map(after.map(item => [String(item[key]), item]))
        for (const id of new Set([...old.keys(), ...fresh.keys()])) visit(old.get(id), fresh.get(id), [...path, { key, id }])
        return
      }
      if (path.length === 1 && path[0] === 'history') throw new Error('Hay registros sin identificador único. No se enviaron cambios del historial.')
    }
    const object = value => value && typeof value === 'object' && !Array.isArray(value)
    // A service is an atomic edit: two drafts of the same service must conflict,
    // even when they changed different fields. Teams remain structural containers.
    const entity = typeof path.at(-1) === 'object' && path.at(-1).key !== 'teamId'
    if (!entity && object(before) && object(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) visit(before[key], after[key], [...path, key])
      return
    }
    operations.push({ path, before: before ?? null, after: after ?? null, existed: before !== undefined, exists: after !== undefined })
  }
  for (const section of ['roles', 'employees', 'services', 'vehicles', 'customers', 'history', 'reviews', 'agenda', 'preferences']) {
    if (Object.hasOwn(base, section)) visit(base[section], next[section], [section])
  }
  return operations
}
