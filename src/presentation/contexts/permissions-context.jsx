import React, { createContext, useContext, useMemo } from 'react'
import policy from '../../../api/_lib/permission-catalog.cjs'

const legacyStandalone = { can: () => true, permissions: {}, user: null }
const PermissionsContext = createContext(legacyStandalone)
export function PermissionsProvider({ user, role, children }) {
  const value = useMemo(() => {
    const subject = { ...user, ...(role ? { code: role.code, roleCode: policy.roleCode(role), role: role.name, permissions: role.permissions } : {}) }
    const permissions = policy.resolvePermissions(subject)
    return { user: subject, permissions, can: key => permissions[key] === true || Boolean(policy.ALIASES[key]?.some(id => permissions[id])) }
  }, [user, role])
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}
export const usePermissions = () => useContext(PermissionsContext)
