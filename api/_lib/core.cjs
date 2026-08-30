const crypto = require('node:crypto')

const normalizedText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const normalizedRoleName = normalizedText
const normalizedServiceName = normalizedText

function legacyRoleCode(role = {}) {
  const name = normalizedRoleName(role.name)
  if (name === 'administrador') return 'administrator'
  if (name === 'tecnico') return 'technician'
  if (name === 'coordinador') return 'coordinator'
  if (name === 'usuario') return 'user'
  return `role-${role.id}`
}

function legacyServiceCode(service = {}) {
  return normalizedServiceName(service.name) === 'instalacion de alarma' ? 'alarm-installation' : `service-${service.id}`
}

const normalizeServiceEstimatedMinutes = value => {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 720 ? minutes : 60
}

function userCan(user, permission) {
  return user?.roleCode === 'administrator' || Boolean(user?.permissions?.[permission])
}

function publicEmployee(employee = {}) {
  const { password, passwordHash, ...safe } = employee
  return safe
}

function auditSafe(record) {
  if (!record) return null
  const { password, passwordHash, ...safe } = record
  return safe
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`
}

function verifyPassword(password, storedHash) {
  if (!storedHash?.includes(':')) return false
  const [salt, hash] = storedHash.split(':')
  const calculated = crypto.scryptSync(String(password), salt, 64)
  const stored = Buffer.from(hash, 'hex')
  return stored.length === calculated.length && crypto.timingSafeEqual(stored, calculated)
}

function userForEmployee(employee, roles) {
  const validRoles = Array.isArray(roles) ? roles.filter(item => item && typeof item === 'object') : []
  const role = validRoles.find(item => String(item.id) === String(employee?.roleId)) || validRoles.find(item => normalizedRoleName(item.name) === normalizedRoleName(employee?.role))
  if (!employee || !role) return null
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    roleId: role.id,
    roleCode: role.code || legacyRoleCode(role),
    role: role.name,
    permissions: role.permissions || {}
  }
}

function visibleStateForUser(state, user) {
  if (user.roleCode === 'technician') {
    const technicianId = String(user.id)
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
    const assignedHistory = state.history.filter(record => record.technicianIds?.some(id => String(id) === technicianId))
    const activeAssigned = assignedHistory.filter(record => String(record.date || '') >= today && !record.technicalStatus && !['Completado', 'Cancelado', 'Reprogramado'].includes(record.status))
    const activeCustomerIds = new Set(activeAssigned
      .map(record => String(record.customerId || ''))
      .filter(Boolean))
    const activeCustomerAccounts = new Set(activeAssigned
      .map(record => String(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0] || '').trim().toUpperCase())
      .filter(Boolean))
    const visibleHistory = state.history.filter(record => {
      if (record.technicianIds?.some(id => String(id) === technicianId)) return true
      const customerId = String(record.customerId || '')
      const account = String(record.clientAccount || String(record.client || '').trim().split(/\s+/)[0] || '').trim().toUpperCase()
      return (customerId && activeCustomerIds.has(customerId)) || (account && activeCustomerAccounts.has(account))
    })
    return {
      revision: state.revision,
      roles: [], employees: [], services: [], vehicles: [], customers: [], agenda: null, preferences: {},
      history: visibleHistory
    }
  }
  const canPlan = userCan(user, 'agenda') || userCan(user, 'weekly')
  return {
    revision: state.revision,
    roles: state.roles,
    employees: userCan(user, 'employees') ? state.employees.map(publicEmployee) : state.employees.map(({ id, firstName, lastName, name, roleId, role, status }) => ({ id, firstName, lastName, name, roleId, role, status })),
    services: userCan(user, 'services') || canPlan || userCan(user, 'history') ? state.services : [],
    vehicles: userCan(user, 'vehicles') ? state.vehicles || [] : [],
    customers: userCan(user, 'accounts') || canPlan || userCan(user, 'history') ? state.customers : [],
    history: userCan(user, 'history') || userCan(user, 'accounts') ? state.history : [],
    agenda: canPlan ? state.agenda : null,
    preferences: state.preferences
  }
}

function authorizeIncomingState(incoming, current, user) {
  const administrator = user.roleCode === 'administrator'
  let employees = current.employees
  if (administrator) employees = incoming.employees
  else if (userCan(user, 'employees')) {
    const previousById = new Map(current.employees.map(employee => [String(employee.id), employee]))
    const administratorRoleIds = new Set(current.roles.filter(role => (role.code || legacyRoleCode(role)) === 'administrator').map(role => String(role.id)))
    employees = (incoming.employees || []).map(employee => {
      const previous = previousById.get(String(employee.id))
      if (previous && administratorRoleIds.has(String(previous.roleId))) return previous
      if (!previous && administratorRoleIds.has(String(employee.roleId))) {
        const error = new Error('Solamente un administrador puede crear o asignar cuentas administrativas.')
        error.statusCode = 403
        throw error
      }
      return previous ? { ...employee, roleId: previous.roleId, role: previous.role } : employee
    })
    current.employees.filter(employee => administratorRoleIds.has(String(employee.roleId)) && !employees.some(item => String(item.id) === String(employee.id))).forEach(employee => employees.push(employee))
  }
  const currentAgenda = current.agenda || {}
  const incomingAgenda = incoming.agenda || {}
  const { _holidayOverrides: ignoredHolidayOverrides, _annualGuards: ignoredAnnualGuards, _monthlyTeams: ignoredMonthlyTeams, ...incomingWeeklyWithoutProtectedConfiguration } = incomingAgenda.weekly || {}
  const protectedWeekly = administrator
    ? incomingAgenda.weekly
    : {
        ...incomingWeeklyWithoutProtectedConfiguration,
        ...(currentAgenda.weekly?._holidayOverrides ? { _holidayOverrides: currentAgenda.weekly._holidayOverrides } : {}),
        ...(currentAgenda.weekly?._annualGuards ? { _annualGuards: currentAgenda.weekly._annualGuards } : {}),
        ...(currentAgenda.weekly?._monthlyTeams ? { _monthlyTeams: currentAgenda.weekly._monthlyTeams } : {})
      }
  return {
    ...incoming,
    roles: administrator ? incoming.roles : current.roles,
    employees,
    services: userCan(user, 'services') ? incoming.services : current.services,
    vehicles: userCan(user, 'vehicles') && Array.isArray(incoming.vehicles) ? incoming.vehicles : current.vehicles || [],
    history: userCan(user, 'history') ? incoming.history : current.history,
    customers: userCan(user, 'accounts') ? incoming.customers : current.customers,
    reviews: current.reviews,
    agenda: {
      ...currentAgenda,
      ...(userCan(user, 'agenda') ? { date: incomingAgenda.date, teams: incomingAgenda.teams } : {}),
      ...(userCan(user, 'weekly') ? { weekly: protectedWeekly } : {})
    }
  }
}

function customerKind(customer) {
  if (customer.kind === 'subscriber' || customer.kind === 'client') return customer.kind
  return String(customer.account || '').toUpperCase().startsWith('PIG-') ? 'subscriber' : 'client'
}

function normalizeStateForSave(state, current) {
  const roles = (state.roles || []).map(role => ({ ...role, code: role.code || legacyRoleCode(role) }))
  const roleById = new Map(roles.map(role => [String(role.id), role]))
  const employees = (state.employees || []).map(employee => {
    const role = roleById.get(String(employee.roleId))
    return { ...employee, name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(), ...(role ? { roleId: role.id, role: role.name } : {}) }
  })
  const services = (state.services || []).map(service => ({ ...service, code: service.code || legacyServiceCode(service), category: service.category || (normalizedServiceName(service.name).startsWith('instalacion') ? 'installation' : 'service'), estimatedMinutes: normalizeServiceEstimatedMinutes(service.estimatedMinutes) }))
  const serviceById = new Map(services.map(service => [String(service.id), service]))
  const serviceByName = new Map(services.map(service => [normalizedServiceName(service.name), service]))
  const normalizeScheduledService = item => {
    const service = serviceById.get(String(item?.serviceId ?? '')) || serviceByName.get(normalizedServiceName(item?.service))
    if (!service) return item
    return { ...item, serviceId: service.id, service: service.name, estimatedMinutes: item.estimatedMinutes == null ? service.estimatedMinutes : item.estimatedMinutes }
  }
  const normalizeTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(normalizeScheduledService) }))
  const vehicles = (state.vehicles || []).map(vehicle => ({ ...vehicle, brand: String(vehicle.brand || '').trim(), model: String(vehicle.model || '').trim(), year: Number(vehicle.year), mileage: vehicle.mileage == null || vehicle.mileage === '' ? null : Number(vehicle.mileage), plate: String(vehicle.plate || '').trim().toLocaleUpperCase('es-AR') }))
  const customers = (state.customers || []).map(customer => ({ ...customer, kind: customerKind(customer), name: String(customer.name || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-AR') }))
  const history = (state.history || []).map(record => ({ ...normalizeScheduledService(record), status: record.status || 'Pendiente' }))
  const incomingAgenda = state.agenda || {}
  const weekly = Object.fromEntries(Object.entries(incomingAgenda.weekly || {}).map(([key, value]) => key === '_monthlyTeams'
    ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: normalizeTeams(config?.teams) }]))]
    : [key, key.startsWith('_') ? value : { ...value, teams: normalizeTeams(value?.teams) }]))
  const agenda = { ...incomingAgenda, teams: normalizeTeams(incomingAgenda.teams), weekly }
  return normalizeRetirementCustomers({ ...state, roles, employees, services, vehicles, customers, history, agenda, reviews: state.reviews || current.reviews || [] }).state
}

function statePersistenceChanged(current, next) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    return value
  }
  const persistent = state => ({
    roles: state.roles || [], employees: state.employees || [], services: state.services || [], vehicles: state.vehicles || [],
    customers: state.customers || [], history: state.history || [], reviews: state.reviews || [],
    agenda: state.agenda || {}, preferences: { theme: state.preferences?.theme || 'light' }
  })
  return JSON.stringify(canonical(persistent(current))) !== JSON.stringify(canonical(persistent(next)))
}

function normalizeRetirementCustomers(state) {
  const retiringCustomerIds = new Set((state.history || []).filter(record => record.status === 'Completado' && normalizedServiceName(record.service).includes('retiro de equipo')).map(record => String(record.customerId || '')).filter(Boolean))
  let nextNumber = Math.max(0, ...(state.customers || []).map(customer => Number(String(customer.account || '').match(/^CLI-(\d+)$/i)?.[1]) || 0)) + 1
  const conversions = new Map()
  const customers = (state.customers || []).map(customer => {
    if (!retiringCustomerIds.has(String(customer.customerId)) || customerKind(customer) !== 'subscriber') return customer
    const converted = { ...customer, kind: 'client', account: `CLI-${String(nextNumber++).padStart(4, '0')}`, type: 'Cliente de servicio', convertedFromAccount: customer.account, subscriptionEndedAt: new Date().toISOString() }
    conversions.set(String(customer.customerId), { before: customer, after: converted })
    return converted
  })
  if (!conversions.size) return { state: { ...state, customers }, conversions: [] }
  const redirect = item => {
    const conversion = conversions.get(String(item?.customerId || ''))
    if (!conversion) return item
    const customer = conversion.after
    return { ...item, customerId: customer.customerId, clientAccount: customer.account, clientNameAtService: customer.name, client: `${customer.account} ${customer.name}` }
  }
  const redirectTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(redirect) }))
  const agenda = state.agenda || {}
  const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).map(([key, value]) => key === '_monthlyTeams'
    ? [key, Object.fromEntries(Object.entries(value || {}).map(([month, config]) => [month, { ...config, teams: redirectTeams(config?.teams) }]))]
    : [key, key.startsWith('_') ? value : { ...value, teams: redirectTeams(value?.teams) }]))
  return {
    state: { ...state, customers, history: (state.history || []).map(redirect), reviews: (state.reviews || []).map(redirect), agenda: { ...agenda, teams: redirectTeams(agenda.teams), weekly } },
    conversions: [...conversions.values()]
  }
}

function secureEmployees(employees, previousEmployees) {
  const previousById = new Map(previousEmployees.map(employee => [String(employee.id), employee]))
  return employees.map(employee => {
    const previous = previousById.get(String(employee.id))
    const next = { ...employee }
    if (next.password?.trim() && (next.password.trim().length < 8 || !/[a-z]/.test(next.password) || !/[A-Z]/.test(next.password) || !/\d/.test(next.password))) throw new Error('Las contraseñas deben tener al menos 8 caracteres, una mayúscula, una minúscula y un número.')
    if (!previous && !next.password?.trim()) throw new Error('Todo empleado nuevo requiere una contraseña.')
    if (next.password?.trim()) next.passwordHash = hashPassword(next.password)
    else if (previous?.passwordHash) next.passwordHash = previous.passwordHash
    else if (previous?.password) next.passwordHash = hashPassword(previous.password)
    delete next.password
    return next
  })
}

function validateState(state) {
  if (!state || typeof state !== 'object') throw new Error('El estado recibido no es válido.')
  for (const name of ['roles', 'employees', 'services', 'vehicles', 'customers', 'history']) if (!Array.isArray(state[name])) throw new Error(`La colección ${name} no es válida.`)
  const unique = (items, key, label) => {
    const found = new Set()
    items.forEach((item, index) => {
      const value = String(item?.[key] ?? '').trim().toLowerCase()
      if (!value) throw new Error(`${label} ${index + 1}: falta ${key}.`)
      if (found.has(value)) throw new Error(`No puede haber ${label.toLowerCase()}s duplicados.`)
      found.add(value)
    })
  }
  unique(state.roles, 'id', 'Rol'); unique(state.roles, 'code', 'Código de rol')
  unique(state.employees, 'id', 'Empleado'); unique(state.employees, 'email', 'Correo electrónico')
  unique(state.services, 'id', 'Tipo de servicio'); unique(state.services, 'code', 'Código de servicio')
  unique(state.vehicles, 'id', 'Vehículo'); unique(state.vehicles, 'plate', 'Matrícula')
  unique(state.customers, 'account', 'Cliente'); unique(state.customers, 'customerId', 'Cliente')
  unique(state.history, 'id', 'Registro de historial')
  const roleIds = new Set(state.roles.map(item => String(item.id)))
  const serviceIds = new Set(state.services.map(item => String(item.id)))
  const customerIds = new Set(state.customers.map(item => String(item.customerId)))
  const employeeIds = new Set(state.employees.map(item => String(item.id)))
  state.employees.forEach((employee, index) => {
    if (!employee.firstName || !employee.lastName || !/^\S+@\S+\.\S+$/.test(String(employee.email || '')) || !roleIds.has(String(employee.roleId))) throw new Error(`Empleado ${index + 1}: datos incompletos.`)
  })
  state.services.forEach((service, index) => {
    if (!String(service.name || '').trim() || String(service.name).trim().length > 120) throw new Error(`Tipo de servicio ${index + 1}: el nombre es obligatorio o demasiado extenso.`)
    if (String(service.description || '').length > 500) throw new Error(`Tipo de servicio ${index + 1}: la descripción es demasiado extensa.`)
    if (!Number.isInteger(Number(service.estimatedMinutes)) || Number(service.estimatedMinutes) < 15 || Number(service.estimatedMinutes) > 720) throw new Error(`Tipo de servicio ${index + 1}: el tiempo estimado debe estar entre 15 minutos y 12 horas.`)
    if (!['Activo', 'Inactivo'].includes(service.status)) throw new Error(`Tipo de servicio ${index + 1}: el estado no es válido.`)
  })
  const maximumVehicleYear = new Date().getFullYear() + 1
  state.vehicles.forEach((vehicle, index) => {
    if (!String(vehicle.brand || '').trim() || String(vehicle.brand).trim().length > 80) throw new Error(`Vehículo ${index + 1}: la marca es obligatoria o demasiado extensa.`)
    if (!String(vehicle.model || '').trim() || String(vehicle.model).trim().length > 120) throw new Error(`Vehículo ${index + 1}: el modelo es obligatorio o demasiado extenso.`)
    if (!Number.isInteger(Number(vehicle.year)) || Number(vehicle.year) < 1886 || Number(vehicle.year) > maximumVehicleYear) throw new Error(`Vehículo ${index + 1}: el año no es válido.`)
    if (vehicle.mileage != null && (!Number.isInteger(Number(vehicle.mileage)) || Number(vehicle.mileage) < 0 || Number(vehicle.mileage) > 99999999)) throw new Error(`Vehículo ${index + 1}: el kilometraje no es válido.`)
    if (!String(vehicle.plate || '').trim() || String(vehicle.plate).trim().length > 20) throw new Error(`Vehículo ${index + 1}: la matrícula es obligatoria o demasiado extensa.`)
  })
  state.history.forEach((record, index) => {
    if (record.date && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) throw new Error(`Historial ${index + 1}: fecha inválida.`)
    if (record.serviceId != null && !serviceIds.has(String(record.serviceId))) throw new Error(`Historial ${index + 1}: el tipo de servicio no existe.`)
    if (record.customerId != null && !customerIds.has(String(record.customerId))) throw new Error(`Historial ${index + 1}: el cliente no existe.`)
    if ((record.technicianIds || []).some(id => !employeeIds.has(String(id)))) throw new Error(`Historial ${index + 1}: contiene un técnico inexistente.`)
    if (record.serviceId != null && (!Number.isInteger(Number(record.estimatedMinutes)) || Number(record.estimatedMinutes) < 15 || Number(record.estimatedMinutes) > 720)) throw new Error(`Historial ${index + 1}: el tiempo estimado debe estar entre 15 minutos y 12 horas.`)
  })
  const agendaTeams = [...(state.agenda?.teams || [])]
  Object.entries(state.agenda?.weekly || {}).forEach(([key, value]) => {
    if (key === '_monthlyTeams') Object.values(value || {}).forEach(config => agendaTeams.push(...(config?.teams || [])))
    else if (!key.startsWith('_')) agendaTeams.push(...(value?.teams || []))
  })
  agendaTeams.forEach((team, teamIndex) => {
    ;(team.tasks || []).forEach((task, taskIndex) => {
      if (task.serviceId != null && (!Number.isInteger(Number(task.estimatedMinutes)) || Number(task.estimatedMinutes) < 15 || Number(task.estimatedMinutes) > 720)) throw new Error(`Agenda: servicio ${taskIndex + 1} del equipo ${teamIndex + 1} debe tener un tiempo estimado de entre 15 minutos y 12 horas.`)
    })
    const scheduled = (team.tasks || []).filter(task => task.serviceId && /^\d{1,2}:\d{2}$/.test(String(task.time || ''))).map(task => {
      const [hours, minutes] = task.time.split(':').map(Number)
      const start = hours * 60 + minutes
      return { task, start, end: start + Math.max(60, Number(task.estimatedMinutes)) }
    }).sort((first, second) => first.start - second.start)
    scheduled.forEach((current, index) => {
      const conflict = scheduled.slice(0, index).find(previous => current.start < previous.end)
      if (conflict) throw new Error(`Agenda: las franjas de ${conflict.task.time} y ${current.task.time} se superponen en el equipo ${teamIndex + 1}.`)
    })
  })
}

function auditChanges(previousRecords, nextRecords, key, entity, user) {
  const previous = new Map(previousRecords.map(record => [String(record[key]), record]))
  const incoming = new Map(nextRecords.map(record => [String(record[key]), record]))
  const entries = []
  const create = (action, entityId, before, after) => ({ id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role }, action, entity, entityId, before: auditSafe(before), after: auditSafe(after) })
  for (const [id, record] of incoming) {
    const old = previous.get(id)
    if (!old) entries.push(create('Creó', id, null, record))
    else if (JSON.stringify(auditSafe(old)) !== JSON.stringify(auditSafe(record))) entries.push(create('Modificó', id, old, record))
  }
  for (const [id, record] of previous) if (!incoming.has(id)) entries.push(create('Eliminó', id, record, null))
  return entries
}

function reportDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '')
}

function compareReportRecords(left, right) {
  return String(left.date || '').localeCompare(String(right.date || '')) || String(left.time || left.scheduledTime || '').localeCompare(String(right.time || right.scheduledTime || '')) || String(left.client || '').localeCompare(String(right.client || ''), 'es', { sensitivity: 'base' })
}

const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))

function professionalExcelHtml({ title, description, month, headers, rows, widths }) {
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const generatedAt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const body = rows.map((row, rowIndex) => `<tr class="${rowIndex % 2 ? 'alternate' : ''}">${row.map((value, columnIndex) => { const header = headers[columnIndex]; const rendered = header === 'Fecha' ? reportDate(value) : value; return `<td class="${header === 'Contacto' ? 'text-value contact' : header === 'Fecha' ? 'date-value' : 'text-value'}">${escapeHtml(rendered) || '&nbsp;'}</td>` }).join('')}</tr>`).join('')
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>@page{size:landscape;margin:.45in}body{font-family:Aptos,Calibri,Arial,sans-serif;color:#173626;background:#fff;margin:0}.report{border-collapse:collapse;width:100%;table-layout:fixed}.brand td{height:26px;padding:8px 12px;background:#123122;color:#d8a016;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase}.title td{padding:16px 12px 4px;background:#123122;color:#fff;font-size:24px;font-weight:700}.description td{padding:2px 12px 16px;background:#123122;color:#d5e2d9;font-size:11px}.meta td{padding:11px 12px;background:#f4ecd3;color:#405748;font-size:11px;border-bottom:2px solid #c99311}.meta b{color:#173626}.spacer td{height:10px}.headers th{padding:10px 9px;background:#c99311;color:#fff;font-size:11px;font-weight:700;text-align:left;border-bottom:2px solid #8d6505}.report tbody td{padding:9px;border-bottom:1px solid #d9e4da;vertical-align:top;font-size:10px;white-space:normal}.report tbody tr.alternate td{background:#f5f8f5}.date-value{white-space:nowrap!important;text-align:center;mso-number-format:"dd/mm/yyyy"}.contact{white-space:nowrap!important;mso-number-format:"\\@"}.footer td{padding:13px 12px;color:#6b7d70;font-size:9px;border-top:2px solid #c99311}.count{font-size:15px;font-weight:700;color:#173626}.confidential{float:right;font-weight:700;color:#6b5220}</style></head><body><table class="report"><colgroup>${widths.map(width => `<col style="width:${width}">`).join('')}</colgroup><thead><tr class="brand"><td colspan="${headers.length}">PIGNUS · Gestión operativa</td></tr><tr class="title"><td colspan="${headers.length}">${escapeHtml(title)}</td></tr><tr class="description"><td colspan="${headers.length}">${escapeHtml(description)}</td></tr><tr class="meta"><td colspan="${headers.length}"><b>Período:</b> ${escapeHtml(monthLabel)} &nbsp;·&nbsp; <b>Total:</b> <span class="count">${rows.length}</span> &nbsp;·&nbsp; <b>Generado:</b> ${escapeHtml(generatedAt)}</td></tr><tr class="spacer"><td colspan="${headers.length}"></td></tr><tr class="headers">${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">No existen registros para el período seleccionado.</td></tr>`}</tbody><tfoot><tr class="footer"><td colspan="${headers.length}">Agenda técnica PIGNUS <span class="confidential">Documento de uso interno</span></td></tr></tfoot></table></body></html>`
}

module.exports = { auditChanges, auditSafe, authorizeIncomingState, compareReportRecords, hashPassword, legacyRoleCode, normalizedServiceName, normalizeRetirementCustomers, normalizeStateForSave, professionalExcelHtml, publicEmployee, reportDate, secureEmployees, statePersistenceChanged, userCan, userForEmployee, validateState, verifyPassword, visibleStateForUser }
