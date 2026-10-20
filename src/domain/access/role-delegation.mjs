import policy from '../../../api/_lib/permission-catalog.cjs'

export function canDelegateRole(user, role) {
  if (!policy.isGranular(user)) return true
  if (!role) return false
  if (policy.roleCode(role) === 'administrator' && policy.roleCode(user) !== 'administrator') return false
  // Minimal employee lookups expose the server's decision instead of the
  // complete role policy. Full policies can also be checked in role editors.
  if (typeof role.assignable === 'boolean') return role.assignable
  if (!role.permissions) return false
  const target = policy.toGranularPermissions(role)
  if (policy.CATALOG.some(({ id }) => target[id] && !policy.can(user, id))) return false
  for (const resource of ['services', 'customers']) {
    const actor = policy.readScope(user, resource)
    if (actor !== 'all' && actor !== policy.readScope(role, resource)) return false
  }
  const write = policy.writeScope(user, 'services')
  return write === 'all' || write === policy.writeScope(role, 'services')
}

export function canManageEmployeeAccount(user, employee, roles = []) {
  if (!policy.isGranular(user) || policy.roleCode(user) === 'administrator') return true
  const role = roles.find(item => String(item.id) === String(employee?.roleId))
  return policy.roleCode(role || { name: employee?.role }) !== 'administrator'
}
