import { visibleAnnualMonthLabels } from '../../annual-chart.mjs'

export const ANNUAL_CHART_SERIES = Object.freeze([
  Object.freeze({ key: 'docta', label: 'Docta' }),
  Object.freeze({ key: 'nobu-town', label: 'Nobu Town' }),
  Object.freeze({ key: 'residencial', label: 'Residenciales' }),
  Object.freeze({ key: 'retirements', label: 'Bajas' })
])

const locationKeys = ['docta', 'nobu-town', 'residencial']
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0

/** Monthly counts use the dashboard's existing classification rules. */
export function annualChartMonths(records = [], { year, today, isAlarmRecord, zoneOf, isRetirementRecord } = {}) {
  if (!/^\d{4}$/.test(String(year || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) return []
  const referenceDate = new Date(`${today}T12:00:00`)
  if (!Number.isFinite(referenceDate.getTime())) return []
  const months = visibleAnnualMonthLabels(year, referenceDate).map((label, index) => ({
    key: `${year}-${String(index + 1).padStart(2, '0')}`,
    label,
    value: 0,
    locations: { docta: 0, 'nobu-town': 0, residencial: 0 },
    retirements: 0
  }))
  const byMonth = new Map(months.map(month => [month.key, month]))
  for (const record of records || []) {
    if (record?.status !== 'Completado') continue
    const month = byMonth.get(String(record.date || '').slice(0, 7))
    if (!month) continue
    if (typeof isAlarmRecord === 'function' && typeof zoneOf === 'function' && isAlarmRecord(record)) {
      const zone = zoneOf(record)
      if (zone !== 'no-monitoreada') {
        month.value++
        if (locationKeys.includes(zone)) month.locations[zone]++
      }
    }
    if (typeof isRetirementRecord === 'function' && isRetirementRecord(record)) month.retirements++
  }
  return months
}

/** Shared linear scale for counts: zero baseline, whole-number readable ticks. */
export function annualChartAxis(maximum = 0, { targetIntervals = 4 } = {}) {
  const highest = count(maximum)
  if (!highest) return { min: 0, max: 1, step: 1, ticks: [0, 1] }
  const intervals = Number.isFinite(targetIntervals) ? Math.max(1, Math.min(10, Math.floor(targetIntervals))) : 4
  const roughStep = Math.max(1, highest / intervals)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = [1, 2, 5, 10].find(candidate => candidate * magnitude >= roughStep) * magnitude
  const max = Math.ceil(highest / step) * step
  return { min: 0, max, step, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) }
}

/** Four independent series; retirement counts are positive and never stacked. */
export function annualChartModel(inputMonths = [], options = {}) {
  const months = inputMonths.map(month => ({
    ...month,
    value: count(month.value),
    locations: Object.fromEntries(locationKeys.map(key => [key, count(month.locations?.[key])])),
    retirements: count(month.retirements)
  }))
  const series = ANNUAL_CHART_SERIES.map(item => ({
    ...item,
    values: months.map(month => item.key === 'retirements' ? month.retirements : month.locations[item.key])
  }))
  const maximum = Math.max(0, ...series.flatMap(item => item.values))
  return { months, series, axis: annualChartAxis(maximum, options), hasData: maximum > 0 }
}
