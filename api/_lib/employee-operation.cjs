const { applyStateOperations } = require('./state-operations.cjs')
const { publicEmployee, userCan, authorizeIncomingState, secureEmployees, legacyRoleCode } = require('./core.cjs')

const employeeOnly = operations => Array.isArray(operations) && operations.length === 1 && operations.every(op => op?.path?.length === 2 && op.path[0] === 'employees' && op.path[1]?.key === 'id' && op.exists === true && op.after && String(op.after.id) === op.path[1].id)

function applyEmployeeOperation(current, operations, user) {
  if (!userCan(user, 'employees')) throw Object.assign(new Error('No tenés permiso para administrar empleados.'), { statusCode: 403 })
  if (!employeeOnly(operations)) throw new Error('Operación de empleado inválida.')
  const proposed = applyStateOperations({ employees: current.employees.map(publicEmployee) }, operations)
  const authorized = authorizeIncomingState({ ...current, employees: proposed.employees }, current, user)
  const targetId = operations[0].path[1].id
  const employees = authorized.employees.map(employee => {
    if (String(employee.id) !== targetId) return employee
    const role = current.roles.find(item => String(item.id) === String(employee.roleId))
    if (!role) throw new Error('Seleccioná un rol válido.')
    const firstName = String(employee.firstName || '').trim(), lastName = String(employee.lastName || '').trim()
    if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(String(employee.email || ''))) throw new Error('Completá nombre, apellido y un correo válido.')
    if (!['Activo', 'Inactivo'].includes(employee.status)) throw new Error('Estado del empleado inválido.')
    if (current.employees.some(item => String(item.id) !== targetId && String(item.email).trim().toLowerCase() === String(employee.email).trim().toLowerCase())) throw new Error('Ya existe un empleado con ese correo electrónico.')
    return { ...employee, firstName, lastName, name: `${firstName} ${lastName}`, roleId: role.id, role: role.name, technicalEnabled: ['operator', 'supervisor'].includes(role.code || legacyRoleCode(role)) ? false : employee.technicalEnabled === true }
  })
  return { ...current, employees: secureEmployees(employees, current.employees) }
}
module.exports = { employeeOnly, applyEmployeeOperation }
