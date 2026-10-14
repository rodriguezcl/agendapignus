function prepareCategoryCorrection(current, input, user, correctServiceCategory, now) {
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
