import { MODULES } from './permissions.mjs'

const sections = {
  operation: { section: 'operation', sectionLabel: 'Operación' },
  customers: { section: 'customers', sectionLabel: 'Clientes y cobranzas' },
  resources: { section: 'resources', sectionLabel: 'Recursos', collapsible: true },
  administration: { section: 'administration', sectionLabel: 'Administración', collapsible: true }
}

// Stable presentation order shared by the application and the role preview.
// Visibility remains the responsibility of the existing access resolver.
export const NAVIGATION_ITEMS = [
  ['dashboard', 'dashboard'],
  ['weekly', 'calendar', 'operation'],
  ['agenda', 'calendar', 'operation'],
  ['history', 'history', 'operation'],
  ['followups', 'check', 'operation'],
  ['myServices', 'tools', 'operation'],
  ['accounts', 'accounts', 'customers'],
  ['collections', 'wallet', 'customers'],
  ['map', 'map', 'customers'],
  ['employees', 'users', 'resources'],
  ['vehicles', 'vehicle', 'resources'],
  ['services', 'tools', 'resources'],
  ['settings', 'settings', 'administration'],
  ['audit', 'audit', 'administration'],
  ['help', 'help']
].map(([id, icon, section]) => ({
  id,
  icon,
  label: id === 'myServices' ? 'Mis servicios' : id === 'help' ? 'Centro de ayuda' : MODULES.find(([moduleId]) => moduleId === id)[1],
  ...sections[section]
}))

export function navigationForModules(moduleIds) {
  const visible = new Set(moduleIds)
  return NAVIGATION_ITEMS.filter(item => visible.has(item.id))
}

export function navigationLabel(id) {
  return NAVIGATION_ITEMS.find(item => item.id === id)?.label
}
