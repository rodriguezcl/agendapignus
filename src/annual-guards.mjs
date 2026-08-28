export const DEFAULT_2026_GUARD_ROTATION = [
  ['rodrigo', 'gonzalez'],
  ['pascual', 'gonzalez'],
  ['santos', 'diaz'],
  ['mariano', 'diaz', 'tillard'],
  ['leonardo', 'rivadero']
]

const isSaturday = date => Boolean(date) && new Date(`${date}T12:00:00`).getDay() === 6

export const firstSaturdayOfYear = year => {
  const value = new Date(`${year}-01-01T12:00:00`)
  value.setDate(value.getDate() + ((6 - value.getDay() + 7) % 7))
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export const annualGuardForDate = (date, weekly = {}) => {
  if (!isSaturday(date)) return null
  const year = String(date).slice(0, 4)
  const config = weekly?._annualGuards?.[year]
  const rotation = (config?.rotation || []).filter(item => item?.technicianId || item?.name)
  if (!rotation.length) return null
  const startDate = config.startDate || firstSaturdayOfYear(year)
  const elapsedWeeks = Math.round((new Date(`${date}T12:00:00`) - new Date(`${startDate}T12:00:00`)) / 604800000)
  return rotation[((elapsedWeeks % rotation.length) + rotation.length) % rotation.length]
}
