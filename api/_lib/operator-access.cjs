const normalized = value => String(value || '').trim().toLowerCase()
const isOperator = user => user?.roleCode === 'operator' || normalized(user?.role || user?.name) === 'operador'

// Deny by default: new endpoints must not grant the read-only role new powers.
function operatorRouteAllowed(method, route) {
  if (method === 'POST') return ['/auth/activity', '/auth/logout'].includes(route)
  return method === 'GET' && (
    ['/auth/session', '/auth/session-status', '/state', '/state/revision', '/holidays'].includes(route) ||
    route.startsWith('/service-photo/') || route.startsWith('/vehicle-control/photo/')
  )
}

function operatorState(state) {
  return {
    revision: state.revision,
    roles: (state.roles || []).map(({ id, code, name }) => ({ id, code, name })),
    employees: (state.employees || []).map(({ id, firstName, lastName, name, roleId, role, status }) => ({ id, firstName, lastName, name, roleId, role, status })),
    services: state.services || [],
    customers: state.customers || [],
    history: state.history || [],
    vehicles: [], preferences: {},
    agenda: { date: state.agenda?.date, teams: [], weekly: state.agenda?.weekly || {} }
  }
}
module.exports = { isOperator, operatorRouteAllowed, operatorState }
