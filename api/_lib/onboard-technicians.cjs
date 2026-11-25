const { roleCode } = require('./permission-catalog.cjs')
const { guardForDate, firstSaturday } = require('./annual-guard-rotation.cjs')
const { historyRecordMatchesTask } = require('./history-record-operation.cjs')
const { preserveServiceAssignment } = require('./service-assignment-history.cjs')
const { randomUUID } = require('node:crypto')
const { guardEligibleFrom, guardEligibleOnDate } = require('./guard-eligibility.cjs')

const id = value => String(value ?? '')
const signature = values => JSON.stringify((values || []).map(id).sort())
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const employeeName = employee => {
  const firstName = String(employee.firstName || '').trim(), lastName = String(employee.lastName || '').trim()
  return String(firstName && lastName ? `${firstName} ${lastName}` : employee.name || firstName || lastName).trim().replace(/\s+/g, ' ')
}
const eligible = (employee, state) => employee.status === 'Activo' && roleCode((state.roles || []).find(role => id(role.id) === id(employee.roleId)) || employee) === 'technician'
const control = record => record?.vehicleControl || record?.serviceId === 'vehicle-weekly-control'
const pending = record => (!record?.status || record.status === 'Pendiente') && !preserveServiceAssignment(record)
const syncCrewAliases = team => {
  if (Object.hasOwn(team, 'technicianIds')) team.technicianIds = [...team.memberIds]
  if (Object.hasOwn(team, 'technicians')) team.technicians = [...team.members]
}
const dayAfter = (day, count = 1) => {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}
const nextSaturday = today => {
  let date = dayAfter(today)
  while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 6) date = dayAfter(date)
  return date
}
const guardIncludes = (rotation, employee) => rotation.some(item => item.technicianId != null
  ? id(item.technicianId) === id(employee.id)
  : normalized(item.name) === normalized(employeeName(employee)))
const guardEntry = employee => ({ technicianId: employee.id, name: employeeName(employee), ...(guardEligibleFrom(employee) ? { guardEligibleFrom: guardEligibleFrom(employee) } : {}) })
const teamSnapshot = teams => (teams || []).map((team, index) => ({
  teamId: team.teamId || '', label: team.label || `Equipo ${index + 1}`,
  technicianIds: [...(team.memberIds || [])], technicians: [...(team.members || [])]
}))
const guardSnapshot = rotation => (rotation || []).map((guard, index) => ({
  position: index + 1, technicianId: guard.technicianId || '', technician: guard.name || guard.technician || 'Técnico no disponible'
}))
const recordConfigurationChange = (config, type, period, before, after, effectiveFrom) => {
  config.configurationHistory = [...(config.configurationHistory || []), {
    id: `configuration-${type}-${period}-${randomUUID()}`, type, period,
    at: new Date().toISOString(), user: { id: '', name: 'Sistema', email: '' },
    reason: 'Alta de técnico', effectiveFrom, before, after
  }]
}

// Invoked after employee authorization. New eligible technicians join saved
// planning; no departing employee identity or historical work is transferred.
function reconcileNewTechnicians(next, current = {}, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })) {
  const existing = new Set((current.employees || []).filter(employee => eligible(employee, current)).map(employee => id(employee.id)))
  const additions = (next.employees || []).filter(employee => employee.id != null && eligible(employee, next) && !existing.has(id(employee.id)))
  const priorEmployees = new Map((current.employees || []).map(employee => [id(employee.id), employee]))
  const dateChanges = new Set((next.employees || []).filter(employee => eligible(employee, next) && priorEmployees.has(id(employee.id)) && guardEligibleFrom(employee) !== guardEligibleFrom(priorEmployees.get(id(employee.id)))).map(employee => id(employee.id)))
  if (!additions.length && !dateChanges.size) return next
  const result = structuredClone(next)
  result.agenda ||= {}
  result.agenda.weekly ||= {}
  const weekly = result.agenda.weekly
  const baselineHistory = next.history || []
  const resultHistory = new Map((result.history || []).map(record => [id(record.id), record]))
  const plans = Object.entries(weekly).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date)).map(([date, plan]) => ({ date, plan }))
  if (result.agenda.date) plans.push({ date: result.agenda.date, plan: result.agenda })
  let changed = false

  // Only the current period is initialized. Explicit empty configurations
  // remain empty, and existing daily plans have no inherited template to alter.
  const monthNow = today.slice(0, 7), yearNow = today.slice(0, 4)
  const active = (next.employees || []).filter(employee => eligible(employee, next))
  if (additions.length && !Object.hasOwn(weekly._monthlyTeams || {}, monthNow)) {
    const count = Math.min(active.length, result.vehicles?.length || 3)
    const teams = Array.from({ length: count }, (_, index) => ({ teamId: `onboard-${monthNow}-${index + 1}`, label: `Equipo ${index + 1}`, memberIds: [], members: [] }))
    active.forEach((employee, index) => { teams[index % count].memberIds.push(employee.id); teams[index % count].members.push(employeeName(employee)) })
    weekly._monthlyTeams = { ...weekly._monthlyTeams, [monthNow]: { teams } }
    recordConfigurationChange(weekly._monthlyTeams[monthNow], 'teams', monthNow, [], teamSnapshot(teams), today)
    changed = true
  }
  if (additions.length && !Object.hasOwn(weekly._annualGuards || {}, yearNow)) {
    const startDate = nextSaturday(today)
    if (startDate.startsWith(yearNow)) {
      weekly._annualGuards = { ...weekly._annualGuards, [yearNow]: {
        startDate, effectiveFrom: startDate,
        rotation: active.map(guardEntry),
        previousRotations: [{ effectiveFrom: `${yearNow}-01-01`, startDate: firstSaturday(yearNow), rotation: [] }]
      } }
      recordConfigurationChange(weekly._annualGuards[yearNow], 'guards', yearNow, [], guardSnapshot(weekly._annualGuards[yearNow].rotation), startDate)
      changed = true
    }
  }

  const replaceInheritedTeam = (date, teamId, oldIds, newIds, newNames, guard = false) => {
    if (!teamId) return
    const copies = plans.filter(item => item.date === date).flatMap(({ plan }) => (plan.teams || []).filter(team => id(team.teamId) === id(teamId)))
    if (!copies.length || copies.some(team => team.guardOverride || team.monthlyStaffingOverride || signature(team.memberIds) !== signature(oldIds))) return
    const tasks = copies.flatMap(team => team.tasks || [])
    const related = baselineHistory.filter(record => record.date === date && (id(record.teamId) === id(teamId) || tasks.some(task => historyRecordMatchesTask(task, record))))
    // A report in either projection or history protects the entire crew.
    if (tasks.some(task => !pending(task)) || related.some(record => !pending(record))) return
    const inherits = record => !record?.technicianIds?.length || signature(record.technicianIds) === signature(oldIds)
    // Team assignment normalization runs after this helper. Keep the whole
    // team unchanged when an individual service has an explicit exception.
    if (tasks.some(task => !control(task) && !inherits(task)) || related.some(record => !control(record) && !inherits(record))) return
    for (const team of copies) {
      team.memberIds = [...newIds]
      team.members = [...newNames]
      syncCrewAliases(team)
      if (guard && String(team.label || '').startsWith('Guardia')) team.label = `Guardia · ${newNames.join(' / ')}`
      for (const task of team.tasks || []) {
        const record = related.find(item => historyRecordMatchesTask(task, item))
        if (control(task) || control(record)) continue
        if (Object.hasOwn(task, 'technicianIds')) task.technicianIds = [...newIds]
        if (Object.hasOwn(task, 'technicians')) task.technicians = [...newNames]
      }
    }
    for (const record of related) {
      if (control(record)) continue
      const target = resultHistory.get(id(record.id))
      if (target) { target.technicianIds = [...newIds]; target.technicians = [...newNames] }
    }
  }

  for (const [month, config] of Object.entries(weekly._monthlyTeams || {})) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < today.slice(0, 7) || !config.teams?.length) continue
    const previousTeams = structuredClone(config.teams)
    let updated = false
    for (const employee of additions) {
      if (config.teams.some(team => (team.memberIds || []).some(value => id(value) === id(employee.id)))) continue
      const team = config.teams.reduce((smallest, item) => (item.memberIds || []).length < (smallest.memberIds || []).length ? item : smallest)
      team.memberIds = [...(team.memberIds || []), employee.id]
      team.members = [...(team.members || []), employeeName(employee)]
      syncCrewAliases(team)
      updated = true
    }
    if (!updated) continue
    changed = true
    recordConfigurationChange(config, 'teams', month, teamSnapshot(previousTeams), teamSnapshot(config.teams), month === monthNow ? today : `${month}-01`)
    for (const previous of previousTeams) {
      const team = config.teams.find(item => id(item.teamId) === id(previous.teamId))
      if (!team || signature(previous.memberIds) === signature(team.memberIds)) continue
      const dates = new Set(plans.filter(({ date }) => date >= today && date.startsWith(`${month}-`) && ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())).map(item => item.date))
      for (const date of dates) replaceInheritedTeam(date, previous.teamId, previous.memberIds || [], team.memberIds, team.members)
    }
  }

  for (const [year, config] of Object.entries(weekly._annualGuards || {})) {
    if (!/^\d{4}$/.test(year) || year < today.slice(0, 4) || !config.rotation?.length) continue
    const previous = structuredClone(config)
    const missing = additions.filter(employee => !guardIncludes(config.rotation || [], employee))
    const employeeForGuard = guard => active.find(employee => guardIncludes([guard], employee))
    const datesChanged = config.rotation.some(guard => {
      const employee = employeeForGuard(guard)
      return employee && dateChanges.has(id(employee.id)) && (guard.guardEligibleFrom || '') !== guardEligibleFrom(employee)
    })
    if (!missing.length && !datesChanged) continue
    let effectiveFrom = year > today.slice(0, 4) ? firstSaturday(year) : nextSaturday(today)
    if (config.effectiveFrom > effectiveFrom) effectiveFrom = config.effectiveFrom
    while (new Date(`${effectiveFrom}T12:00:00Z`).getUTCDay() !== 6) effectiveFrom = dayAfter(effectiveFrom)
    if (!effectiveFrom.startsWith(year)) continue
    const rotation = config.rotation || []
    const expected = guardForDate(effectiveFrom, config)
    const offset = Math.max(0, rotation.findIndex(item => expected?.technicianId != null ? id(item.technicianId) === id(expected.technicianId) : item.name === expected?.name))
    const ordered = [...rotation.slice(offset), ...rotation.slice(0, offset)].map(guard => {
      const employee = employeeForGuard(guard)
      if (!employee || !dateChanges.has(id(employee.id))) return guard
      const { guardEligibleFrom: ignoredEligibility, ...entry } = guard
      return { ...entry, ...(guardEligibleFrom(employee) ? { guardEligibleFrom: guardEligibleFrom(employee) } : {}) }
    })
    Object.assign(config, {
      rotation: [...ordered, ...missing.map(guardEntry)],
      startDate: effectiveFrom, effectiveFrom,
      previousRotations: [...(config.previousRotations || []), {
        effectiveFrom: config.effectiveFrom || `${year}-01-01`,
        startDate: config.startDate || firstSaturday(year), rotation: structuredClone(rotation)
      }]
    })
    recordConfigurationChange(config, 'guards', year, guardSnapshot(previous.rotation), guardSnapshot(config.rotation), effectiveFrom)
    changed = true
    const dates = new Set(plans.filter(({ date }) => date > today).map(item => item.date))
    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
      const saturday = weekday === 5 ? dayAfter(date) : date
      if (![5, 6].includes(weekday) || !saturday.startsWith(year) || saturday < effectiveFrom) continue
      const before = guardForDate(saturday, previous)
      let after = guardForDate(saturday, config)
      if (weekday === 5 && after && !guardEligibleOnDate(after, date)) {
        const position = config.rotation.findIndex(guard => id(guard.technicianId) === id(after.technicianId))
        after = [...config.rotation.slice(position + 1), ...config.rotation.slice(0, position + 1)].find(guard => guardEligibleOnDate(guard, date)) || null
      }
      if (!before?.technicianId || id(before.technicianId) === id(after?.technicianId)) continue
      const teams = plans.filter(item => item.date === date).flatMap(({ plan }) => (plan.teams || []).filter((team, index) => weekday === 6 ? index === 0 : String(team.label || '').startsWith('Guardia')))
      for (const teamId of new Set(teams.map(team => team.teamId))) replaceInheritedTeam(date, teamId, [before.technicianId], after?.technicianId ? [after.technicianId] : [], after?.name ? [after.name] : [], true)
    }
  }
  return changed ? result : next
}

module.exports = { reconcileNewTechnicians }
