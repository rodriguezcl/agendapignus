import { serviceRecordFingerprint } from '../history/service-concurrency.mjs'

// Fixed rollout date agreed with administration. Never use a moving "today"
// cutoff: an unpaid service must remain visible on subsequent days.
export const COLLECTIONS_START_DATE = '2026-10-14'
export const COLLECTION_PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito']
export const collectionMoney = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value) || 0)
export const collectionConfirmed = record => record?.collection?.status === 'confirmed'

export function hasCollection(record) {
  // A multi-day job carries copied commercial fields on each visit. Its first
  // record owns the receivable; visits must not multiply the amount to collect.
  if (record?.serviceJourney && String(record.id) !== String(record.serviceJourney.id)) return false
  if (record?.collection) return true // Keep the audit even after rescheduling/cancellation.
  if (!record?.id || record.vehicleControl || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) return false
  const originalDates = [record.date, record.rescheduledFrom, ...(record.reschedulingHistory || []).map(visit => visit.date)].filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
  if (originalDates.some(date => date < COLLECTIONS_START_DATE)) return false
  return Number(record.amount) > 0 && Number.isFinite(Number(record.amount)) && Boolean(String(record.paymentMethod || '').trim()) && record.paymentMethod !== 'No aplica'
}

export function collectionRecords(history = []) {
  return history.filter(hasCollection).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.id).localeCompare(String(b.id)))
}

export function collectionBase(record) {
  return Object.fromEntries(['id', 'customerId', 'client', 'date', 'status', 'serviceJourney', 'amount', 'paymentMethod', 'collection'].map(key => [key, record[key] ?? null]))
}

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }

export function manageCollection(state, input, user, now = new Date().toISOString()) {
  const before = state.history?.find(record => String(record.id) === String(input?.recordId))
  if (!before || !hasCollection(before)) fail('La cobranza ya no está disponible. Actualizá el listado.', 404)
  if (serviceRecordFingerprint(collectionBase(before)) !== serviceRecordFingerprint(input.base)) fail('La cobranza cambió en otra sesión. Cerrá la ficha, actualizá y revisá los datos antes de guardar.', 409)
  if (!['correct', 'confirm'].includes(input.action)) fail('La acción de cobranza no es válida.')
  if (input.action === 'confirm' && collectionConfirmed(before)) fail('Este pago ya fue confirmado.', 409)
  const raw = String(input.amount ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > 999999999.99) fail('Ingresá un monto mayor a cero, sin separadores de miles y con hasta dos decimales.')
  if (!COLLECTION_PAYMENT_METHODS.includes(input.paymentMethod)) fail('Seleccioná la forma de pago efectiva.')
  const note = String(input.note || '').trim()
  if (note.length > 1000) fail('La observación no puede superar los 1000 caracteres.')
  const amount = String(Number(raw))
  const previous = { amount: String(before.amount), paymentMethod: before.paymentMethod, status: collectionConfirmed(before) ? 'confirmed' : 'pending' }
  const next = { amount, paymentMethod: input.paymentMethod, status: input.action === 'confirm' ? 'confirmed' : previous.status }
  if (input.action === 'correct' && Number(previous.amount) === Number(amount) && previous.paymentMethod === next.paymentMethod) fail('No hay cambios en el monto ni en la forma de pago.')
  const actor = { id: String(user.id), name: user.name }
  const collection = {
    ...before.collection,
    status: next.status,
    original: before.collection?.original || { ...previous, date: before.date, client: before.client },
    events: [...(before.collection?.events || []), { action: input.action, at: now, actor, before: previous, after: next, note }],
    ...(input.action === 'confirm' ? { confirmedAt: now, confirmedBy: actor } : {})
  }
  const patch = { amount, paymentMethod: next.paymentMethod }
  const after = { ...before, ...patch, collection }
  const related = state.history.filter(record => record === before || (before.serviceJourney && record.serviceJourney?.id === before.serviceJourney.id))
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
