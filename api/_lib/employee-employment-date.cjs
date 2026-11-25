const { roleCode } = require('./permission-catalog.cjs')
const { isCalendarDate } = require('./guard-eligibility.cjs')
const todayInArgentina = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
const technician = (employee, state) => roleCode((state?.roles || []).find(role => String(role.id) === String(employee?.roleId)) || employee) === 'technician'
const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400, code: 'EMPLOYMENT_START_DATE_INVALID' }) }

function normalizeEmployeeEmploymentDates(state, previous = {}, today = todayInArgentina()) {
  const old = new Map((previous.employees || []).map(employee => [String(employee.id), employee]))
  const employees = (state.employees || []).map(employee => {
    const prior = old.get(String(employee.id))
    const result = { ...employee }
    delete result.guardEligibleFrom // Derived lookup metadata is never authoritative.
    let value = Object.hasOwn(employee, 'employmentStartDate') ? employee.employmentStartDate : prior?.employmentStartDate
    if (prior?.employmentStartDate && (value == null || value === '')) invalid('La fecha de ingreso registrada no puede borrarse. Corregí la fecha si es necesario.')
    if ((value == null || value === '') && (!prior || technician(employee, state) && !technician(prior, previous))) value = today
    if (value != null && value !== '' && !isCalendarDate(value)) invalid('La fecha de ingreso debe ser una fecha válida (día, mes y año).')
    if (value != null) result.employmentStartDate = value
    return result
  })
  return { ...state, employees }
}

module.exports = { normalizeEmployeeEmploymentDates }
