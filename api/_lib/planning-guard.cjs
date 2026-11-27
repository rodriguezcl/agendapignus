const catalog = require('./permission-catalog.cjs')
const { guardForDateWithDefaults } = require('../../src/domain/agenda/annual-guards.mjs')

function guardForPlanningDate(state, day) {
  const technicians = (state.employees || []).filter(employee => employee.status === 'Activo').flatMap(employee => {
    const role = (state.roles || []).find(role => String(role.id) === String(employee.roleId)) || employee
    const roleCode = catalog.roleCode(role)
    if (roleCode !== 'technician' && !(employee.technicalEnabled === true && (catalog.isGranular(role) || roleCode !== 'supervisor'))) return []
    return [{ ...employee, name: employee.name || [employee.firstName, employee.lastName].filter(Boolean).join(' '), roleCode }]
  })
  const guard = guardForDateWithDefaults(day, state.agenda?.weekly || {}, technicians)
  const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const technician = guard && (technicians.find(item => String(item.id) === String(guard.technicianId)) ||
    technicians.find(item => normalizeName(item.name) === normalizeName(guard.name)))
  return technician && { technicianId: technician.id, name: technician.name }
}

module.exports = { guardForPlanningDate }
