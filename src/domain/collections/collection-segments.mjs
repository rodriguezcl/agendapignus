import { collectionConfirmed, collectionVoided, collectionNeedsReview } from './collections.mjs'

const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const segment = id => ({ id, records: [], total: 0, pending: { count: 0, total: 0 }, confirmed: { count: 0, total: 0 } })
const amountCents = value => {
  const cents = Math.round(Number(value) * 100)
  return Number.isSafeInteger(cents) && cents > 0 ? cents : 0
}

// The caller supplies the authorized, filtered owner list from collectionRecords
// and one resolver indexed over the complete history. Payment status never
// changes the temporal segment: prepaid future services remain future.
export function collectionSegments(records = [], { today, resolveService = record => record } = {}) {
  const current = segment('current'), future = segment('future')
  const knownToday = validDate(today)
  for (const record of records) {
    const effective = resolveService(record) || record
    const target = knownToday && validDate(effective.date) && effective.date > today ? future : current
    const state = collectionConfirmed(record) ? 'confirmed' : 'pending'
    const cents = amountCents(record.amount)
    target.records.push(record)
    if (collectionVoided(record) || collectionNeedsReview(record) && !collectionConfirmed(record)) continue
    target.total += cents
    target[state].count++
    target[state].total += cents
  }
  for (const target of [current, future]) {
    target.total /= 100
    target.pending.total /= 100
    target.confirmed.total /= 100
  }
  return [current, future]
}
