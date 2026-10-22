import { canPermission } from './permissions.mjs'

export const OPERATIONAL_PLANNING_ID = 'operationalPlanning'
export const OPERATIONAL_PLANNING_LABEL = 'Planificación operativa'
export const OPERATIONAL_PLANNING_DESCRIPTION = 'Organizar los horarios, equipos, responsables de flota y guardias.'
export const OPERATIONAL_PLANNING_TABS = [
  { id: 'hours', label: 'Horarios', icon: 'clock', permission: 'weekly.monthlyHours.read' },
  { id: 'teams', label: 'Equipos', icon: 'users', permission: 'weekly.monthlyTeams.read' },
  { id: 'vehicles', label: 'Asignación de flota', icon: 'vehicle', permission: 'weekly.monthlyVehicles.read' },
  { id: 'guards', label: 'Guardias', icon: 'calendar', permission: 'weekly.guards.read' }
]

// This screen relocates existing capabilities without granting a new permission
// or bypassing their prerequisites, including access to the weekly agenda.
export function canAccessOperationalPlanning(subject) {
  return OPERATIONAL_PLANNING_TABS.some(tab => canPermission(subject, tab.permission))
}
