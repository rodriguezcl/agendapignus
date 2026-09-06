const STATE_SECTIONS = ['roles', 'employees', 'services', 'vehicles', 'customers', 'history', 'reviews', 'agenda', 'preferences']

function equivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function compactStateBase(base = {}, next = {}) {
  return Object.fromEntries(STATE_SECTIONS.flatMap(section => (
    Object.hasOwn(base, section) && !equivalent(base[section], next[section])
      ? [[section, base[section]]]
      : []
  )))
}
