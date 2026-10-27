import { serviceRecordFingerprint } from '../history/service-concurrency.mjs'

// Fixed rollout date agreed with administration. Never use a moving "today"
// cutoff: an unpaid service must remain visible on subsequent days.
export const COLLECTIONS_START_DATE = '2026-10-14'
export const COLLECTION_PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito']
export const collectionMoney = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value) || 0)
export const collectionConfirmed = record => record?.collection?.status === 'confirmed'
export const collectionVoided = record => Boolean(record?.collectionCancellation)
export const collectionNeedsReview = record => Boolean(record?.collectionReview)
export const collectionPending = record => !collectionConfirmed(record) && !collectionVoided(record) && !collectionNeedsReview(record)
const cancelled = record => record?.status === 'Cancelado' || record?.technicalStatus === 'Cancelado'
const compareVisits = (a, b) => String(a.date).localeCompare(String(b.date)) || a.serviceJourney.index - b.serviceJourney.index

// Keep the original payment owner, even when the first planned visit is cancelled.
// The first remaining visit determines when the single shared receivable is due.
export function collectionService(record, history = [record]) {
  if (!record?.serviceJourney) return cancelled(record) ? null : record
  return history.filter(item => item.serviceJourney?.id === record.serviceJourney.id && !cancelled(item))
    .sort(compareVisits)[0] || null
}

// Share this snapshot resolver across filtering, sorting and rendering. Each
// active journey is ordered once, preserving the original stable date/index
// ordering. Rebuild it when history changes, including cancellations or dates.
export function collectionServiceResolver(history = []) {
  const journeys = new Map()
  for (const record of history) {
    if (!record?.serviceJourney || cancelled(record)) continue
    const id = record.serviceJourney.id
    if (!journeys.has(id)) journeys.set(id, [])
    journeys.get(id).push(record)
  }
  const firstVisits = new Map()
  for (const [id, visits] of journeys) firstVisits.set(id, visits.sort(compareVisits)[0])
  return record => {
    if (!record?.serviceJourney) return cancelled(record) ? null : record
    return firstVisits.get(record.serviceJourney.id) || null
  }
}

export function hasCollection(record, history = [record], resolveService = item => collectionService(item, history)) {
  // A multi-day job carries copied commercial fields on each visit. Its first
  // record owns the receivable; visits must not multiply the amount to collect.
  if (record?.serviceJourney && String(record.id) !== String(record.serviceJourney.id)) return false
  if (!collectionConfirmed(record) && !resolveService(record)) return false
  if (collectionVoided(record)) return true
  if (record?.collection) return true // Confirmed payments retain their audit after cancellation.
  if (!record?.id || record.vehicleControl || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) return false
  const originalDates = [record.date, record.rescheduledFrom, ...(record.reschedulingHistory || []).map(visit => visit.date)].filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
  if (originalDates.some(date => date < COLLECTIONS_START_DATE)) return false
  return Number(record.amount) > 0 && Number.isFinite(Number(record.amount)) && Boolean(String(record.paymentMethod || '').trim()) && record.paymentMethod !== 'No aplica'
}

export function collectionRecords(history = [], resolveService = collectionServiceResolver(history)) {
  const schedule = record => resolveService(record) || record
  return history.filter(record => hasCollection(record, history, resolveService)).sort((a, b) => String(schedule(a).date).localeCompare(String(schedule(b).date)) || String(schedule(a).time || '').localeCompare(String(schedule(b).time || '')) || String(a.id).localeCompare(String(b.id)))
}

export function collectionBase(record) {
  return Object.fromEntries(['id', 'customerId', 'client', 'date', 'status', 'serviceJourney', 'amount', 'paymentMethod', 'collection', 'collectionCancellation', 'collectionReview', 'serviceCharges'].map(key => [key, record[key] ?? null]))
}

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }

// Receipt evidence is supplied separately by the server after validating the
// upload or reading the stored file. Client-provided metadata is never evidence.
export function manageCollection(state, input, user, now = new Date().toISOString(), { receipt = null, receiptUploaded = false } = {}) {
  const before = state.history?.find(record => String(record.id) === String(input?.recordId))
  if (!before || !hasCollection(before, state.history)) fail('La cobranza ya no está disponible. Actualizá el listado.', 404)
  if (serviceRecordFingerprint(collectionBase(before)) !== serviceRecordFingerprint(input.base)) fail('La cobranza cambió en otra sesión. Cerrá la ficha, actualizá y revisá los datos antes de guardar.', 409)
  if (collectionVoided(before)) fail('La cobranza fue anulada y se conserva únicamente como antecedente.', 409)
  if (input.action === 'void') {
    if (collectionConfirmed(before)) fail('Un pago confirmado no puede anularse como deuda pendiente.', 409)
    const reason = String(input.note || '').trim()
    if (!reason || reason.length > 1000) fail('Indicá el motivo de la anulación (hasta 1000 caracteres).')
    const actor = { id: String(user.id), name: user.name }
    const cancellation = { at: now, actor, reason, original: { amount: before.amount, paymentMethod: before.paymentMethod } }
    const recordIds = state.history.filter(r => r === before || before.serviceJourney && r.serviceJourney?.id === before.serviceJourney.id).map(r => String(r.id))
    const patch = { amount: '0', paymentMethod: 'No aplica', serviceCharges: undefined, collectionReview: undefined, collectionCancellation: cancellation }
    const after = { ...before, ...patch }
    const taskIds = new Set(state.history.filter(r => recordIds.includes(String(r.id))).map(r => String(r.sourceTaskId || '')).filter(Boolean))
    const sync = value => Array.isArray(value) ? value.map(sync) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value.historyId && recordIds.includes(String(value.historyId)) || value.taskId && taskIds.has(String(value.taskId)) ? { ...value, ...patch } : value).map(([key, item]) => [key, sync(item)])) : value
    return { before, after, recordIds, state: { ...state, history: state.history.map(r => recordIds.includes(String(r.id)) ? { ...r, ...patch } : r), agenda: sync(state.agenda) } }
  }
  if (collectionNeedsReview(before) && input.action !== 'correct') fail('Rectificá el monto correspondiente a lo realizado o anulá la cobranza antes de confirmar un pago.', 409)
  if (collectionNeedsReview(before) && !String(input.note || '').trim()) fail('Indicá el motivo y qué trabajos estás cobrando.')
  if (!['correct', 'confirm', 'receipt'].includes(input.action)) fail('La acción de cobranza no es válida.')
  if (input.action === 'confirm' && collectionConfirmed(before)) fail('Este pago ya fue confirmado.', 409)
  if (input.action === 'receipt' && !collectionConfirmed(before)) fail('El respaldo histórico corresponde a una cobranza confirmada.')
  const raw = String(input.amount ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > 999999999.99) fail('Ingresá un monto mayor a cero, sin separadores de miles y con hasta dos decimales.')
  if (!COLLECTION_PAYMENT_METHODS.includes(input.paymentMethod)) fail('Seleccioná la forma de pago efectiva.')
  const note = String(input.note || '').trim()
  if (note.length > 1000) fail('La observación no puede superar los 1000 caracteres.')
  const amount = String(Number(raw))
  const previous = { amount: String(before.amount), paymentMethod: before.paymentMethod, status: collectionConfirmed(before) ? 'confirmed' : 'pending' }
  const next = { amount, paymentMethod: input.paymentMethod, status: input.action === 'confirm' ? 'confirmed' : previous.status }
  if (input.action === 'confirm' && next.paymentMethod !== 'Efectivo' && !receipt) fail('Adjuntá el comprobante del pago para confirmar esta cobranza.')
  if (input.action === 'correct' && collectionConfirmed(before) && next.paymentMethod !== previous.paymentMethod && next.paymentMethod !== 'Efectivo' && !receiptUploaded) fail('Adjuntá un nuevo comprobante que respalde el cambio de medio de pago.')
  if (input.action === 'receipt') {
    if (!receiptUploaded || !receipt) fail('Seleccioná el comprobante que querés adjuntar.')
    if (Number(previous.amount) !== Number(amount) || previous.paymentMethod !== next.paymentMethod) fail('Para cambiar el importe o el medio de pago, usá la rectificación de cobranza.')
  }
  if (receiptUploaded && !receipt) fail('El comprobante no pudo verificarse.')
  if (input.action === 'correct' && !collectionNeedsReview(before) && Number(previous.amount) === Number(amount) && previous.paymentMethod === next.paymentMethod) fail('No hay cambios en el monto ni en la forma de pago.')
  const actor = { id: String(user.id), name: user.name }
  const receiptChange = receiptUploaded ? { receiptBefore: before.collection?.receipt?.id || null, receiptAfter: receipt.id } : {}
  const receipts = receiptUploaded ? [...new Map([...(before.collection?.receipts || []), before.collection?.receipt, receipt].filter(Boolean).map(file => [file.id, file])).values()] : undefined
  const collection = {
    ...before.collection,
    status: next.status,
    original: before.collection?.original || { ...previous, date: before.date, client: before.client },
    events: [...(before.collection?.events || []), { action: input.action, at: now, actor, before: previous, after: next, note, ...receiptChange }],
    ...(receiptUploaded ? { receipt, receipts } : {}),
    ...(input.action === 'confirm' ? { confirmedAt: now, confirmedBy: actor } : {})
  }
  const patch = input.action === 'receipt' ? {} : { amount, paymentMethod: next.paymentMethod, serviceCharges: undefined, collectionReview: undefined }
  const after = { ...before, ...patch, collection }
  const related = state.history.filter(record => record === before || (input.action !== 'receipt' && before.serviceJourney && record.serviceJourney?.id === before.serviceJourney.id))
  const recordIds = new Set(related.map(record => String(record.id)))
  const taskIds = new Set(related.map(record => String(record.sourceTaskId || '')).filter(Boolean))
  const sync = value => {
    if (Array.isArray(value)) return value.map(sync)
    if (!value || typeof value !== 'object') return value
    const matched = (value.historyId && recordIds.has(String(value.historyId))) || (value.taskId && taskIds.has(String(value.taskId)))
    return Object.fromEntries(Object.entries(matched ? { ...value, ...patch } : value).map(([key, item]) => [key, sync(item)]))
  }
  return { before, after, recordIds: [...recordIds], state: { ...state, history: state.history.map(record => record === before ? after : recordIds.has(String(record.id)) ? { ...record, ...patch } : record), agenda: sync(state.agenda) } }
}
