import { normalizeServiceName } from '../shared/normalization.mjs'
import permissionPolicy from '../../../api/_lib/permission-catalog.cjs'
export const { CATALOG, MODULES, PERMISSION_GROUPS, BY_ID, NOTIFICATION_IDS, VERSION_KEY, SCOPE_KEYS, ALIASES, isGranular, toGranularPermissions, readScope, writeScope, hasAnyWrite, dependencyReason, normalizePermissions, togglePermission } = permissionPolicy
export const canPermission = permissionPolicy.can

// Single permission catalogue used by navigation and role administration.
export const MODULE_PERMISSIONS = [
  ['dashboard', 'Resumen general', 'Ver indicadores y resumen operativo'],
  ['weekly', 'Agenda semanal', 'Planificar los servicios de toda la semana'],
  ['agenda', 'Agenda del día', 'Crear y editar equipos y servicios'],
  ['collections', 'Cobranzas', 'Consultar pagos pendientes, confirmados y su historial'],
  ['history', 'Historial', 'Consultar y gestionar trabajos registrados'],
  ['accounts', 'Abonados y clientes', 'Consultar y administrar abonados y clientes'],
  ['map', 'Mapa', 'Consultar la distribución geográfica y concentración de abonados'],
  ['employees', 'Colaboradores', 'Administrar técnicos y accesos'],
  ['services', 'Tipos de servicio', 'Administrar el catálogo de servicios'],
  ['vehicles', 'Flota', 'Administrar la flota de la empresa'],
  ['settings', 'Configuración', 'Modificar roles y permisos'],
  ['audit', 'Auditoría', 'Consultar acciones y accesos del sistema']
]

export const DEFAULT_MODULE_PERMISSIONS = Object.fromEntries(MODULE_PERMISSIONS.map(([key]) => [key, false]))

export const FEATURE_PERMISSIONS = [
  ['weekly', 'weeklyTeams', 'Equipos del mes', 'Definir la conformación mensual de los equipos'],
  ['weekly', 'weeklyHours', 'Horarios del mes', 'Modificar los horarios predeterminados del mes'],
  ['weekly', 'weeklyVehicles', 'Vehículos del mes', 'Asignar responsables y generar controles vehiculares'],
  ['weekly', 'weeklyGuards', 'Guardias del año', 'Configurar la rotación anual de guardias'],
  ['collections', 'collectionsManage', 'Gestionar cobranzas', 'Confirmar pagos y rectificar monto y forma de pago'],
  ['history', 'historyManage', 'Gestionar historial', 'Editar, completar, cancelar, reprogramar o eliminar registros'],
  ['accounts', 'accountsEdit', 'Crear y editar', 'Crear clientes y modificar sus datos'],
  ['accounts', 'accountsDelete', 'Eliminar registros', 'Eliminar clientes o abonados sin referencias'],
  ['accounts', 'accountsImport', 'Importar abonados', 'Importar el archivo maestro de cuentas']
]

export const DEFAULT_FEATURE_PERMISSIONS = Object.fromEntries(FEATURE_PERMISSIONS.map(([, key]) => [key, false]))

export const normalizeRoleName = normalizeServiceName

export const roleCode = role => isGranular(role) ? permissionPolicy.roleCode(role) : normalizeRoleName(role?.name) === 'operador' ? 'operator' : normalizeRoleName(role?.name) === 'supervisor' ? 'supervisor' : role?.code || ({
  administrador: 'administrator',
  tecnico: 'technician',
  coordinador: 'coordinator',
  usuario: 'user',
  supervisor: 'supervisor'
}[normalizeRoleName(role?.name)] || `role-${role?.id}`)

export const resolvedRolePermissions = role => {
  if (isGranular(role)) return { ...toGranularPermissions(role), ...permissionPolicy.permissionsWithAliases(role) }
  const code = roleCode(role)
  const explicit = role?.permissions || {}
  const resolved = { ...DEFAULT_MODULE_PERMISSIONS, ...DEFAULT_FEATURE_PERMISSIONS, ...explicit }
  if (code === 'operator') {
    Object.keys(resolved).forEach(key => { resolved[key] = false })
    resolved.weekly = true
    return resolved
  }
  if (code === 'supervisor') {
    Object.keys(resolved).forEach(key => { resolved[key] = false })
    resolved.history = true
    resolved.accounts = true
    return resolved
  }
  FEATURE_PERMISSIONS.forEach(([, featureKey]) => {
    if (code === 'administrator') resolved[featureKey] = true
    else if (explicit[featureKey] == null) resolved[featureKey] = false
  })
  if (code === 'administrator') Object.keys(resolved).forEach(key => { resolved[key] = true })
  return resolved
}
