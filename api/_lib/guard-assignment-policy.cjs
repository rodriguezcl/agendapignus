const { guardEligibleFrom, isCalendarDate } = require('./guard-eligibility.cjs')
const { guardForDate } = require('./annual-guard-rotation.cjs')
const { serviceAssignmentProtection } = require('./service-assignment-history.cjs')
const todayInArgentina = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
const identity = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const weekday = date => isCalendarDate(date) ? new Date(`${date}T12:00:00Z`).getUTCDay() : -1
const vehicleControl = record => record?.vehicleControl || record?.serviceId === 'vehicle-weekly-control'
const lateFridayService = record => !vehicleControl(record) && !['Cancelado', 'Reprogramado'].includes(record?.status) &&
  (record?.serviceId || record?.service || record?.historyId || record?.customerId || record?.client) &&
  /^(16|17|18|19):[0-5]\d$|^20:00$/.test(String(record.time || record.scheduledTime || ''))

function isGuardTeam(date, team) {
  if (weekday(date) === 6) return true
  return weekday(date) === 5 && Boolean(team && (
    String(team.teamId || '').startsWith('friday-guard-') || /^guardia\b/i.test(String(team.label || '')) ||
    team.guard || team.guardAdvance || team.advancedGuard ||
    team.memberIds?.length === 1 && (team.tasks || []).some(lateFridayService)
  ))
}

function employeeFor(state, employeeId, name) {
  return employeeId != null && (state.employees || []).find(employee => String(employee.id) === String(employeeId)) ||
    name && (state.employees || []).find(employee => identity(employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`) === identity(name))
}

function assertEligible(employee, date) {
  if (!employee) return
  const from = guardEligibleFrom({ employmentStartDate: employee.employmentStartDate })
  if (from && date < from) throw Object.assign(new Error(`${employee.name || [employee.firstName, employee.lastName].filter(Boolean).join(' ') || 'El técnico'} puede realizar guardias desde el ${from.split('-').reverse().join('/')}, al cumplir 60 días desde su ingreso.`), { statusCode: 400, code: 'GUARD_PROBATION', employeeId: employee.id, guardEligibleFrom: from })
}

function assertCrew(ids, names, date, state) {
  for (let index = 0; index < Math.max(ids?.length || 0, names?.length || 0); index++) assertEligible(employeeFor(state, ids?.[index], names?.[index]), date)
}

function assertGuardServiceAssignment(record, previous, state = {}, today = todayInArgentina(), protectedAssignments = serviceAssignmentProtection(state)) {
  if (!record || !isCalendarDate(record.date) || record.date < today || protectedAssignments.record(record) || vehicleControl(record)) return
  const day = weekday(record.date)
  const teams = [...(state.agenda?.weekly?.[record.date]?.teams || []), ...(state.agenda?.date === record.date ? state.agenda.teams || [] : [])]
  const team = teams.find(value => String(value.teamId) === String(record.teamId))
  const friday = day === 5 && (isGuardTeam(record.date, team) || isGuardTeam(record.date, { teamId: record.teamId, label: record.team, memberIds: record.technicianIds, tasks: [record], guard: record.guard, guardAdvance: record.guardAdvance, advancedGuard: record.advancedGuard }))
  if (day === 6 || friday) assertCrew(record.technicianIds, record.technicians, record.date, state)
}

function validateGuardAssignments(state, previous, today = todayInArgentina()) {
  const plans = Object.entries(state?.agenda?.weekly || {}).filter(([date]) => isCalendarDate(date)).map(([date, plan]) => ({ date, plan }))
  if (isCalendarDate(state?.agenda?.date)) plans.push({ date: state.agenda.date, plan: state.agenda })
  const protectedAssignments = serviceAssignmentProtection(state)
  for (const { date, plan } of plans) {
    if (date < today) continue
    for (const team of plan?.teams || []) {
      if (!isGuardTeam(date, team)) continue
      const tasks = team.tasks || []
      if (tasks.length && tasks.every(task => protectedAssignments.task(task))) continue
      assertCrew(team.memberIds, team.members, date, state)
    }
  }
  for (const record of state?.history || []) assertGuardServiceAssignment(record, null, state, today, protectedAssignments)
  const previousProtection = previous && serviceAssignmentProtection(previous)
  const preservesRecordedGuardToday = (day, guard) => {
    if (day !== today || !previousProtection) return false
    const before = guardForDate(day, previous.agenda?.weekly?._annualGuards?.[day.slice(0, 4)])
    const employee = employeeFor(state, guard.technicianId, guard.name)
    const priorEmployee = before && employeeFor(previous, before.technicianId, before.name)
    if (!employee || !priorEmployee || String(employee.id) !== String(priorEmployee.id)) return false
    const assigned = (ids, names) => (ids || []).some(id => String(id) === String(employee.id)) ||
      (names || []).some(name => employeeFor(previous, null, name)?.id === priorEmployee.id)
    if ((previous.history || []).some(record => record.date === day && previousProtection.record(record) && assigned(record.technicianIds, record.technicians))) return true
    const teams = [...(previous.agenda?.weekly?.[day]?.teams || []), ...(previous.agenda?.date === day ? previous.agenda.teams || [] : [])]
    return teams.some(team => assigned(team.memberIds, team.members) && (team.tasks || []).some(task => previousProtection.task(task)))
  }
  // Validate the selected Saturdays against canonical employee dates. A forged
  // or omitted eligibility field in an annual rotation cannot grant a guard.
  for (const [year, config] of Object.entries(state?.agenda?.weekly?._annualGuards || {})) {
    if (!/^\d{4}$/.test(year) || year < today.slice(0, 4)) continue
    const date = new Date(`${year}-01-01T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + (6 - date.getUTCDay() + 7) % 7)
    while (String(date.getUTCFullYear()) === year) {
      const day = date.toISOString().slice(0, 10)
      if (day >= today) {
        const guard = guardForDate(day, config)
        if (guard && !preservesRecordedGuardToday(day, guard)) assertEligible(employeeFor(state, guard.technicianId, guard.name), day)
      }
      date.setUTCDate(date.getUTCDate() + 7)
    }
  }
}

module.exports = { isGuardTeam, assertGuardServiceAssignment, validateGuardAssignments }
