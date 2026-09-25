const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const overlaps = (a, b) => a.slice(0, Math.min(a.length, b.length)).every((part, index) => equal(part, b[index]))

function lookup(state, path) {
  let value = state
  for (const segment of path) {
    if (typeof segment === 'object') {
      if (!Array.isArray(value)) return { found: false }
      const matches = value.filter(item => String(item?.[segment.key]) === segment.id)
      if (matches.length !== 1) return { found: false }
      value = matches[0]
    } else {
      if (!value || !Object.hasOwn(value, segment)) return { found: false }
      value = value[segment]
    }
  }
  return { found: true, value }
}

// Hydration repairs display projections without persisting them. Translate
// only an unchanged display baseline back to the same revision's server value.
// Never fetch/rebase onto a newer revision or replace a stale modal baseline.
export function alignOperationBaselines(operations, display, server) {
  if (!server || !display) return operations
  const touched = []
  return operations.map(operation => {
    const { path } = operation
    const affected = touched.some(previous => overlaps(previous, path))
    touched.push(path)
    const entity = path.at(-1)
    const service = (path[0] === 'history' && entity?.key === 'id') ||
      (path[0] === 'agenda' && entity?.key === 'taskId')
    if (!service || affected || !operation.existed) return operation
    const shown = lookup(display, path)
    const stored = lookup(server, path)
    if (!shown.found || !stored.found || !equal(operation.before, shown.value)) return operation
    return { ...operation, before: structuredClone(stored.value) }
  })
}
