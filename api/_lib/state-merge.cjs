const ABSENT = Symbol('absent')

function canonical(value) {
  if (value === ABSENT) return '__PIGNUS_ABSENT__'
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

function equivalent(left, right) {
  if (left === ABSENT || right === ABSENT) return left === right
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function itemIdentity(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
  if (item.taskId != null && String(item.taskId).trim()) return `task:${String(item.taskId)}`
  if (item.historyId != null && String(item.historyId).trim()) return `history:${String(item.historyId)}`
  if (item.teamId != null && String(item.teamId).trim()) return `team:${String(item.teamId)}`
  if (item.customerId != null && String(item.customerId).trim()) return `customer:${String(item.customerId)}`
  if (item.id != null && String(item.id).trim()) return `id:${String(item.id)}`
  if (item.account != null && String(item.account).trim()) return `account:${String(item.account)}`
  return ''
}

function keyedArray(values) {
  const present = values.filter(value => value !== ABSENT).flat()
  return present.length > 0 && present.every(item => itemIdentity(item))
}

function conflict(path) {
  const error = new Error(`Los datos de ${path || 'este registro'} también cambiaron en otra sesión. Revisá la versión actual antes de volver a guardar.`)
  error.statusCode = 409
  error.code = 'STATE_WRITE_CONFLICT'
  error.conflictPath = path
  throw error
}

function mergeArray(base, current, incoming, path) {
  if (!keyedArray([base, current, incoming])) return conflict(path)
  const maps = [base, current, incoming].map(value => new Map((value === ABSENT ? [] : value).map(item => [itemIdentity(item), item])))
  const order = [...new Set([...(current === ABSENT ? [] : current).map(itemIdentity), ...(incoming === ABSENT ? [] : incoming).map(itemIdentity)])]
  return order.flatMap(identity => {
    const merged = mergeValue(
      maps[0].has(identity) ? maps[0].get(identity) : ABSENT,
      maps[1].has(identity) ? maps[1].get(identity) : ABSENT,
      maps[2].has(identity) ? maps[2].get(identity) : ABSENT,
      `${path}[${identity}]`
    )
    return merged === ABSENT ? [] : [merged]
  })
}

function mergeObject(base, current, incoming, path) {
  const baseObject = base === ABSENT ? {} : base
  const currentObject = current === ABSENT ? {} : current
  const incomingObject = incoming === ABSENT ? {} : incoming
  const keys = [...new Set([...Object.keys(baseObject), ...Object.keys(currentObject), ...Object.keys(incomingObject)])]
  const merged = {}
  keys.forEach(key => {
    const value = mergeValue(
      Object.hasOwn(baseObject, key) ? baseObject[key] : ABSENT,
      Object.hasOwn(currentObject, key) ? currentObject[key] : ABSENT,
      Object.hasOwn(incomingObject, key) ? incomingObject[key] : ABSENT,
      path ? `${path}.${key}` : key
    )
    if (value !== ABSENT) merged[key] = value
  })
  return merged
}

function mergeValue(base, current, incoming, path) {
  if (equivalent(incoming, base)) return current
  if (equivalent(current, base)) return incoming
  if (equivalent(current, incoming)) return current

  const currentIsArray = Array.isArray(current)
  const incomingIsArray = Array.isArray(incoming)
  const baseIsArray = base === ABSENT || Array.isArray(base)
  if (currentIsArray && incomingIsArray && baseIsArray) return mergeArray(base, current, incoming, path)

  const objectLike = value => value === ABSENT || Boolean(value && typeof value === 'object' && !Array.isArray(value))
  if (objectLike(base) && objectLike(current) && objectLike(incoming)) return mergeObject(base, current, incoming, path)
  return conflict(path)
}

function persistentState(state = {}) {
  return {
    roles: state.roles || [],
    employees: state.employees || [],
    services: state.services || [],
    vehicles: state.vehicles || [],
    customers: state.customers || [],
    history: state.history || [],
    reviews: state.reviews || [],
    agenda: state.agenda || {},
    preferences: { theme: state.preferences?.theme || 'light' }
  }
}

function concurrentStateChanged(base = {}, current = {}) {
  const normalizedBase = persistentState(base)
  const normalizedCurrent = persistentState(current)
  const visibleCollections = ['roles', 'employees', 'services', 'vehicles', 'customers', 'history', 'reviews', 'agenda']
  if (visibleCollections.some(key => Object.hasOwn(base, key) && !equivalent(normalizedBase[key], normalizedCurrent[key]))) return true
  return Boolean(base.preferences && Object.hasOwn(base.preferences, 'theme') && !equivalent(normalizedBase.preferences, normalizedCurrent.preferences))
}

function mergeConcurrentState(base, current, incoming) {
  const normalizedBase = persistentState(base)
  const normalizedCurrent = persistentState(current)
  const normalizedIncoming = persistentState(incoming)
  const merged = { ...normalizedCurrent }
  const sections = ['roles', 'employees', 'services', 'vehicles', 'customers', 'history', 'reviews', 'agenda', 'preferences']
  sections.forEach(section => {
    if (!Object.hasOwn(base, section)) return
    merged[section] = mergeValue(normalizedBase[section], normalizedCurrent[section], normalizedIncoming[section], section)
  })
  return merged
}

module.exports = { concurrentStateChanged, mergeConcurrentState, persistentState }
