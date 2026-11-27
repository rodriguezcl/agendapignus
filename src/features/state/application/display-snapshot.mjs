const catalogs = ['roles', 'employees', 'services', 'customers']

export function sameCatalogs(previous, next) {
  return Boolean(previous && catalogs.every(key => previous[key] === next[key]))
}

export function sameDisplaySections(previous, next) {
  return sameCatalogs(previous, next) && previous.vehicles === next.vehicles && previous.history === next.history
    && previous.agenda.date === next.agenda.date && previous.agenda.teams === next.agenda.teams
    && previous.agenda.weekly === next.agenda.weekly
}

// A delta retains the identity of unchanged records and days. Keep the
// comparison baseline detached from the visible state, including on refresh.
export function createServerSnapshotCopier() {
  const copies = new WeakMap()
  function copy(value, build = structuredClone) {
    if (value === null || typeof value !== 'object') return value
    if (!copies.has(value)) copies.set(value, build(value))
    return copies.get(value)
  }
  function copyFields(value, transforms) {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [
      key, copy(field, Object.hasOwn(transforms, key) ? transforms[key] : structuredClone)
    ]))
  }
  return state => copyFields(state, {
    history: rows => rows.map(row => copy(row)),
    agenda: agenda => copyFields(agenda, {
      weekly: days => Object.fromEntries(Object.entries(days).map(([day, plan]) => [day, copy(plan)]))
    })
  })
}
