import { canReadRecord } from '../access/record-scope.mjs'
import { COLLECTIONS_START_DATE, collectionConfirmed, collectionVoided, collectionNeedsReview, collectionRecords, collectionServiceResolver } from '../collections/collections.mjs'

const states = ['confirmed', 'pending', 'future']
const emptyTotals = () => Object.fromEntries(states.map(state => [state, { amount: 0, count: 0 }]))
const dateKey = date => date.toISOString().slice(0, 10)
const dateFor = value => new Date(`${value}T12:00:00Z`)
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const date = dateFor(value)
  return Number.isFinite(date.getTime()) && dateKey(date) === value
}

function calendarFor(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return null
  const first = dateFor(`${month}-01`)
  if (!Number.isFinite(first.getTime())) return null
  const last = new Date(first)
  last.setUTCMonth(last.getUTCMonth() + 1)
  last.setUTCDate(0)
  const from = dateKey(first)
  const through = dateKey(last)
  const monthLabel = first.toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' }).replace(/\.$/, '')
  const weeks = []
  const start = new Date(first)
  while (start <= last) {
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + (7 - end.getUTCDay()) % 7)
    if (end > last) end.setTime(last.getTime())
    const startDay = start.getUTCDate()
    const endDay = end.getUTCDate()
    weeks.push({
      key: dateKey(start),
      from: dateKey(start),
      through: dateKey(end),
      label: `${startDay === endDay ? startDay : `${startDay}–${endDay}`} ${monthLabel}`,
      ...emptyTotals()
    })
    start.setUTCDate(endDay + 1)
  }
  return { from, through, weeks }
}

// API amounts have at most two decimals. Decimal parsing also rounds any older
// finer-precision value without the floating-point 1.005 * 100 rounding error.
function amountInCents(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim())
  let cents
  if (match) {
    const fraction = (match[2] || '').padEnd(3, '0')
    cents = Number(match[1]) * 100 + Number(fraction.slice(0, 2)) + Number(fraction[2] >= '5')
  } else cents = Math.round(numeric * 100)
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/**
 * Current collection status grouped by effective service date, never cash flow
 * or the date an administrator recorded a confirmation. The caller gates
 * financial access; current record scopes are checked again here.
 */
export function buildCollectionOverview(history = [], { month, today, user, customers = [] } = {}) {
  const calendar = calendarFor(month)
  const overview = {
    month,
    from: calendar?.from || '',
    through: calendar?.through || '',
    coverageStart: calendar && calendar.from > COLLECTIONS_START_DATE ? calendar.from : COLLECTIONS_START_DATE,
    trackingAvailable: Boolean(calendar && calendar.through >= COLLECTIONS_START_DATE && validDate(today)),
    hasData: false,
    totals: emptyTotals(),
    weeks: calendar?.weeks || []
  }
  if (!calendar || !validDate(today)) return overview

  // Do not filter history by scope first: a hidden earlier journey must not
  // make a later, visible visit look like the first effective service.
  const records = (history || []).filter(record => record && typeof record === 'object')
  const resolveService = collectionServiceResolver(records)
  let hasEarlierExplicitRecords = false
  for (const owner of collectionRecords(records, resolveService)) {
    if (collectionVoided(owner) || collectionNeedsReview(owner) && !collectionConfirmed(owner)) continue
    const effective = resolveService(owner) || owner
    if (user && (!canReadRecord(owner, user, customers) || !canReadRecord(effective, user, customers))) continue
    const date = effective.date
    if (!validDate(date) || date < calendar.from || date > calendar.through) continue
    const cents = amountInCents(owner.amount)
    if (cents === null) continue
    const state = collectionConfirmed(owner) ? 'confirmed' : date <= today ? 'pending' : 'future'
    const week = overview.weeks.find(item => item.from <= date && date <= item.through)
    overview.totals[state].amount += cents
    overview.totals[state].count++
    week[state].amount += cents
    week[state].count++
    overview.hasData = true
    if (date < COLLECTIONS_START_DATE) hasEarlierExplicitRecords = true
  }
  for (const bucket of [overview.totals, ...overview.weeks]) {
    for (const state of states) bucket[state].amount /= 100
  }
  if (hasEarlierExplicitRecords) {
    overview.trackingAvailable = true
    overview.coverageNote = 'El seguimiento general comienza el 14/10/2026. Se conservan cobranzas registradas antes de esa fecha; no representan cobertura completa.'
  } else if (calendar.through < COLLECTIONS_START_DATE) {
    overview.coverageNote = 'Seguimiento disponible desde el 14/10/2026.'
  } else if (calendar.from < COLLECTIONS_START_DATE) {
    overview.coverageNote = 'Seguimiento desde el 14/10/2026; los días anteriores no tienen cobertura completa.'
  }
  return overview
}
