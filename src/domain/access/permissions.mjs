import { normalizeServiceName } from '../shared/normalization.mjs'

// Single permission catalogue used by navigation and role administration.
export const MODULE_PERMISSIONS = [
  ['dashboard', 'Menú principal', 'Ver indicadores y resumen operativo'],
  ['weekly', 'Agenda semanal', 'Planificar los servicios de toda la semana'],
  ['agenda', 'Agenda del día', 'Crear y editar equipos y servicios'],
  ['history', 'Historial', 'Consultar y gestionar trabajos registrados'],
  ['accounts', 'Abonados y clientes', 'Consultar y administrar abonados y clientes'],
  ['employees', 'Empleados', 'Administrar técnicos y accesos'],
  ['services', 'Tipo de servicio', 'Administrar el catálogo de servicios'],
  ['vehicles', 'Vehículos', 'Administrar la flota de la empresa'],
  ['settings', 'Configuración', 'Modificar roles y permisos'],
  ['audit', 'Auditoría', 'Consultar acciones y accesos del sistema']
]

export const DEFAULT_MODULE_PERMISSIONS = Object.fromEntries(MODULE_PERMISSIONS.map(([key]) => [key, false]))

export const FEATURE_PERMISSIONS = [
  ['weekly', 'weeklyTeams', 'Equipos del mes', 'Definir la conformación mensual de los equipos'],
  ['weekly', 'weeklyHours', 'Horarios del mes', 'Modificar los horarios predeterminados del mes'],
  ['weekly', 'weeklyVehicles', 'Vehículos del mes', 'Asignar responsables y generar controles vehiculares'],
  ['weekly', 'weeklyGuards', 'Guardias del año', 'Configurar la rotación anual de guardias'],
  ['history', 'historyManage', 'Gestionar historial', 'Editar, completar, cancelar, reprogramar o eliminar registros'],
  ['accounts', 'accountsEdit', 'Crear y editar', 'Crear clientes y modificar sus datos'],
  ['accounts', 'accountsDelete', 'Eliminar registros', 'Eliminar clientes o abonados sin referencias'],
  ['accounts', 'accountsImport', 'Importar abonados', 'Importar el archivo maestro de cuentas']
]

export const DEFAULT_FEATURE_PERMISSIONS = Object.fromEntries(FEATURE_PERMISSIONS.map(([, key]) => [key, false]))

export const normalizeRoleName = normalizeServiceName

export const roleCode = role => role?.code || ({
  administrador: 'administrator',
  tecnico: 'technician',
  coordinador: 'coordinator',
  usuario: 'user'
}[normalizeRoleName(role?.name)] || `role-${role?.id}`)

export const resolvedRolePermissions = role => {
  const code = roleCode(role)
  const explicit = role?.permissions || {}
  const resolved = { ...DEFAULT_MODULE_PERMISSIONS, ...DEFAULT_FEATURE_PERMISSIONS, ...explicit }
  FEATURE_PERMISSIONS.forEach(([, featureKey]) => {
    if (code === 'administrator') resolved[featureKey] = true
    else if (explicit[featureKey] == null) resolved[featureKey] = false
  })
  if (code === 'administrator') Object.keys(resolved).forEach(key => { resolved[key] = true })
  return resolved
}
