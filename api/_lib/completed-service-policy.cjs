const isCompleted = record => record?.status === 'Completado' || record?.technicalStatus === 'Completado'
const fields = ['customerId', 'client', 'clientAccount', 'clientNameAtService', 'address', 'phone', 'serviceTypes', 'serviceId', 'service', 'date', 'time', 'scheduledTime', 'teamId', 'technicianIds', 'detail', 'internalNote', 'internalChecklist', 'estimatedMinutes', 'installationZone', 'paymentMethod', 'amount', 'monthlyFee', 'freezeMonthlyFee', 'frozenMonths', 'form', 'formEmail']
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')
function assertCompletedServiceChange(before, after, { referenceRepair = false, subscriptionCorrection = false, collectionCorrection = false, categoryCorrection = false, followupChange = false } = {}) {
  require('./followups.cjs').assertFollowupChange(before, after, followupChange)
  require('./collection-policy.cjs').assertCollectionChange(before, after, collectionCorrection)
  if (before && !categoryCorrection && !require('node:util').isDeepStrictEqual(before.categoryCorrections, after?.categoryCorrections)) throw Object.assign(new Error('La trazabilidad de categorías sólo se modifica desde Corregir categoría.'), { statusCode: 409 })
  if (!isCompleted(before) || !after) return
  // A reservation may acquire its definitive identity without losing its report.
  const linking = before.subscriberReservation === true && after.subscriberReservation === false && after.customerId && /^PIG-/i.test(after.clientAccount || '') && after.reservationOriginal && after.reservationLinkedAt
  const referenceFields = ['customerId', 'client', 'clientAccount', 'clientNameAtService']
  const value = (record, key) => key === 'freezeMonthlyFee' ? Boolean(record[key]) : key === 'frozenMonths' ? Number(record[key] || 0) : record[key]
  const subscriptionFields = ['monthlyFee', 'monthlyFeeEffectiveFrom', 'freezeMonthlyFee', 'frozenMonths', 'subscriptionCorrectedAt', 'subscriptionCorrectedBy']
  if ([...fields, ...subscriptionFields].some(key => !(categoryCorrection && ['serviceId', 'service', 'serviceTypes'].includes(key)) && !(collectionCorrection && ['amount', 'paymentMethod'].includes(key)) && !(subscriptionCorrection && subscriptionFields.includes(key)) && !((linking || referenceRepair) && referenceFields.includes(key)) && !same(value(before, key), value(after, key)))) {
    throw Object.assign(new Error('Este servicio ya fue completado. Los cambios no se guardaron. Actualizá la agenda para consultar su información.'), { statusCode: 409, code: 'COMPLETED_SERVICE_LOCKED' })
  }
}
function assertCompletedServices(state, previous, { subscriptionCorrectionId = null, collectionCorrectionId = null, collectionCorrectionIds = [], categoryCorrectionId = null, followupRecordId = null } = {}) {
  const records = new Map((previous?.history || []).map(record => [String(record.id), record]))
  const collectionIds = new Set([...collectionCorrectionIds, collectionCorrectionId].filter(id => id != null).map(String))
  const nextRecords = new Map((state?.history || []).map(record => [String(record.id), record]))
  for (const before of records.values()) {
    if (before.followup && !nextRecords.has(String(before.id))) require('./followups.cjs').assertFollowupChange(before, null)
    if (before.collection && !nextRecords.has(String(before.id))) require('./collection-policy.cjs').assertCollectionChange(before, null)
  }
  for (const record of state?.history || []) {
    const before = records.get(String(record.id))
    const root = nextRecords.get(String(record.serviceJourney?.id))
    require('./collection-policy.cjs').assertSharedCollection(root, record)
    const customer = state.customers?.find(item => String(item.customerId) === String(record.customerId))
    const oldCustomer = previous?.customers?.find(item => String(item.customerId) === String(before?.customerId))
    const sameCustomerConversion = before && String(before.customerId) === String(record.customerId) && customer && oldCustomer && customer.account !== oldCustomer.account && (customer.convertedFromAccount === oldCustomer.account || oldCustomer.convertedFromAccount === customer.account) && record.clientAccount === customer.account && record.client === `${customer.account} ${customer.name}`
    const referenceRepair = sameCustomerConversion || (before && require('./journey-identity.cjs').restoredRetirementReference(before, record, state, previous, String(record.id) === String(categoryCorrectionId)))
    assertCompletedServiceChange(before, record, { referenceRepair, followupChange: followupRecordId != null && String(record.id) === String(followupRecordId), categoryCorrection: categoryCorrectionId != null && String(record.id) === String(categoryCorrectionId), collectionCorrection: collectionIds.has(String(record.id)), subscriptionCorrection: subscriptionCorrectionId != null && String(record.id) === String(subscriptionCorrectionId) })
  }
}
module.exports = { isCompleted, assertCompletedServiceChange, assertCompletedServices }
