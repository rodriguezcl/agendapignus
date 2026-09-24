const customerFields = ['customerId', 'client', 'clientAccount', 'clientNameAtService', 'address', 'phone', 'newCustomer', 'subscriberReservation', 'reservationOriginal', 'reservationLinkedAt', 'reservationLinkedBy']
const serviceFields = ['serviceId', 'service']
const changed = (a, b, key) => JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])
const hasWork = record => Boolean(record.startedAt || record.technicalStatus || record.technicalReportedAt || record.journeyClosedAt || ['Avance registrado', 'Completado'].includes(record.status))

function restoredRetirementReference(before, next, state, previous) {
  const source = previous.customers?.find(customer => String(customer.customerId) === String(before.customerId))
  const target = state.customers?.find(customer => String(customer.customerId) === String(next.customerId))
  if (!source?.convertedFromAccount || !target || target.kind !== 'subscriber' || target.account !== source.convertedFromAccount || next.clientAccount !== target.account || next.client !== `${target.account} ${target.name}` || next.clientNameAtService !== target.name) return false
  const referenceKeys = ['customerId', 'client', 'clientAccount', 'clientNameAtService']
  if ([...customerFields, ...serviceFields].some(key => !referenceKeys.includes(key) && changed(before, next, key))) return false
  if (String(source.customerId) !== String(target.customerId)) {
    const originalTarget = previous.customers?.find(customer => String(customer.customerId) === String(target.customerId))
    if (!originalTarget || originalTarget.account !== source.convertedFromAccount || !require('./retirement-customer-match.cjs').matchesRetiredSubscriber(source, originalTarget)) return false
  }
  const retirement = record => String(record.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('retiro de equipo')
  if (state.history.some(record => [String(source.customerId), String(target.customerId)].includes(String(record.customerId)) && record.status === 'Completado' && retirement(record))) return false
  return previous.history.some(record => String(record.customerId) === String(source.customerId) && record.status === 'Completado' && retirement(record) && state.history.some(updated => String(updated.id) === String(record.id) && updated.status !== 'Completado' && String(updated.customerId) === String(target.customerId)))
}

function identityPatch(previous, next) {
  const customerChanged = ['customerId', 'clientAccount', 'subscriberReservation'].some(key => changed(previous, next, key))
  const serviceChanged = serviceFields.some(key => changed(previous, next, key))
  const fields = [...(customerChanged ? customerFields : []), ...(serviceChanged ? serviceFields : [])]
  return Object.fromEntries(fields.map(key => [key, next[key]]))
}

// Applies shared identity only. Dates, crews, duration, reports and notes remain per visit.
function synchronizeJourneyIdentity(state, previous) {
  if (!previous || !state?.history) return state
  const old = new Map((previous.history || []).map(record => [String(record.id), record]))
  const edits = new Map()
  for (const next of state.history) {
    const before = old.get(String(next.id))
    if (!before?.serviceJourney) continue
    const patch = identityPatch(before, next)
    if (!Object.keys(patch).length) continue
    // This is a reference repair after correcting a retirement, not a change
    // to the customer who received the work. Keep each visit's own details.
    if (restoredRetirementReference(before, next, state, previous)) continue
    const id = before.serviceJourney.id
    const group = (previous.history || []).filter(record => record.serviceJourney?.id === id)
    const linking = before.subscriberReservation === true && next.subscriberReservation === false && next.customerId && /^PIG-/i.test(next.clientAccount || '') && next.reservationLinkedAt && next.reservationOriginal && !changed(before, next, 'serviceId') && !changed(before, next, 'service')
    if (group.some(hasWork) && !linking) throw new Error('El cliente y tipo de servicio quedan protegidos cuando comienza una jornada. Solo se permite vincular una reserva PIG con su cuenta definitiva.')
    if (edits.has(id) && JSON.stringify(edits.get(id)) !== JSON.stringify(patch)) throw new Error('Hay cambios contradictorios de cliente o tipo de servicio entre jornadas.')
    edits.set(id, patch)
  }
  state.history = state.history.map(record => edits.has(record.serviceJourney?.id) ? { ...record, ...edits.get(record.serviceJourney.id) } : record)
  const sync = value => {
    if (Array.isArray(value)) return value.map(sync)
    if (!value || typeof value !== 'object') return value
    const patch = edits.get(value.serviceJourney?.id)
    const next = patch ? { ...value, ...patch } : value
    return Object.fromEntries(Object.entries(next).map(([key, item]) => [key, sync(item)]))
  }
  if (edits.size && state.agenda) state.agenda = sync(state.agenda)
  return state
}

module.exports = { identityPatch, synchronizeJourneyIdentity, hasWork }
