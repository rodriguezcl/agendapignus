const { isDeepStrictEqual } = require('node:util')
const permissions = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')
const TYPES = ['Cotizar adicional', 'Coordinar visita', 'Gestionar problema', 'Otra acción']
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
const can = (user, key) => permissions.can(user, key)
const assigned = (record, user) => record.technicianIds?.some(id => String(id) === String(user.id))
function visible(record, user, state) {
  return can(user, 'followups.view') && read.serviceInReadScope(record, user, state)
}
function createFollowup(record, input, user, state, now) {
  if (input == null) return record.followup
  if (!(can(user, 'followups.create') || can(user, 'tickets.fromService')) || !assigned(record, user) || !read.serviceWritable(record, user, state)) fail('No tenés permiso para solicitar seguimiento de este servicio.', 403)
  if (record.vehicleControl) fail('El seguimiento corresponde a servicios de abonados o clientes.')
  if (record.followup) return record.followup
  const description = String(input.description || '').trim()
  if (!TYPES.includes(input.type) || !description || description.length > 2000) fail('Seleccioná el tipo e indicá la acción solicitada (hasta 2000 caracteres).')
  const relatedTicketId=String(input.relatedTicketId||'')
  if(relatedTicketId&&!/^[a-zA-Z0-9-]{1,100}$/.test(relatedTicketId))fail('La referencia del ticket no es válida.')
  if (input.relation && !['same', 'different'].includes(input.relation)) fail('La relación del seguimiento no es válida.')
  if (input.relation === 'different' && relatedTicketId === String(record.sourceTicketId || '') && relatedTicketId) fail('Un caso diferente no puede agregarse al reclamo original.')
  return { relatedTicketId, relation: input.relation === 'different' ? 'different' : 'same', id: `followup:${record.id}`, type: input.type, description, status: 'Pendiente', version: 1,
    createdAt: now, createdById: user.id, createdByName: user.name || 'Técnico',
    events: [{ action: 'Creó la solicitud', at: now, byId: user.id, byName: user.name || 'Técnico', note: description }] }
}
function assertFollowupChange(before, after, authorized = false) {
  if (!authorized && !isDeepStrictEqual(before?.followup, after?.followup)) fail('Gestioná el seguimiento desde Tickets para conservar su trazabilidad.', 409)
}
function assignees(state, record) {
  return (state.employees || []).filter(employee => {
    if (['inactivo', 'baja'].includes(String(employee.status || '').toLowerCase())) return false
    const role = state.roles?.find(role => String(role.id) === String(employee.roleId))
    if (!role) return false
    const subject = { ...employee, roleCode: role.code, role: role.name, permissions: role.permissions }
    return visible(record, subject, state) && read.serviceWritable(record, subject, state) && (can(subject, 'followups.assign') || can(subject, 'followups.resolve'))
  }).map(employee => ({ id: String(employee.id), name: employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() }))
}
function manageFollowup(state, input, user, now = new Date().toISOString()) {
  const before = state.history.find(record => String(record.id) === String(input.recordId))
  if (!before || !visible(before, user, state) || !read.serviceWritable(before, user, state)) fail('No tenés acceso a este seguimiento.', 403)
  const previous = before.followup
  if (!previous) fail('El seguimiento no existe.', 404)
  const action = input.action
  if (!['assign', 'note', 'resolve'].includes(action)) fail('Acción de seguimiento inválida.')
  if (!can(user, action === 'resolve' ? 'followups.resolve' : 'followups.assign')) fail('No tenés permiso para realizar esta gestión.', 403)
  const commandId = String(input.commandId || '')
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(commandId)) fail('Identificador de gestión inválido.')
  if (previous.events.some(event => event.commandId === commandId && String(event.byId) === String(user.id))) return { state, before, after: before, unchanged: true }
  if (input.version !== previous.version) fail('El caso cambió en otra sesión. Actualizá antes de gestionar.', 409)
  if (previous.status === 'Resuelto') fail('El seguimiento ya está resuelto.', 409)
  const note = String(input.note || '').trim()
  if (note.length > 2000 || (action !== 'assign' && !note)) fail('Registrá el avance o resultado (hasta 2000 caracteres).')
  const next = { ...previous, version: previous.version + 1 }
  let actionLabel
  if (action === 'assign') {
    const responsible = assignees(state, before).find(employee => employee.id === String(input.assigneeId || user.id))
    if (!responsible) fail('Seleccioná un responsable activo con acceso al caso.')
    next.assigneeId = responsible.id; next.assigneeName = responsible.name; next.status = 'En gestión'
    actionLabel = `Asignó a ${responsible.name}`
  } else if (action === 'resolve') {
    if (!previous.assigneeId) fail('Asigná un responsable antes de resolver el caso.')
    next.status = 'Resuelto'; next.resolvedAt = now; next.resolution = note
    actionLabel = 'Resolvió el caso'
  } else actionLabel = 'Registró un avance'
  next.events = [...previous.events, { commandId, action: actionLabel, at: now, byId: user.id, byName: user.name || 'Usuario', note }]
  const after = { ...before, followup: next }
  return { before, after, state: { ...state, history: state.history.map(record => record === before ? after : record) } }
}
function listFollowups(state, user) {
  if (!can(user, 'followups.view')) fail('No tenés permiso para consultar seguimientos.', 403)
  return state.history.filter(record => record.followup && visible(record, user, state)).map(record => ({
    recordId: record.id, customerId: record.customerId, clientAccount: record.clientAccount, client: record.client,
    date: record.date, service: record.service, technicalObservation: record.technicalObservation,
    followup: record.followup, assignees: can(user, 'followups.assign') && read.serviceWritable(record, user, state) ? assignees(state, record) : [],
    writable: read.serviceWritable(record, user, state)
  }))
}
module.exports = { TYPES, visible, createFollowup, assertFollowupChange, manageFollowup, listFollowups }
