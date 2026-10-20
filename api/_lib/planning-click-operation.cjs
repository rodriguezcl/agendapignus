const { isDeepStrictEqual: equal } = require('node:util')
const { applyStateOperations } = require('./state-operations.cjs')
const { authorizeIncomingState, visibleStateForUser } = require('./core.cjs')
const { synchronizeTeamServiceAssignments } = require('./team-service-assignments.cjs')
const { synchronizeVehicleControlAssignments } = require('./vehicle-control-assignment.cjs')
const { validateChangedAgendaSchedules } = require('./scheduling-validation.cjs')
const { assertCompletedServiceChange } = require('./completed-service-policy.cjs')

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const selector = value => plain(value) && value.key === 'teamId' && typeof value.id === 'string'
const withoutPreparation = ({ servicePreparation, ...record }) => record
const empty = { roles: [], employees: [], services: [], vehicles: [], customers: [], reviews: [], preferences: {} }
const needsDurationRepair = record => Boolean(record?.serviceId || record?.service) &&
  (!Number.isInteger(Number(record.estimatedMinutes)) || Number(record.estimatedMinutes) < 15 || Number(record.estimatedMinutes) > 720)

function preparationOperation(operations) {
  if (operations.length !== 1) return null
  const op = operations[0]
  if (!Array.isArray(op?.path) || op.path.length !== 2 || op.path[0] !== 'history' || op.path[1]?.key !== 'id' ||
      typeof op.path[1]?.id !== 'string' || !op.existed || !op.exists || !plain(op.before) || !plain(op.after) ||
      !plain(op.after.servicePreparation) || typeof op.after.servicePreparation.ready !== 'boolean') return null
  return equal(withoutPreparation(op.before), withoutPreparation(op.after)) ? op : null
}

function membershipDay(current, operations) {
  let selectedDay
  for (const op of operations) {
    const path = op?.path
    if (!Array.isArray(path) || path[0] !== 'agenda' || op.exists !== true) return null
    const weekly = path.length === 6 && path[1] === 'weekly' && path[3] === 'teams' && selector(path[4])
    const daily = path.length === 4 && path[1] === 'teams' && selector(path[2])
    if (!weekly && !daily) return null
    const day = weekly ? path[2] : current.agenda?.date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || selectedDay && day !== selectedDay) return null
    selectedDay = day
    const field = path.at(-1)
    if (['memberIds', 'members'].includes(field)) {
      if (!Array.isArray(op.after) || op.after.some(value => typeof value !== 'string')) return null
    } else if (!['monthlyStaffingOverride', 'guardOverride'].includes(field) || op.after !== true) return null
  }
  return selectedDay
}

function restoreUnchanged(before, after) {
  if (equal(before, after)) return before
  // Authorization may add absent optional fields with value undefined. JSON
  // storage omits those keys; they must not turn a replay into another write.
  const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  return JSON.stringify(canonical(before)) === JSON.stringify(canonical(after)) ? before : after
}

// This recognizes a closed set of field changes, not a client supplied command
// label. Structural additions and every mixed/unknown payload use the complete
// state pipeline. Existing conflict and authorization policies remain canonical.
function preparePlanningClick(current, operations, user) {
  // Scoped snapshots omit the customer/role data needed by v2 scope policies.
  // The complete pipeline remains authoritative for granular roles.
  if (require('./permission-catalog.cjs').isGranular(user)) return null
  if (!Array.isArray(operations) || !operations.length || operations.length > 32) return null
  const preparation = preparationOperation(operations)
  if (preparation) {
    const record = current.history.find(item => String(item.id) === preparation.path[1].id)
    // Legacy duration repair stays in the general pipeline.
    if (record && (!record.status || needsDurationRepair(record))) return null
    const scope = { ...empty, history: record ? [record] : [], agenda: current.agenda }
    const visible = visibleStateForUser(scope, user)
    let operation = preparation
    // The authoritative attribution is added by the server. A lost-response
    // replay with the same desired flag is a no-op only if all other record
    // fields still match; an unrelated edit of this service still conflicts.
    if (record && record.servicePreparation?.ready === preparation.after.servicePreparation.ready &&
        equal(withoutPreparation(record), withoutPreparation(preparation.after))) operation = { ...preparation, after: record }
    const authorized = authorizeIncomingState(applyStateOperations(visible, [operation]), scope, user)
    const updated = restoreUnchanged(record, authorized.history[0])
    return {
      kind: 'service_preparation',
      state: { ...current, history: updated === record ? current.history : current.history.map(item => item === record ? updated : item), agenda: restoreUnchanged(current.agenda, authorized.agenda) }
    }
  }
  const day = membershipDay(current, operations)
  if (!day) return null
  const agenda = current.agenda || {}
  // All teams in the day remain present for overlap and vehicle responsibility
  // checks. Other days and catalog records cannot be changed by this command.
  const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).filter(([key]) => key.startsWith('_') || key === day))
  const scopedAgenda = { ...agenda, teams: agenda.date === day ? agenda.teams : [], weekly }
  const history = current.history.filter(record => record.date === day)
  const dayTasks = [...(weekly[day]?.teams || []), ...scopedAgenda.teams].flatMap(team => team.tasks || [])
  const foreignIds = new Set(), foreignTasks = new Set()
  for (const record of current.history) {
    if (record.date === day) continue
    foreignIds.add(String(record.id))
    for (const id of [record.taskId, record.sourceTaskId]) if (id) foreignTasks.add(String(id))
  }
  // Legacy cards can point at a closed/moved service on another date. Their
  // occupancy needs the complete history, so retain the general resolution.
  if (dayTasks.some(task => [task.historyId, task.sourceHistoryId].some(id => id && foreignIds.has(String(id))) ||
      [task.taskId, task.sourceTaskId].some(id => id && foreignTasks.has(String(id))))) return null
  if (history.some(record => !record.status || needsDurationRepair(record)) ||
      dayTasks.some(needsDurationRepair)) return null
  const scope = { ...empty, employees: current.employees, services: current.services, history, agenda: scopedAgenda }
  const edited = applyStateOperations({ agenda: visibleStateForUser(scope, user).agenda }, operations)
  const authorized = authorizeIncomingState({ ...scope, agenda: edited.agenda }, scope, user)
  let next = synchronizeTeamServiceAssignments(authorized, scope)
  next = synchronizeVehicleControlAssignments(next, scope)
  const employees = new Set(current.employees.map(employee => String(employee.id)))
  for (const record of next.history) {
    const before = history.find(item => String(item.id) === String(record.id))
    if (equal(before, record)) continue
    assertCompletedServiceChange(before, record)
    if ((record.technicianIds || []).some(id => !employees.has(String(id)))) throw new Error('El servicio contiene un técnico inexistente.')
  }
  validateChangedAgendaSchedules(next, scope)
  const nextHistory = new Map(next.history.map(record => [String(record.id), record]))
  const mergedHistory = current.history.map(record => nextHistory.has(String(record.id)) ? restoreUnchanged(record, nextHistory.get(String(record.id))) : record)
  const mergedWeekly = { ...agenda.weekly }
  for (const [key, value] of Object.entries(next.agenda.weekly || {})) mergedWeekly[key] = restoreUnchanged(agenda.weekly?.[key], value)
  const mergedAgenda = { ...agenda, weekly: mergedWeekly, ...(agenda.date === day ? { teams: restoreUnchanged(agenda.teams, next.agenda.teams) } : {}) }
  return {
    kind: 'team_membership',
    state: { ...current, history: mergedHistory.every((record, index) => record === current.history[index]) ? current.history : mergedHistory, agenda: restoreUnchanged(agenda, mergedAgenda) }
  }
}

module.exports = { preparePlanningClick }
