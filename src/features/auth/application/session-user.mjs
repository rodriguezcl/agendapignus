const publicFields = [
  'id', 'email', 'name', 'firstName', 'lastName', 'roleId', 'role',
  'roleCode', 'permissions', 'technicalEnabled', 'status'
]

// Session metadata is authoritative even while a local form defers refreshing
// the editable state. Never accept metadata for a different signed-in account.
export function reconcileSessionUser(current, incoming) {
  if (!current?.id || !incoming?.id || String(current.id) !== String(incoming.id)) return current
  const allowed = Object.fromEntries(publicFields.filter(key => Object.hasOwn(incoming, key)).map(key => [key, incoming[key]]))
  const next = { ...current, ...allowed }
  return JSON.stringify(next) === JSON.stringify(current) ? current : next
}

export function currentSessionRole(user, roles = []) {
  const stored = roles.find(role => String(role.id) === String(user?.roleId))
    || (!user?.roleId ? roles.find(role => role.name === user?.role) : undefined)
  if (!user?.permissions) return stored
  const code = user.roleCode || stored?.code
  // Legacy hydration supplied these two defaults before the permission
  // catalogue existed. Explicit false still revokes access; V2 never defaults.
  const permissions = user.permissions.__catalogV2 === true ? user.permissions : {
    dashboard: true,
    weekly: user.permissions.weekly ?? ['administrator', 'user', 'coordinator'].includes(code),
    ...user.permissions
  }
  return {
    ...stored,
    id: user.roleId ?? stored?.id,
    code,
    name: user.role || stored?.name,
    permissions
  }
}
