const isCompleted = record => record?.status === 'Completado' || record?.technicalStatus === 'Completado'
const fields = ['customerId', 'client', 'clientAccount', 'clientNameAtService', 'address', 'phone', 'serviceTypes', 'serviceId', 'service', 'date', 'time', 'scheduledTime', 'teamId', 'technicianIds', 'detail', 'internalNote', 'internalChecklist', 'estimatedMinutes', 'installationZone', 'paymentMethod', 'amount', 'monthlyFee', 'freezeMonthlyFee', 'frozenMonths', 'form', 'formEmail']
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')
function assertCompletedServiceChange(before, after, { referenceRepair = false } = {}) {
  if (!isCompleted(before) || !after) return
  // A reservation may acquire its definitive identity without losing its report.
  const linking = before.subscriberReservation === true && after.subscriberReservation === false && after.customerId && /^PIG-/i.test(after.clientAccount || '') && after.reservationOriginal && after.reservationLinkedAt
  const referenceFields = ['customerId', 'client', 'clientAccount', 'clientNameAtService']
  const value = (record, key) => key === 'freezeMonthlyFee' ? Boolean(record[key]) : key === 'frozenMonths' ? Number(record[key] || 0) : record[key]
  if (fields.some(key => !((linking || referenceRepair) && referenceFields.includes(key)) && !same(value(before, key), value(after, key)))) {
    throw Object.assign(new Error('Este servicio ya fue completado. Los cambios no se guardaron. Actualizá la agenda para consultar su información.'), { statusCode: 409, code: 'COMPLETED_SERVICE_LOCKED' })
  }
}
function assertCompletedServices(state, previous) {
  const records = new Map((previous?.history || []).map(record => [String(record.id), record]))
  for (const record of state?.history || []) {
    const before = records.get(String(record.id))
    const customer = state.customers?.find(item => String(item.customerId) === String(record.customerId))
    const oldCustomer = previous?.customers?.find(item => String(item.customerId) === String(before?.customerId))
    const sameCustomerConversion = before && String(before.customerId) === String(record.customerId) && customer && oldCustomer && customer.account !== oldCustomer.account && (customer.convertedFromAccount === oldCustomer.account || oldCustomer.convertedFromAccount === customer.account) && record.clientAccount === customer.account && record.client === `${customer.account} ${customer.name}`
    const referenceRepair = sameCustomerConversion || (before && require('./journey-identity.cjs').restoredRetirementReference(before, record, state, previous))
    assertCompletedServiceChange(before, record, { referenceRepair })
  }
}
module.exports = { isCompleted, assertCompletedServiceChange, assertCompletedServices }
