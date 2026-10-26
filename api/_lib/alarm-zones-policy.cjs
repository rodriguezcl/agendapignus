const { reportAvailable, pendingReport } = require('./alarm-zones.cjs')
const id = value => String(value ?? '')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
function assertRead(state, record, user) {
  const policy = require('./permission-catalog.cjs'), read = require('./granular-read-policy.cjs')
  const accountAccess = policy.can(user, 'accounts.view') && read.customerReadable(read.customerForRecord(record, state), user, state) && read.serviceInReadScope(record, user, state)
  if (!policy.can(user, 'service.documents.read') || !(accountAccess || read.serviceReadable(record, user, state))) fail('No tenés acceso a las zonas de este servicio.', 403)
}
function reportsFor(state, input, user) {
  const read = require('./granular-read-policy.cjs'), policy = require('./permission-catalog.cjs')
  if (input.recordId) {
    const record = (state.history || []).find(item => id(item.id) === id(input.recordId))
    if (!record) fail('No se encontró el servicio.', 404)
    assertRead(state, record, user)
    return reportAvailable(record) ? [record] : []
  }
  const customer = (state.customers || []).find(item => id(item.customerId) === id(input.customerId))
  if (!customer) fail('No se encontró la cuenta.', 404)
  if (!policy.can(user, 'accounts.view') || !policy.can(user, 'service.documents.read') || !read.customerReadable(customer, user, state)) fail('No tenés acceso a las zonas de esta cuenta.', 403)
  return (state.history || []).filter(record => reportAvailable(record) && read.customerForRecord(record, state) === customer && read.serviceInReadScope(record, user, state)).sort((a,b) => b.alarmZones.reportedAt.localeCompare(a.alarmZones.reportedAt))
}
const present = record => ({ recordId: id(record.id), customerId: id(record.customerId), client: record.client, date: record.date, report: record.alarmZones })
function confirmLoaded(state, input, user, now = new Date().toISOString()) {
  if (!require('./permission-catalog.cjs').can(user, 'customers.softguard.resolve')) fail('No tenés permiso para confirmar la carga en SoftGuard.', 403)
  const before = reportsFor(state, { recordId: input.recordId }, user)[0]
  if (!before) fail('Las zonas todavía no están disponibles para cargar en SoftGuard.', 409)
  if (input.reportedAt !== before.alarmZones.reportedAt) fail('El informe cambió. Actualizá las zonas antes de confirmar.', 409)
  if (!pendingReport(before)) return { state, before, after: before }
  const after = { ...before, alarmZones: { ...before.alarmZones, softguard: { completedAt: now, completedById: user.id, completedByName: user.name || user.email || 'Usuario' } } }
  return { before, after, state: { ...state, history: state.history.map(record => id(record.id) === id(before.id) ? after : record) } }
}
module.exports = { reportsFor, present, confirmLoaded }
