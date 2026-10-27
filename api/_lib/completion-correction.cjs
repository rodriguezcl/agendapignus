const permissions = require('./permission-catalog.cjs')
const policy = require('./endpoint-policy.cjs')
const zones = require('./alarm-zones.cjs')
const work = require('./work-completion.cjs')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
const displayBase = ({ clientAccount, clientNameAtService, estimatedMinutesCustomized, ...record }) => record

function prepareCompletionCorrection(current, input, user, now = new Date().toISOString()) {
  if (permissions.roleCode(user) !== 'administrator') fail('Sólo Administración puede corregir el resultado técnico.', 403)
  const before = (current.history || []).find(record => String(record.id) === String(input.recordId))
  if (!before) fail('El servicio ya no existe.', 404)
  policy.assertServiceAccess(user, before, current, { write: true, permission: 'history.complete' })
  if (!input.base || !policy.recordBaseMatches(displayBase(before), displayBase(input.base), user)) fail('El servicio cambió desde otra sesión. Cerrá y volvé a abrir el detalle.', 409)
  if (before.vehicleControl || before.serviceJourney || before.awaitingConfirmation || !['Pendiente', 'Requiere revisión', 'En proceso'].includes(before.status) || before.technicalStatus === 'Completado') fail('Esta corrección corresponde a servicios individuales pendientes o con reprogramación solicitada.', 409)
  if (!permissions.can(user, 'history.completeEarly')) require('./service-completion.cjs').assertServiceCanBeCompleted(before, new Date(now))
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason || reason.length > 1000) fail('Indicá el motivo de la corrección (hasta 1000 caracteres).')
  const types = work.typesFor(before)
  const ids = Array.isArray(input.completedIds) ? input.completedIds.map(String) : []
  if (!types.length || ids.length !== types.length || new Set(ids).size !== ids.length || types.some(type => !ids.includes(String(type.id)))) fail('Confirmá que todos los trabajos del servicio fueron realizados.')
  const correction = {
    at: now, actor: { id: user.id, name: user.name || user.email }, reason,
    previous: Object.fromEntries(['status', 'technicalStatus', 'technicalObservation', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'technicianRequest', 'completedAt'].filter(key => before[key] !== undefined).map(key => [key, before[key]])),
    previousResult: before.workCompletion ? { items: before.workCompletion.items, at: before.workCompletion.at, byId: before.workCompletion.byId, byName: before.workCompletion.byName, management: before.workCompletion.management } : null
  }
  const after = { ...before, status: 'Completado', technicalStatus: 'Completado', technicianRequest: '', completedAt: now,
    technicalReportedAt: now, technicalReportedById: user.id, technicalReportedByName: user.name || user.email, technicalObservation: `Corrección administrativa: ${reason}`,
    workCompletion: { ...before.workCompletion, items: types.map(type => ({ ...type, status: 'completed' })), at: now, byId: user.id, byName: user.name || user.email,
      corrections: [...(before.workCompletion?.corrections || []), correction] }
  }
  delete after.workCompletion.management
  if (zones.installation(before)) {
    const validated = zones.validateZones(input.alarmZones ?? before.alarmZones?.zones, true)
    if (!before.alarmZones?.complete || JSON.stringify(validated) !== JSON.stringify(before.alarmZones.zones)) Object.assign(after, zones.reportZones(before, 'Completado', validated, user, now))
  } else if (input.alarmZones != null) fail('Este servicio no requiere zonas de alarma.')
  // A prior automatic cancellation is not a payment. Restore its terms for
  // explicit financial review; never undo a manual cancellation or receipt.
  if (before.collectionCancellation?.automatic && !before.collection) {
    after.amount = before.collectionCancellation.original.amount
    after.paymentMethod = before.collectionCancellation.original.paymentMethod
    correction.previousCancellation = before.collectionCancellation
    delete after.collectionCancellation
    if (before.workCompletion?.originalCharges) after.serviceCharges = before.workCompletion.originalCharges
    after.collectionReview = { at: now, reason: 'Revisar el importe tras la corrección administrativa del resultado.', originalAmount: after.amount, pending: [] }
  }
  let state = { ...current, history: current.history.map(record => record === before ? after : record) }
  state.agenda = require('./history-record-operation.cjs').synchronizeAgendaHistoryRecord(current.agenda || {}, before, after)
  const normalized = require('./core.cjs').normalizeRetirementCustomers(state, current)
  state = normalized.state
  const policyOptions = { workCompletionWriteId: before.id, alarmZonesWriteId: before.id, ticketActor: user, ticketReportRecordId: before.id }
  require('./completed-service-policy.cjs').assertCompletedServices(state, current, policyOptions)
  return { before, after: state.history.find(record => String(record.id) === String(before.id)), state, conversions: normalized.conversions, policyOptions }
}
module.exports = { prepareCompletionCorrection }
