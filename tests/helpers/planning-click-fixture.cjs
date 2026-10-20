const { normalizeStateForSave, validateState } = require('../../api/_lib/core.cjs')
const day = '2099-01-05'
const admin = { id: 'admin', name: 'QA', roleCode: 'administrator' }
function fixture() {
  const state = { revision: 1, roles: [{ id: 'tech', name: 'Técnico', code: 'technician', permissions: {} }],
    employees: ['one', 'two'].map(id => ({ id, firstName: id, lastName: 'Técnico', email: `${id}@example.test`, roleId: 'tech', status: 'Activo' })),
    services: [{ id: 's', code: 'service', name: 'Servicio', estimatedMinutes: 60, status: 'Activo' }],
    customers: [], vehicles: [], reviews: [], preferences: { theme: 'light' },
    history: [{ id: 'work', sourceTaskId: 'task', date: day, teamId: 'team', team: 'Equipo 1', time: '09:00', status: 'Pendiente', serviceId: 's', service: 'Servicio', estimatedMinutes: 60, technicianIds: ['one'], technicians: ['one Técnico'] }],
    agenda: { date: day, teams: [], weekly: {} } }
  const team = { teamId: 'team', label: 'Equipo 1', memberIds: ['one'], members: ['one Técnico'], tasks: [{ ...state.history[0], taskId: 'task', historyId: 'work' }] }
  state.agenda.teams = [structuredClone(team)]
  state.agenda.weekly[day] = { teams: [structuredClone(team)] }
  const normalized = normalizeStateForSave(state, state)
  validateState(normalized, normalized)
  return normalized
}
module.exports = { fixture, admin, day }
