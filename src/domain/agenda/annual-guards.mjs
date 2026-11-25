import guardRotation from '../../../api/_lib/annual-guard-rotation.cjs'
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

export const annualGuardForDate = (date, weekly = {}) => guardRotation.guardForDate(date, weekly?._annualGuards?.[String(date).slice(0,4)])
