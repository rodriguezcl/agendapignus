import { serviceTypesFor } from '../services/multi-service.mjs'

const rounded = value => Math.round(value) || 0

function monthDate(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return null
  const date = new Date(`${month}-01T12:00:00Z`)
  return Number.isFinite(date.getTime()) ? date : null
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function monthCalendar(month) {
  const first = monthDate(month)
  if (!first) return null
  const last = new Date(first)
  last.setUTCMonth(last.getUTCMonth() + 1)
  last.setUTCDate(0)
  const before = new Date(first)
  before.setUTCDate(0)
  let businessDays = 0
  const days = Array.from({ length: last.getUTCDate() }, (_, index) => {
    const day = index + 1
    const date = new Date(first)
    date.setUTCDate(day)
    const weekday = date.getUTCDay()
    if (weekday >= 1 && weekday <= 5) businessDays++
    return { day, date: `${month}-${String(day).padStart(2, '0')}`, businessDays }
  })
  return { days, businessDays, before: before.toISOString().slice(0, 10), previousMonth: before.toISOString().slice(0, 7) }
}

/** A shared zero baseline for signed counts; decreases never get clipped. */
export function netProjectionAxis(values = []) {
  const finite = values.filter(Number.isFinite)
  const lowest = Math.min(0, ...finite)
  const highest = Math.max(0, ...finite)
  if (lowest === highest) return { min: 0, max: 1, step: 1, ticks: [0, 1] }
  const roughStep = Math.max(1, (highest - lowest) / 4)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = [1, 2, 5, 10].find(candidate => candidate * magnitude >= roughStep) * magnitude
  const min = Math.floor(lowest / step) * step || 0
  const max = Math.ceil(highest / step) * step || 0
  return { min, max, step, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + index * step) }
}

/**
 * Net completed alarm installations less equipment retirements, not a census
 * of active subscribers. The extrapolation retains the existing Monday-Friday
 * calendar (no holiday adjustment) and rounds the estimated closing count.
 * Dates are explicit local calendar keys; UTC is only used for calendar math.
 */
export function dashboardNetProjection(records = [], {
  month,
  today,
  isAlarmRecord = () => false,
  zoneOf = () => 'residencial',
  isRetirementRecord = () => false
} = {}) {
  const calendar = monthCalendar(month)
  const valid = Boolean(calendar && validDateKey(today))
  const currentMonth = valid ? today.slice(0, 7) : ''
  const period = !valid ? 'invalid' : month < currentMonth ? 'past' : month > currentMonth ? 'future' : 'current'
  const elapsedDays = period === 'past' ? calendar.days.length : period === 'current' ? Number(today.slice(8, 10)) : 0
  const elapsedBusinessDays = elapsedDays ? calendar.days[elapsedDays - 1].businessDays : 0
  const daily = new Map()
  let installations = 0
  let retirements = 0
  let previousNetGrowth = 0
  for (const record of records || []) {
    if (!valid || record?.status !== 'Completado' || !validDateKey(record.date)) continue
    const recordMonth = record.date.slice(0, 7)
    const previous = recordMonth === calendar.previousMonth
    const observed = elapsedDays > 0 && recordMonth === month && (period === 'past' || record.date <= today)
    if (!previous && !observed) continue
    const installation = Boolean(isAlarmRecord(record) && zoneOf(record) !== 'no-monitoreada')
    const retirement = Boolean(isRetirementRecord(record))
    const delta = Number(installation) - Number(retirement)
    if (previous) previousNetGrowth += delta
    if (observed) {
      installations += Number(installation)
      retirements += Number(retirement)
      daily.set(record.date, (daily.get(record.date) || 0) + delta)
    }
  }
  const netGrowth = installations - retirements
  const dailyAverage = elapsedBusinessDays ? netGrowth / elapsedBusinessDays : null
  const projectedNetGrowth = period === 'past'
    ? netGrowth
    : period === 'current' && dailyAverage !== null
      ? rounded(dailyAverage * calendar.businessDays)
      : null
  let accumulated = 0
  const actual = elapsedDays ? [
    { date: calendar.before, day: 0, value: 0 },
    ...calendar.days.slice(0, elapsedDays).map(day => {
      accumulated += daily.get(day.date) || 0
      return { date: day.date, day: day.day, value: accumulated }
    })
  ] : []
  const projected = period === 'current' && dailyAverage !== null && elapsedDays < calendar.days.length ? [
    { date: today, day: elapsedDays, value: netGrowth },
    ...calendar.days.slice(elapsedDays).map(day => ({ date: day.date, day: day.day, value: rounded(dailyAverage * day.businessDays) }))
  ] : []
  const comparison = period === 'past' ? netGrowth : period === 'current' ? projectedNetGrowth : null
  return {
    month,
    period,
    daysInMonth: calendar?.days.length || 0,
    businessDays: calendar?.businessDays || 0,
    elapsedBusinessDays,
    elapsedDays,
    installations,
    retirements,
    netGrowth,
    projectedNetGrowth,
    dailyAverage,
    previousMonth: calendar?.previousMonth || '',
    previousNetGrowth,
    variation: comparison !== null && previousNetGrowth ? rounded((comparison - previousNetGrowth) / Math.abs(previousNetGrowth) * 100) : null,
    actual,
    projected,
    axis: netProjectionAxis([...actual, ...projected].map(point => point.value)),
    hasData: installations > 0 || retirements > 0
  }
}

/**
 * A completed work record may contain several service types. Donut shares
 * represent those service occurrences; workCount remains a separate total.
 * Uncategorized work still contributes one occurrence, avoiding a missing arc.
 */
export function buildWorkComposition(records = []) {
  const counts = new Map()
  let workCount = 0
  let serviceCount = 0
  let hasMultipleServices = false
  for (const record of records || []) {
    if (record?.status !== 'Completado') continue
    workCount++
    const types = serviceTypesFor(record)
    const names = types.length ? types.map(type => String(type?.name || '').trim() || 'Sin especificar') : ['Sin especificar']
    if (names.length > 1) hasMultipleServices = true
    serviceCount += names.length
    for (const name of names) counts.set(name, (counts.get(name) || 0) + 1)
  }
  const items = [...counts].map(([name, count]) => ({ name, count, share: count / serviceCount, percentage: count / serviceCount * 100 }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'es'))
  return { workCount, serviceCount, items, hasMultipleServices }
}
