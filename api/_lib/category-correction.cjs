function prepareCategoryCorrection(current, input, user, correctServiceCategory, now) {
  if (require('./permission-catalog.cjs').isGranular(user)) {
    const policy = require('./endpoint-policy.cjs')
    const before = (current.history || []).find(record => String(record.id) === String(input.recordId))
    policy.assertServiceAccess(user, before, current, { write: true, permission: 'history.category' })
    const stripDisplayDefaults = ({ clientAccount, clientNameAtService, estimatedMinutesCustomized, ...value }) => value
    if (!input.base || !policy.recordBaseMatches(stripDisplayDefaults(before), stripDisplayDefaults(input.base), user)) throw Object.assign(new Error('El servicio cambió desde otra sesión. Volvé a abrir el detalle.'), { statusCode: 409 })
    input = { ...input, base: before }
  }
  const correction = correctServiceCategory(current, input, user, now)
  correction.state.agenda = require('./history-record-operation.cjs').synchronizeAgendaHistoryRecord(current.agenda || {}, correction.before, correction.after)
  const normalized = require('./core.cjs').normalizeRetirementCustomers(correction.state, current)
  correction.state = normalized.state
  correction.conversions = normalized.conversions
  correction.after = correction.state.history.find(record => String(record.id) === String(correction.before.id))
  correction.policyOptions = { categoryCorrectionId: correction.before.id }
  require('./completed-service-policy.cjs').assertCompletedServices(correction.state, current, correction.policyOptions)
  return correction
}
module.exports = { prepareCategoryCorrection }
