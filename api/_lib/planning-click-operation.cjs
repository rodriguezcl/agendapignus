const { isDeepStrictEqual: equal } = require('node:util')
const { applyStateOperations } = require('./state-operations.cjs')
const { authorizeIncomingState, stateSessionUser, visibleStateForUser } = require('./core.cjs')
const { synchronizeTeamServiceAssignments } = require('./team-service-assignments.cjs')
const { synchronizeVehicleControlAssignments } = require('./vehicle-control-assignment.cjs')
const { validateChangedAgendaSchedules } = require('./scheduling-validation.cjs')
const { assertCompletedServiceChange } = require('./completed-service-policy.cjs')
const permissions = require('./permission-catalog.cjs')
const { customerForRecord } = require('./granular-read-policy.cjs')

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

const stringList = value => Array.isArray(value) && value.every(item => typeof item === 'string')
const emptyTeamFields = new Set(['teamId', 'label', 'memberIds', 'members', 'tasks', 'monthlyStaffingOverride', 'guardOverride'])
function emptyStaffingTeam(team) {
  return plain(team) && typeof team.teamId === 'string' && team.teamId && typeof team.label === 'string' &&
    Object.keys(team).every(key => emptyTeamFields.has(key)) && stringList(team.memberIds) && stringList(team.members) &&
    Array.isArray(team.tasks) && !team.tasks.length && ['monthlyStaffingOverride', 'guardOverride'].every(key => !Object.hasOwn(team, key) || team[key] === true)
}

function membershipChange(current, operations) {
  let selectedDay
  const memberIds = [], members = []
  for (const op of operations) {
    const path = op?.path
    if (!Array.isArray(path) || path[0] !== 'agenda' || op.exists !== true) return null
    const weekly = path.length === 6 && path[1] === 'weekly' && path[3] === 'teams' && selector(path[4])
    const daily = path.length === 4 && path[1] === 'teams' && selector(path[2])
    const addDay = !op.existed && path.length === 3 && path[1] === 'weekly'
    const addTeam = !op.existed && path.length === 5 && path[1] === 'weekly' && path[3] === 'teams' && selector(path[4])
    if (!weekly && !daily && !addDay && !addTeam) return null
    const day = daily ? current.agenda?.date : path[2]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || selectedDay && day !== selectedDay) return null
    selectedDay = day
    // The first member selection can also materialize an empty monthly team
    // or day. Real services, tombstones and concurrent structural merges need
    // the complete validator.
    if (addDay || addTeam) {
      const plan = current.agenda?.weekly?.[day]
      if (addDay && (plan || !plain(op.after) || Object.keys(op.after).length !== 1 || !Array.isArray(op.after.teams))) return null
      if (addTeam && (op.after?.teamId !== path[4].id || plan?.teams?.some(team => String(team.teamId) === path[4].id))) return null
      const teams = addDay ? op.after.teams : [op.after]
      if (!teams.every(emptyStaffingTeam) || !teams.some(team => team.monthlyStaffingOverride === true) ||
          new Set(teams.map(team => team.teamId)).size !== teams.length) return null
      for (const team of teams) { memberIds.push(...team.memberIds); members.push(...team.members) }
      continue
    }
    const field = path.at(-1)
    if (['memberIds', 'members'].includes(field)) {
      if (!stringList(op.after)) return null
      if (field === 'memberIds') memberIds.push(...op.after)
      else members.push(...op.after)
    } else if (!['monthlyStaffingOverride', 'guardOverride'].includes(field) || op.after !== true) return null
  }
  return { day: selectedDay, memberIds, members }
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
// label. Changes carrying service data besides preparation, and unknown
// structures, use the complete pipeline.
function preparePlanningClick(current, operations, user) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 32) return null
  const granular = permissions.isGranular(user)
  const preparation = preparationOperation(operations)
  if (preparation) {
    if (granular) return null
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
  const change = membershipChange(current, operations)
  if (!change) return null
  const { day, memberIds, members } = change
  const actor = permissions.permissionSnapshot(stateSessionUser(current, user))
  if (permissions.isGranular(actor) !== granular) return null
  // Related-account permissions and technician agenda gates need history across
  // multiple dates. Keep the complete projection for those restricted scopes.
  if (granular && (permissions.roleCode(actor) === 'technician' ||
      permissions.readScope(actor, 'customers') !== 'all' ||
      permissions.readScope(actor) !== 'all' || permissions.writeScope(actor) !== 'all')) return null
  const agenda = current.agenda || {}
  // All teams in the day remain present for overlap and vehicle responsibility
  // checks. Other days and catalog records cannot be changed by this command.
  const weekly = Object.fromEntries(Object.entries(agenda.weekly || {}).filter(([key]) => key.startsWith('_') || key === day))
  const scopedAgenda = { ...agenda, teams: agenda.date === day ? agenda.teams : [], weekly }
  const dayTasks = [...(weekly[day]?.teams || []), ...scopedAgenda.teams].flatMap(team => team.tasks || [])
  const historyAliases = new Set(dayTasks.flatMap(task => [task.historyId, task.sourceHistoryId]).filter(Boolean).map(String))
  const taskAliases = new Set(dayTasks.flatMap(task => [task.taskId, task.sourceTaskId]).filter(Boolean).map(String))
  const history = []
  // Legacy cards linked to another date require the complete schedule resolver.
  for (const record of current.history) {
    if (record.date === day) history.push(record)
    else if (historyAliases.has(String(record.id)) || record.taskId && taskAliases.has(String(record.taskId)) ||
        record.sourceTaskId && taskAliases.has(String(record.sourceTaskId))) return null
  }
  // A report can live on an earlier agenda copy even when the history row
  // is on this day. The general synchronizer protects the original crew.
  const dayRecordIds = new Set(history.map(record => String(record.id)))
  const dayRecordTasks = new Set(history.flatMap(record => [record.taskId, record.sourceTaskId]).filter(Boolean).map(String))
  const linksDayHistory = plan => plan?.teams?.some(team => team.tasks?.some(task =>
    [task.historyId, task.sourceHistoryId].some(id => id && dayRecordIds.has(String(id))) ||
    [task.taskId, task.sourceTaskId].some(id => id && dayRecordTasks.has(String(id)))))
  if (history.length && (agenda.date !== day && linksDayHistory(agenda) ||
      Object.entries(agenda.weekly || {}).some(([key, plan]) => key !== day && !key.startsWith('_') && linksDayHistory(plan)))) return null
  if (history.some(record => !record.status || needsDurationRepair(record)) ||
      dayTasks.some(needsDurationRepair)) return null
  const inactiveEmployees = current.employees.filter(employee => employee.status === 'Inactivo')
  if (inactiveEmployees.length) {
    const inactiveIds = new Set(inactiveEmployees.map(employee => String(employee.id)))
    const nameKey = name => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
    const inactiveNames = new Set(inactiveEmployees.map(employee => nameKey(employee.name || [employee.firstName, employee.lastName].filter(Boolean).join(' '))))
    if (memberIds.some(id => inactiveIds.has(id)) || members.some(name => inactiveNames.has(nameKey(name)))) return null
  }
  const customers = granular ? [...new Set([...history, ...dayTasks].map(record => customerForRecord(record, current)).filter(Boolean))] : []
  const scope = { ...empty, roles: current.roles, customers, employees: current.employees, services: current.services, history, agenda: scopedAgenda }
  const visible = visibleStateForUser(scope, actor)
  const edited = applyStateOperations({ agenda: visible.agenda }, operations)
  // Granular authorization restores private fields against the same raw day.
  // Send its visible projection, exactly as a normal save would.
  const authorized = authorizeIncomingState({ ...(granular ? visible : scope), agenda: edited.agenda }, scope, actor)
  const employees = new Set(current.employees.map(employee => String(employee.id)))
  if (memberIds.some(id => !employees.has(id))) throw new Error('El equipo contiene un técnico inexistente.')
  let next = synchronizeTeamServiceAssignments(authorized, scope)
  next = require('./friday-solo-teams.cjs').unifyFridaySoloTeams(next, scope)
  next = synchronizeVehicleControlAssignments(next, scope)
  for (const record of next.history) {
    const before = history.find(item => String(item.id) === String(record.id))
    if (equal(before, record)) continue
    assertCompletedServiceChange(before, record)
    if ((record.technicianIds || []).some(id => !employees.has(String(id)))) throw new Error('El servicio contiene un técnico inexistente.')
  }
  validateChangedAgendaSchedules(next, scope)
  const nextHistory = new Map(next.history.map(record => [String(record.id), record]))
  const mergedHistory = current.history.map(record => nextHistory.has(String(record.id)) ? restoreUnchanged(record, nextHistory.get(String(record.id))) : record)
  let mergedWeekly = agenda.weekly
  for (const [key, value] of Object.entries(next.agenda.weekly || {})) {
    const saved = restoreUnchanged(agenda.weekly?.[key], value)
    if (saved === agenda.weekly?.[key]) continue
    if (mergedWeekly === agenda.weekly) mergedWeekly = { ...agenda.weekly }
    mergedWeekly[key] = saved
  }
  const teams = agenda.date === day ? restoreUnchanged(agenda.teams, next.agenda.teams) : agenda.teams
  const mergedAgenda = mergedWeekly === agenda.weekly && teams === agenda.teams ? agenda : { ...agenda, weekly: mergedWeekly, teams }
  // A history/agenda-only delta is sufficient for an unrestricted planner.
  // Vehicle visibility, related accounts and journey indexes may depend on
  // other dates. For those cases project the complete state as usual.
  const ordinaryDay = !['inactive', 'operator', 'supervisor', 'technician'].includes(permissions.roleCode(actor)) &&
    (!granular || permissions.can(actor, 'weekly.view') && permissions.can(actor, 'records.read') &&
      ![...history, ...dayTasks].some(record => record.serviceJourney || record.vehicleId)) &&
    Object.keys(next.agenda.weekly || {}).every(key => key === day || mergedWeekly?.[key] === agenda.weekly?.[key])
  const project = (state, dayHistory, revision) => {
    const { history, agenda: projected } = visibleStateForUser({ ...scope, history: dayHistory,
      agenda: { ...state, weekly: state.weekly?.[day] ? { [day]: state.weekly[day] } : {}, teams: day === state.date ? state.teams : [] }
    }, actor)
    return { revision, history, agenda: projected }
  }
  return {
    kind: 'team_membership',
    ...(ordinaryDay ? { deltaInputs: revision => [project(agenda, history, current.revision), project(mergedAgenda, next.history, revision)] } : {}),
    state: { ...current, history: mergedHistory.every((record, index) => record === current.history[index]) ? current.history : mergedHistory, agenda: mergedAgenda }
  }
}

module.exports = { preparePlanningClick }
