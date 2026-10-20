import { usePermissions } from '../contexts/permissions-context.jsx'
import { isGranular } from '../../domain/access/permissions.mjs'

// Legacy screens keep their existing contextual checks. Versioned roles use
// the action catalogue, including when the old module-wide flag is false.
export function useActionPermissions() {
  const { can: canPermission, user, permissions } = usePermissions()
  const granular = isGranular(user)
  const can = (permission, ...legacy) => granular ? canPermission(permission) : legacy.length ? Boolean(legacy[0]) : true
  return { can, user, permissions, granular }
}
