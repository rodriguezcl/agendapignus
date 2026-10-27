// Results belong to the visit. Pending work remains explicit for administration;
// it must never become a completed category or a presumed debt.
const typesFor = record => record?.serviceTypes?.length ? record.serviceTypes : record?.serviceId != null ? [{ id: record.serviceId, name: record.service }] : []
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
const cents = value => Math.round(Number(value) * 100)
function validateCharges(record) {
  if (record.serviceCharges == null) return null // Existing records require review on a partial close.
  const types = typesFor(record), rows = record.serviceCharges
  if (!Array.isArray(rows) || rows.length !== types.length || new Set(rows.map(r => String(r?.id))).size !== types.length || rows.some(r => !r || !types.some(t => String(t.id) === String(r.id)) || !/^\d+(\.\d{1,2})?$/.test(String(r.amount)) || !Number.isSafeInteger(cents(r.amount)) || Number(r.amount) < 0)) fail('Revisá el importe de cada tipo de trabajo. Usá cero para los trabajos sin cargo.')
  if (rows.reduce((sum, row) => sum + cents(row.amount), 0) !== cents(record.amount || 0)) fail('La suma de los importes por trabajo debe coincidir con el monto del servicio.')
  return rows
}
function results(record, input, user, now) {
  const types = typesFor(record)
  if (record.vehicleControl || types.length < 2) {
    if (input != null) fail('El detalle por trabajo corresponde a servicios con varias categorías.')
    return null
  }
  if (!Array.isArray(input) || input.length !== types.length || new Set(input.map(r => String(r?.id))).size !== types.length || input.some(r => !r || !types.some(t => String(t.id) === String(r.id)) || !['completed','pending'].includes(r.status))) fail('Indicá si cada tipo de trabajo se realizó o quedó pendiente.')
  const items = types.map(t => ({ ...t, status: input.find(r => String(r.id) === String(t.id)).status }))
  return { items, at: now, byId: user.id, byName: user.name || 'Técnico', originalAmount: String(record.amount || ''), originalPaymentMethod: record.paymentMethod || '', originalCharges: record.serviceCharges || null }
}
function applyResults(record, next, input, user, now) {
  const report = results(record, input, user, now)
  if (!report) return next
  next.workCompletion = report
  const done = report.items.filter(t => t.status === 'completed'), pending = report.items.filter(t => t.status === 'pending')
  if (!pending.length) return next
  if (record.serviceJourney) {
    Object.assign(next, { status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada', technicianRequest: 'Reprogramación solicitada', completedAt: '' })
    if (Number(record.amount) > 0) next.collectionReview = { at: now, reason: 'Quedaron trabajos pendientes en un servicio de varias jornadas. Revisá la planificación y la cobranza.' }
    return next
  }
  // Completed categories are retained individually; nothing done means the visit needs review.
  if (done.length) Object.assign(next, { serviceTypes: done.map(({ id, name }) => ({ id, name })), serviceId: done[0].id, service: done[0].name })
  else Object.assign(next, { status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada', technicianRequest: 'Reprogramación solicitada', completedAt: '' })
  if (Number(record.amount) > 0 && record.paymentMethod && record.paymentMethod !== 'No aplica') {
    const allocation = validateCharges(record)
    // Preserve received money; administration must reconcile it explicitly.
    if (!allocation || record.collection) {
      next.collectionReview = { at: now, reason: 'Quedaron trabajos pendientes. Revisá qué importe corresponde a lo realizado.', pending: pending.map(t => t.name), originalAmount: record.amount }
      delete next.serviceCharges
    } else {
      const completedCharges = allocation.filter(r => done.some(t => String(t.id) === String(r.id)))
      const amount = completedCharges.reduce((sum, r) => sum + cents(r.amount), 0) / 100
      next.amount = String(amount)
      if (done.length) next.serviceCharges = completedCharges
      else delete next.serviceCharges
      if (!amount) {
        next.paymentMethod = 'No aplica'
        next.collectionCancellation = { at: now, actor: { id: user.id, name: user.name || 'Técnico' }, reason: 'El importe corresponde a trabajos que quedaron pendientes; no se genera deuda por lo realizado.', original: { amount: record.amount, paymentMethod: record.paymentMethod }, automatic: true }
      }
    }
  }
  return next
}
const pendingWork = record => record?.workCompletion?.items?.filter(t => t.status === 'pending') || []
function applyToHistory(history, record, next) {
  return history.map(item => String(item.id) === String(record.id) ? next : next.collectionReview && record.serviceJourney && (String(item.id) === String(record.serviceJourney.id) || item.serviceJourney?.id === record.serviceJourney.id) ? { ...item, collectionReview: next.collectionReview } : item)
}
module.exports = { typesFor, validateCharges, results, applyResults, pendingWork, applyToHistory }
