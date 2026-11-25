const DAY = 86400000

const isCalendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value

// Historical employees without an employment date keep their eligibility.
// Dates entered now are validated at the employee write boundary as well.
function guardEligibleFrom(employee) {
  const startDate = employee?.employmentStartDate
  if (startDate == null || startDate === '') {
    const projected = employee?.guardEligibleFrom
    if (projected == null || projected === '') return ''
    if (!isCalendarDate(projected)) throw new TypeError('La fecha de habilitación para guardias debe ser una fecha válida.')
    return projected
  }
  if (!isCalendarDate(startDate)) throw new TypeError('La fecha de ingreso debe ser una fecha válida.')
  return new Date(Date.parse(`${startDate}T12:00:00Z`) + 60 * DAY).toISOString().slice(0, 10)
}

function guardEligibleOnDate(entry, date) {
  if (!entry || !isCalendarDate(date)) return false
  let from
  try { from = guardEligibleFrom(entry) } catch { return false }
  return !from || (isCalendarDate(from) && date >= from)
}

module.exports = { guardEligibleFrom, guardEligibleOnDate, isCalendarDate }
