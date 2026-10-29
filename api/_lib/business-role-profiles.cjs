const policy = require('./permission-catalog.cjs')
const { isDeepStrictEqual } = require('node:util')
const SYSTEM_ADMIN_NAME = 'Administrador del sistema'
const profiles = [
  {
    code: 'accounting', name: 'Administrativo contable',
    description: 'Gestiona cobranzas, abonos, datos de clientes y formularios para SoftGuard. Consulta servicios; no administra accesos ni planifica visitas.',
    grants: `history.view accounts.view collections.view records.read records.contact records.financial records.export customer.history
      collections.timeline collections.confirm collections.amount collections.method
      customers.create customers.edit customers.softguard.resolve subscriptions.read subscriptions.correct
      planning.reservation.link registration.read registration.manage registration.sensitive forms.view
      service.documents.read service.documents.upload service.documents.deleteOwn
      customers.experience.manage tickets.view tickets.create tickets.comment tickets.assign tickets.classify tickets.resolve tickets.reopen tickets.reply tickets.internal tickets.scope.assigned tickets.scope.area`,
    notifications: 'collections reservations softguard registration experience tickets'
  },
  {
    code: 'seller', name: 'Vendedor',
    description: 'Crea y consulta sus propias reservas a confirmar y comparte sus formularios. Crea tickets y consulta los propios o asignados; Coordinación confirma la visita.',
    grants: `sales.view sales.reserve tickets.view tickets.create tickets.customers.all tickets.comment tickets.scope.assigned`,
    notifications: 'tickets'
  },
  {
    code: 'coordinator', name: 'Coordinador',
    description: 'Coordina agenda, visitas, equipos, horarios, flota y guardias. Gestiona tickets operativos y formularios sin acceso a datos bancarios protegidos ni administración de usuarios.',
    grants: `dashboard.view dashboard.detail weekly.view agenda.view history.view accounts.view map.view vehicles.view
      records.read records.contact records.financial records.export customer.history
      planning.create planning.edit planning.remove planning.ready planning.teams.create planning.teams.delete planning.technicians
      planning.notes planning.checklist planning.linkAccount planning.commercial planning.confirm planning.reservation.create planning.reservation.link planning.journeys planning.reschedule planning.copy planning.freeze
      weekly.reorder weekly.advanceGuard weekly.daily weekly.monthlyTeams.read weekly.monthlyTeams.manage weekly.monthlyHours.read weekly.monthlyHours.manage
      weekly.monthlyVehicles.read weekly.monthlyVehicles.assign weekly.controls.schedule weekly.guards.read weekly.guards.manage weekly.holidays
      history.edit history.complete history.reopen history.cancel history.category
      customers.create customers.coordinates map.customer registration.read registration.manage forms.view
      vehicles.mileage.read vehicle.controls.read vehicle.insurance.read vehicle.documents.read
      service.documents.read service.documents.upload service.documents.deleteOwn
      tickets.view tickets.create tickets.comment tickets.assign tickets.classify tickets.resolve tickets.reopen tickets.reply tickets.internal tickets.linkService tickets.scope.all`,
    notifications: 'reservations pendingToday confirmation rescheduling overdue insurance registration tickets'
  }
]
function profileRole(profile) {
  const keys = [...profile.grants.split(/\s+/).filter(Boolean), ...profile.notifications.split(' ').map(key => `notifications.${key}`)]
  for (const key of keys) if (!policy.BY_ID[key]) throw new Error(`Permiso desconocido en ${profile.code}: ${key}`)
  const permissions = { __catalogV2: true, ...Object.fromEntries(policy.CATALOG.map(item => [item.id, keys.includes(item.id)])) }
  const effective = policy.resolvePermissions({ code: profile.code, permissions })
  for (const key of keys) if (!effective[key]) throw new Error(`Falta una dependencia en ${profile.code}: ${key}`)
  return { id: `role-${profile.code}`, code: profile.code, name: profile.name, description: profile.description, permissions }
}
function businessRolesPlan(state) {
  const roles = [...state.roles], employees = [...state.employees], changes = []
  const admins = roles.filter(role => policy.roleCode(role) === 'administrator')
  if (admins.length !== 1) throw new Error('Se esperaba un único rol Administrador del sistema. Revisá los roles antes de aplicar.')
  const before = admins[0], after = { ...before, name: SYSTEM_ADMIN_NAME }
  if (roles.some(role => role !== before && role.name.trim().toLowerCase() === SYSTEM_ADMIN_NAME.toLowerCase())) throw new Error('Ya existe otro rol con el nombre Administrador del sistema.')
  if (!isDeepStrictEqual(before, after)) {
    roles[roles.indexOf(before)] = after
    changes.push({ before, after })
  }
  // Keep role IDs and credentials intact. Only the current display label changes.
  for (let i = 0; i < employees.length; i++) {
    const employee = employees[i]
    if ((String(employee.roleId) === String(before.id) || (!employee.roleId && employee.role === before.name)) && employee.role !== SYSTEM_ADMIN_NAME) employees[i] = { ...employee, role: SYSTEM_ADMIN_NAME }
  }
  for (const profile of profiles) {
    const existing = roles.find(role => role.code === profile.code)
    if (existing) {
      if (existing.name !== profile.name) throw new Error(`El código ${profile.code} ya pertenece a otro rol.`)
      continue // Preserve any permissions customized after the initial creation.
    }
    const after = profileRole(profile)
    if (roles.some(role => String(role.id) === after.id || role.name.trim().toLowerCase() === after.name.toLowerCase())) throw new Error(`Ya existe un rol que coincide con ${profile.name}; revisalo antes de aplicar.`)
    roles.push(after); changes.push({ before: null, after })
  }
  const changed = changes.length > 0 || !isDeepStrictEqual(employees, state.employees)
  return { state: { ...state, roles, employees }, changes, changed }
}
module.exports = { SYSTEM_ADMIN_NAME, profiles, profileRole, businessRolesPlan }
