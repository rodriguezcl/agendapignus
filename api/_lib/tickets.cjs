const crypto = require('node:crypto')
const permissions = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')
const sla = require('./ticket-sla.cjs')

const STATUSES = ['Nuevo', 'En gestión', 'En espera', 'Resuelto', 'Fusionado']
const PRIORITIES = ['Crítica', 'Alta', 'Media', 'Baja']
const OPEN_STATUSES = STATUSES.slice(0, 3)
const ORIGINS = ['phone', 'internal', 'technical', 'email']
const ACTION_PERMISSIONS = { create: 'create', comment: 'comment', assign: 'assign', classify: 'classify', wait: 'assign', resume: 'assign', resolve: 'resolve', reopen: 'reopen', merge: 'merge', reply: 'reply', linkService: 'linkService', linkCustomer: 'classify' }
const fail = (message, statusCode = 400, extra = {}) => { throw Object.assign(new Error(message), { statusCode, ...extra }) }
const can = (user, name) => permissions.can(user, `tickets.${name}`)
const id = value => String(value ?? '')
const normalized = value => id(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const clone = value => JSON.parse(JSON.stringify(value))
function text(value, max, label, required = false) {
  if (value != null && typeof value !== 'string') fail(`${label}: formato inválido.`)
  const result = String(value || '').trim()
  if (result.length > max || (required && !result)) fail(`${label}${required ? ' es obligatorio y' : ''} admite hasta ${max} caracteres.`)
  return result
}
function email(value) {
  const result = text(value, 254, 'Correo').toLowerCase()
  if (result && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(result)) fail('El correo no es válido.')
  return result
}
function timestamp(value, fallback = '') {
  if (!value) return fallback
  const time = new Date(value)
  if (!Number.isFinite(time.getTime())) fail('La fecha indicada no es válida.')
  return time.toISOString()
}
function defaultConfig() {
  const category = (categoryId, name, priority, customerPolicy, subcategories, areaId = 'technical') => ({ id: categoryId, name, priority, customerPolicy, areaId, showEvent: categoryId === 'alarm', showZone: categoryId === 'alarm', active: true, subcategories: subcategories.map(([subId, subName, subPriority]) => ({ id: subId, name: subName, priority: subPriority, active: true })) })
  return {
    categories: [
      category('alarm', 'Alarmas', 'Media', 'required', [['not-working', 'Sistema sin funcionamiento', 'Alta'], ['repeated', 'Activaciones reiteradas', 'Media'], ['other', 'Otra incidencia', 'Media']]),
      category('work', 'Trabajos realizados', 'Media', 'required', [['incomplete', 'Trabajo incompleto', 'Media'], ['visit', 'Coordinar visita', 'Media'], ['issue', 'Gestionar problema', 'Media']]),
      category('commercial', 'Solicitudes comerciales', 'Baja', 'optional', [['quote', 'Cotizar adicional', 'Baja']], 'administration'),
      category('internal', 'Soporte interno', 'Media', 'optional', [['printing', 'Problema de impresión', 'Media'], ['other', 'Otra solicitud interna', 'Media']], 'administration'),
      category('general', 'Otras solicitudes', 'Media', 'optional', [['review', 'Revisar y clasificar', 'Media']])
    ],
    areas: [{ id: 'technical', name: 'Servicio técnico', memberIds: [], active: true }, { id: 'administration', name: 'Administración', memberIds: [], active: true }],
    events: ['Intrusión', 'Pánico', 'Sabotaje', 'Falla de comunicación', 'Falla de alimentación', 'Otro'].map((name, index) => ({ id: `event-${index + 1}`, name, active: true })),
    startingNumber: 1000001,
    sla: sla.defaultSlaConfig()
  }
}
function validateConfig(input, state, previous = defaultConfig()) {
  if (!input || !Array.isArray(input.categories) || !Array.isArray(input.areas) || !Array.isArray(input.events)) fail('La configuración de tickets está incompleta.')
  const ids = (values, label, maximum) => {
    if (values.length > maximum) fail(`Se permiten hasta ${maximum} ${label}.`)
    const seen = new Set()
    values.forEach(item => { if (!/^[\w-]{1,80}$/.test(item.id || '') || seen.has(item.id)) fail(`Identificador duplicado o inválido en ${label}.`); seen.add(item.id) })
  }
  ids(input.areas, 'áreas', 100); ids(input.categories, 'categorías', 100); ids(input.events, 'eventos', 100)
  const employees = new Set((state.employees || []).map(item => id(item.id)))
  const areas = input.areas.map(item => ({ id: item.id, name: text(item.name, 120, 'Nombre del área', true), active: item.active !== false, memberIds: [...new Set((item.memberIds || []).map(id))] }))
  for (const area of areas) if (area.memberIds.some(member => !employees.has(member))) fail('Un integrante del área ya no existe.')
  const areaIds = new Set(areas.map(item => item.id))
  const classification = (item, inherited) => {
    const result = { id: item.id, name: text(item.name, 120, 'Nombre', true), active: item.active !== false }
    const priority = item.priority || inherited?.priority || 'Media'
    if (!PRIORITIES.includes(priority)) fail('Seleccioná una prioridad válida.')
    result.priority = inherited && !item.priority ? undefined : priority
    const areaId = item.areaId ?? inherited?.areaId ?? ''
    if (areaId && !areaIds.has(areaId)) fail('La categoría referencia un área inexistente.')
    result.areaId = inherited && item.areaId == null ? undefined : areaId
    result.customerPolicy = inherited && !item.customerPolicy ? undefined : item.customerPolicy || 'optional'
    if (result.customerPolicy && !['required', 'optional', 'none'].includes(result.customerPolicy)) fail('La política de cuenta es inválida.')
    result.showEvent = item.showEvent ?? (inherited ? undefined : false)
    result.showZone = item.showZone ?? (inherited ? undefined : false)
    return result
  }
  const categories = input.categories.map(item => {
    const result = classification(item)
    const children = item.subcategories || []
    ids(children, 'subcategorías', 100)
    result.subcategories = children.map(child => classification(child, result))
    return result
  })
  if (!categories.some(item => item.active)) fail('Debe existir al menos una categoría activa.')
  const events = input.events.map(item => ({ id: item.id, name: text(item.name, 120, 'Evento', true), active: item.active !== false }))
  // Retired identifiers remain available to render historical tickets.
  for (const key of ['categories', 'areas', 'events']) {
    const next = { categories, areas, events }[key]
    for (const old of previous[key] || []) if (!next.some(item => item.id === old.id)) next.push({ ...old, active: false })
  }
  for (const old of previous.categories || []) {
    const next = categories.find(item => item.id === old.id)
    for (const child of old.subcategories || []) if (!next.subcategories.some(item => item.id === child.id)) next.subcategories.push({ ...child, active: false })
  }
  const startingNumber = Number(input.startingNumber ?? previous.startingNumber)
  if (!Number.isSafeInteger(startingNumber) || startingNumber < 1 || startingNumber > 999999999999) fail('El número inicial debe ser un entero positivo de hasta 12 dígitos.')
  return { categories, areas, events, startingNumber, sla: sla.validateSlaConfig(input.sla ?? previous.sla ?? sla.defaultSlaConfig()) }
}
function classification(config, categoryId, subcategoryId) {
  const category = config.categories.find(item => item.id === categoryId && item.active)
  if (!category) fail('Seleccioná una categoría activa.')
  const subcategory = subcategoryId ? category.subcategories.find(item => item.id === subcategoryId && item.active) : null
  if (subcategoryId && !subcategory) fail('La subcategoría no pertenece a la categoría seleccionada.')
  return { category, subcategory, effective: { ...category, ...Object.fromEntries(Object.entries(subcategory || {}).filter(([,v])=>v!==undefined&&v!==null)) } }
}
function subject(employee, state) {
  const role = (state.roles || []).find(item => id(item.id) === id(employee.roleId))
  return role ? { ...employee, roleCode: role.code, role: role.name, permissions: role.permissions } : employee
}
function isOwn(ticket, user) { return [ticket.createdById, ticket.requesterId, ...(ticket.participantIds || [])].some(value => value && id(value) === id(user.id)) }
function visible(ticket, user, state, config) {
  if (!can(user, 'view')) return false
  if (can(user, 'scope.all') || isOwn(ticket, user)) return true
  if (can(user,'scope.assigned') && ticket.assigneeId && id(ticket.assigneeId) === id(user.id)) return true
  if (can(user, 'scope.area') && config.areas.some(area => area.id === ticket.areaId && area.memberIds.some(member => id(member) === id(user.id)))) return true
  // A technician can inspect the complaint for their assigned visit without
  // receiving access to the customer's other tickets or visits.
  if (can(user, 'fromService') && (state.history || []).some(record => (ticket.serviceIds || []).map(id).includes(id(record.id)) && (record.technicianIds || []).some(technicianId => id(technicianId) === id(user.id)) && read.serviceReadable(record, user, state))) return true
  // Existing service-bound followups retain their established reading scope.
  return Boolean(ticket.legacyId && permissions.can(user, 'followups.view') && (state.history || []).some(record => ticket.serviceIds?.includes(id(record.id)) && read.serviceInReadScope(record, user, state)))
}
function assertVisible(ticket, user, state, config) { if (!ticket || !visible(ticket, user, state, config)) fail('El ticket no existe o no está incluido en tu alcance.', 404) }
function assignees(state, ticket, config) {
  return (state.employees || []).filter(employee => {
    if (['inactivo', 'baja'].includes(normalized(employee.status))) return false
    const user = subject(employee, state)
    return can(user, 'view') && ['comment', 'assign', 'resolve'].some(name => can(user, name)) && (!ticket || visible({ ...ticket, assigneeId: id(employee.id) }, user, state, config))
  }).map(employee => ({ id: id(employee.id), name: employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() }))
}
function snapshot(customer, user) {
  const result = { id: id(customer.customerId || customer.id), customerId: id(customer.customerId || customer.id), account: customer.account || '', name: customer.name || '' }
  if (!user || permissions.can(user, 'records.contact')) { result.address = customer.address || ''; result.phone = customer.phone || '' }
  return result
}
function customerFor(input, user, state) {
  if (!input.customerId) return null
  const customer = (state.customers || []).find(item => id(item.customerId || item.id) === id(input.customerId))
  if (!customer || !read.customerReadable(customer, user, state)) fail('La cuenta no está disponible dentro de tu alcance.', 403)
  return customer
}
function newTicket(input, user, state, config, number, now) {
  const serviceId = id(input.serviceId || input.recordId)
  let origin = input.origin === 'technician' ? 'technical' : input.origin || 'internal'
  if (!ORIGINS.includes(origin) || origin === 'email') fail('Origen de ticket inválido para esta operación.')
  const service = serviceId && (state.history || []).find(record => id(record.id) === serviceId)
  if (serviceId && (!service || !can(user, 'fromService') || !read.serviceReadable(service, user, state))) fail('No tenés acceso para crear solicitudes desde este servicio.', 403)
  if (!can(user, 'create') && !(service && can(user, 'fromService'))) fail('No tenés permiso para crear tickets.', 403)
  if (origin === 'technical' && !service) fail('Las solicitudes técnicas deben vincularse a un servicio.')
  if (service) origin = 'technical'
  const serviceCustomer = service && read.customerForRecord(service, state)
  if (serviceCustomer && input.customerId && id(input.customerId) !== id(serviceCustomer.customerId)) fail('La cuenta no coincide con el servicio.')
  const customer = customerFor({ customerId: serviceCustomer?.customerId || input.customerId }, user, state)
  const { category, subcategory, effective } = classification(config, input.categoryId, input.subcategoryId)
  if ((effective.customerPolicy === 'required' || input.scope === 'customer' || origin === 'phone') && !customer) fail('Esta categoría requiere seleccionar un abonado o cliente.')
  if (effective.customerPolicy === 'none' && customer) fail('Esta categoría corresponde a solicitudes sin cuenta.')
  const eventId = text(input.eventId ?? input.eventType, 120, 'Evento')
  const event = eventId && config.events.find(item => item.active && (item.id === eventId || item.name === eventId))
  if (eventId && !event) fail('Seleccioná un evento activo.')
  const title = text(input.title, 160, 'Asunto') || `${subcategory?.name || category.name}${customer ? ` · ${customer.account}` : ''}`
  const ticket = {
    id: crypto.randomUUID(), number: String(number), version: 1, title,
    description: text(input.description ?? input.body, 10000, 'Observación', true), scope: customer ? 'customer' : 'internal',
    customerId: customer ? id(customer.customerId || customer.id) : '', customerSnapshot: customer ? snapshot(customer) : null,
    origin, categoryId: category.id, subcategoryId: subcategory?.id || '', eventId: effective.showEvent ? event?.id || '' : '', eventType: effective.showEvent ? event?.name || '' : '',
    zone: effective.showZone ? text(input.zone, 200, 'Zona') : '', occurredAt: timestamp(input.eventAt || input.occurredAt, now),
    requesterId: id(user.id), requesterName: text(input.requesterName, 160, 'Solicitante') || user.name || 'Usuario', requesterEmail: email(input.requesterEmail),
    createdById: id(user.id), createdByName: user.name || 'Usuario', areaId: effective.areaId || '', assigneeId: '', assigneeName: '',
    status: 'Nuevo', priority: effective.priority || 'Media', createdAt: now, updatedAt: now, serviceIds: service ? [id(service.id)] : [], participantIds: [id(user.id)]
  }
  sla.initSla(ticket, config, now)
  return ticket
}
function entry(ticket, user, body, now, options = {}) {
  return { id: crypto.randomUUID(), sourceTicketId: ticket.id, sourceTicketNumber: ticket.number, kind: options.kind || 'message', body, note: body, byId: id(user.id), byName: user.name || 'Usuario', at: now, channel: options.channel || ticket.origin || 'internal', visibility: options.visibility || 'public', ...options }
}
function metadataAttachment(file) {
  const { data, content, ...rest } = file
  return { ...rest, name: file.fileName || file.name, mime: file.mimeType || file.mime, bytes: file.byteSize || file.bytes }
}
function present(ticket, user, entries = [], aliases = [], detailed = false) {
  const result = { ...ticket, displayNumber: `Ticket#${ticket.number}`, customerName: ticket.customerSnapshot?.name || '', eventAt: ticket.occurredAt, slaSummary: sla.slaView(ticket) }
  delete result.externalParticipants
  if (!permissions.can(user, 'records.contact')) {
    if (result.customerSnapshot) result.customerSnapshot = snapshot(result.customerSnapshot, user)
    delete result.requesterEmail
    // Los encabezados de correo contienen contactos aunque el cuerpo sea visible.
  }
  if (detailed) {
    const visibleEntries = entries.filter(item => item.visibility !== 'internal' || can(user, 'internal')).map(item => { const value={ ...item, attachments: (item.attachments || []).map(metadataAttachment) }; if (!permissions.can(user,'records.contact')) { delete value.from; delete value.to; delete value.cc; } return value })
    result.messages = visibleEntries.filter(item => item.kind !== 'event')
    result.events = visibleEntries.filter(item => item.kind === 'event')
    result.aliases = aliases
  }
  return result
}
function duplicatesToken(customerId, tickets) {
  return crypto.createHash('sha256').update(JSON.stringify([customerId, tickets.map(ticket => [ticket.id, ticket.version]).sort((a, b) => a[0].localeCompare(b[0]))])).digest('hex')
}
module.exports = { STATUSES, PRIORITIES, OPEN_STATUSES, ORIGINS, ACTION_PERMISSIONS, fail, can, id, normalized, clone, text, email, timestamp, defaultConfig, validateConfig, classification, visible, assertVisible, assignees, snapshot, customerFor, newTicket, entry, present, metadataAttachment, duplicatesToken, subject }
