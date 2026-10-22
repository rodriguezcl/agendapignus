import permissionPolicy from '../../../api/_lib/permission-catalog.cjs'
import { CATALOG, MODULES, NOTIFICATION_IDS, canPermission, dependencyReason, hasAnyWrite, readScope, roleCode, toGranularPermissions, writeScope } from './permissions.mjs'
import { navigationForModules } from './navigation.mjs'
import { canAccessOperationalPlanning, OPERATIONAL_PLANNING_ID, OPERATIONAL_PLANNING_LABEL, OPERATIONAL_PLANNING_DESCRIPTION } from './operational-planning.mjs'

const notificationTitles = {
  'notifications.collections': 'Cobranza pendiente de pago',
  'notifications.reservations': 'Reserva pendiente de vincular con un PIG',
  'notifications.pendingToday': 'Pendientes de gestión',
  'notifications.confirmation': 'Pendientes de confirmación',
  'notifications.rescheduling': 'Pendientes de reprogramación',
  'notifications.overdue': 'Pendientes de días anteriores',
  'notifications.insurance': 'Seguro vehicular desactualizado',
  'notifications.softguard': 'Baja pendiente en SoftGuard / verificación de cuentas',
  'notifications.passwordRequests': 'Solicitud de cambio de contraseña'
}
const scopeDescriptions = {
  all: 'Todos los registros autorizados por los permisos del rol.',
  assigned: 'Sólo servicios asignados al colaborador.',
  cctv: 'Sólo registros de clientes con seguimiento CCTV.',
  related: 'Sólo clientes vinculados a servicios asignados al colaborador.',
  none: 'Sin acceso: hay más de un alcance seleccionado. Corregí la configuración.'
}
const technicalConditions = [
  'La cuenta del colaborador debe estar activa y habilitada para trabajo técnico, o tener el rol técnico.',
  'El servicio o control debe estar asignado al colaborador.',
  'También se verifican la confirmación, el horario, el estado y la secuencia de jornadas del servicio.'
]

/**
 * Projects the role editor's current draft without a session, business data or
 * persistence. Employee technical eligibility is an explicit preview scenario.
 * The same catalogue resolver that guards the app evaluates each capability.
 */
export function buildRolePreview(role, { technicalEnabled = false } = {}) {
  const code = roleCode(role)
  const permissions = toGranularPermissions({ ...role, technicalEnabled: technicalEnabled === true })
  const subject = permissionPolicy.permissionSnapshot({ code, roleCode: code, permissions })
  const can = id => canPermission(subject, id)
  const eligible = code === 'technician' || technicalEnabled === true
  const technicalConfigured = can('technical.view')
  const missingTechnical = 'Requiere habilitar la función técnica en la ficha del colaborador.'
  const denied = id => dependencyReason(id, permissions) || 'Este permiso está desactivado para el rol.'
  const modules = [...MODULES.filter(([id])=>id!=='followups'), [OPERATIONAL_PLANNING_ID, OPERATIONAL_PLANNING_LABEL, OPERATIONAL_PLANNING_DESCRIPTION]].map(([id, label, description]) => {
    const planning = id === OPERATIONAL_PLANNING_ID
    const granted = planning ? canAccessOperationalPlanning(subject) : can(`${id}.view`)
    const visible = granted && (id !== 'technical' || eligible)
    const reason = visible ? '' : granted ? missingTechnical : planning ? 'Requiere consultar horarios, equipos, asignación de flota o guardias.' : denied(`${id}.view`)
    const capabilities = CATALOG.filter(item => !item.hidden && item.groups.includes(id) && !NOTIFICATION_IDS.includes(item.id)).map(item => {
      const granted = can(item.id)
      const allowed = visible && granted
      return { id: item.id, label: item.label, note: item.note, granted, allowed, reason: allowed ? '' : !visible ? reason : denied(item.id) }
    })
    return { id, label, description, visible, reason, capabilities }
  })
  const visibleModules = modules.filter(module => module.visible)
  const hiddenModules = modules.filter(module => !module.visible)
  const portalOnly = technicalConfigured && eligible && visibleModules.every(module => ['technical', 'tickets', 'followups'].includes(module.id))
  const readOnly = !hasAnyWrite(subject)
  const helpVisible = !readOnly && !portalOnly
  const navigation = navigationForModules([
    ...visibleModules.map(module => module.id === 'technical' ? 'myServices' : module.id),
    ...(helpVisible ? ['help'] : [])
  ]).map(({ id, label }) => ({ id, label }))
  const notifications = CATALOG.filter(item => !item.hidden && NOTIFICATION_IDS.includes(item.id)).map(item => ({
    id: item.id,
    label: item.label,
    title: notificationTitles[item.id] || item.label,
    note: item.note,
    enabled: can(item.id),
    reason: can(item.id) ? '' : denied(item.id)
  }))
  notifications.push({
    id: 'administrator.advanceRequests',
    label: 'Recibir solicitudes para adelantar servicios',
    title: 'Solicitud para adelantar servicio',
    note: 'Aviso reservado al administrador cuando existe una solicitud activa.',
    enabled: code === 'administrator',
    reason: code === 'administrator' ? '' : 'Reservado al administrador.'
  })
  const scopes = [
    { id: 'services.read', label: 'Servicios que puede consultar', value: readScope(subject) },
    { id: 'services.write', label: 'Servicios sobre los que puede actuar', value: writeScope(subject) },
    { id: 'customers.read', label: 'Clientes que puede consultar', value: readScope(subject, 'customers') }
  ].map(scope => ({ ...scope, description: scopeDescriptions[scope.value] }))

  return {
    roleName: String(role?.name || '').trim() || 'Nuevo rol',
    roleCode: code,
    permissions,
    modules,
    visibleModules,
    hiddenModules,
    navigation,
    notifications,
    enabledNotifications: notifications.filter(item => item.enabled),
    scopes,
    technical: { eligible, configured: technicalConfigured, visible: technicalConfigured && eligible, conditions: [...technicalConditions] },
    readOnly,
    portalOnly,
    helpVisible
  }
}
