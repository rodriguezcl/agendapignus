const crypto = require('node:crypto')

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const key = value => String(value ?? '')
const sortedIds = values => (values || []).map(key).sort()
const same = (a, b) => fingerprint(a ?? null) === fingerprint(b ?? null)

function analyzeNormalization(state) {
  const issues = [], occurrences = []
  const add = (type, severity, location, recordId = null, details = {}) => {
    const issue = { type, severity, location, recordId, details }
    issues.push({ id: fingerprint(issue), ...issue })
  }
  const collections = { history: 'id', customers: 'customerId', services: 'id', employees: 'id', roles: 'id', vehicles: 'id' }
  const maps = {}
  for (const [name, identity] of Object.entries(collections)) {
    maps[name] = new Map()
    if (!Array.isArray(state[name])) { add('invalid_collection', 'error', name); continue }
    state[name].forEach((record, index) => {
      const id = key(record?.[identity])
      if (!id) add('missing_identity', 'error', `${name}/${index}`)
      else if (maps[name].has(id)) add('duplicate_identity', 'error', `${name}/${index}`, id)
      else maps[name].set(id, record)
    })
  }
  const history = state.history || [], byTask = new Map(), memberships = new Map(), visitKeys = new Map()
  for (const record of history) {
    const id = key(record.id), location = `history/${id}`
    for (const [field, collection] of [['customerId', 'customers'], ['serviceId', 'services']]) {
      if (record[field] && !maps[collection].has(key(record[field]))) add('orphan_reference', 'error', location, id, { field })
      if (field === 'serviceId' && !record[field]) add('missing_service_type', 'error', location, id)
    }
    for (const technicianId of record.technicianIds || []) if (!maps.employees.has(key(technicianId))) add('orphan_technician', 'error', location, id)
    if (record.vehicleControl) {
      if (!record.vehicleId || !maps.vehicles.has(key(record.vehicleId))) add('orphan_vehicle', 'error', location, id)
      if ((record.technicianIds || []).length !== 1) add('invalid_vehicle_control_assignment', 'error', location, id)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key(record.date)) || Number.isNaN(Date.parse(`${record.date}T12:00:00Z`))) add('invalid_date', 'error', location, id)
    if (record.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.time)) add('invalid_time', 'error', location, id)
    if (!Number.isInteger(Number(record.estimatedMinutes)) || Number(record.estimatedMinutes) < 15 || Number(record.estimatedMinutes) > 720) add('invalid_duration', 'error', location, id)
    if (!['Pendiente', 'Completado', 'Avance registrado', 'Cancelado', 'Reprogramado', 'Requiere revisión'].includes(record.status)) add('invalid_status', 'error', location, id)
    if (!record.sourceTaskId) add('legacy_missing_task_id', 'info', location, id)
    else if (byTask.has(key(record.sourceTaskId))) add('duplicate_task_identity', 'error', location, id)
    else byTask.set(key(record.sourceTaskId), record)
    if (record.status === 'Completado' && !record.completedAt) add('unknown_completion_timestamp', 'info', location, id)
    if (!record.vehicleControl) {
      const group = JSON.stringify([record.date, record.teamId])
      const memberSets = memberships.get(group) || new Map()
      memberSets.set(JSON.stringify(sortedIds(record.technicianIds)), [...(memberSets.get(JSON.stringify(sortedIds(record.technicianIds))) || []), id])
      memberships.set(group, memberSets)
    }
    const visit = JSON.stringify([record.date, record.time, record.customerId, record.serviceId, sortedIds(record.technicianIds)])
    const visits = visitKeys.get(visit) || []
    visits.push(id); visitKeys.set(visit, visits)
  }
  for (const [group, alternatives] of memberships) if (alternatives.size > 1) add('team_membership_conflict', 'review', `team/${group}`, null, { records: [...alternatives.values()].flat().sort() })
  for (const records of visitKeys.values()) if (records.length > 1) add('possible_duplicate_visit', 'review', 'history', null, { records: records.sort() })
  for (const employee of state.employees || []) if (!maps.roles.has(key(employee.roleId))) add('orphan_role', 'error', `employees/${employee.id}`)
  const plans = Object.entries(state.agenda?.weekly || {}).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date)).map(([date, plan]) => ({ scope: 'weekly', date, plan }))
  if (state.agenda?.date) plans.push({ scope: 'daily', date: state.agenda.date, plan: state.agenda })
  const locations = new Map()
  for (const { scope, date, plan } of plans) {
    const seen = new Set()
    for (const [teamIndex, team] of (plan.teams || []).entries()) for (const [taskIndex, task] of (team.tasks || []).entries()) {
      const location = `${scope}/${date}/${teamIndex}/${taskIndex}`
      const fromId = maps.history.get(key(task.historyId)), fromTask = byTask.get(key(task.taskId))
      if (fromId && fromTask && fromId.id !== fromTask.id) add('conflicting_links', 'review', location, key(fromId.id), { alternativeRecordId: key(fromTask.id) })
      const record = fromId || fromTask
      occurrences.push({ id: fingerprint({ scope, date, teamIndex, taskIndex }), scope, date, teamId: key(team.teamId), recordId: record ? key(record.id) : null, source: structuredClone(task) })
      if (task.taskId && seen.has(key(task.taskId))) add('duplicate_agenda_task', 'review', location, record ? key(record.id) : null)
      if (task.taskId) seen.add(key(task.taskId))
      if (!(task.serviceId || task.service || task.client)) continue // empty availability is not a lost service
      if (task.historyId && !fromId) add('dangling_history_link', 'review', location, null, { vehicleControl: Boolean(task.vehicleControl) })
      if (!record) { add(task.vehicleControl ? 'unregistered_vehicle_control' : 'unregistered_service', 'review', location); continue }
      const id = key(record.id)
      if (scope === 'weekly') { const days = locations.get(id) || new Set(); days.add(date); locations.set(id, days) }
      for (const [field, value, expected] of [
        ['date', date, record.date], ['time', task.time, record.time], ['status', task.status, record.status],
        ['customer', task.customerId, record.customerId], ['service_type', task.serviceId, record.serviceId], ['team', team.teamId, record.teamId]
      ]) if (value != null && !same(key(value), key(expected))) add(`${field}_mismatch`, 'review', location, id)
      const technicians = task.vehicleControl ? task.technicianIds : team.memberIds
      if (!same(sortedIds(technicians), sortedIds(record.technicianIds))) add('technicians_mismatch', 'review', location, id)
    }
  }
  for (const [id, dates] of locations) if (dates.size > 1) add('multiple_weekly_dates', 'review', `history/${id}`, id, { dates: [...dates].sort() })
  const byType = {}, bySeverity = {}, affected = new Set()
  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] || 0) + 1
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1
    if (issue.severity !== 'info' && issue.recordId) affected.add(issue.recordId)
    if (issue.severity !== 'info') for (const id of issue.details.records || []) affected.add(id)
  }
  const statuses = {}, completedByMonth = {}
  for (const record of history) { statuses[record.status] = (statuses[record.status] || 0) + 1; if (record.status === 'Completado') completedByMonth[record.date.slice(0, 7)] = (completedByMonth[record.date.slice(0, 7)] || 0) + 1 }
  return {
    sourceFingerprint: fingerprint({ ...state, employees: (state.employees || []).map(({ password, passwordHash, ...safe }) => safe) }),
    revision: state.revision ?? null,
    summary: { history: history.length, customers: (state.customers || []).length, occurrences: occurrences.length, affectedRecords: affected.size, byType, bySeverity, statuses, completedByMonth,
      readyForCutover: false, requiresReconciliation: Boolean(bySeverity.error || bySeverity.review) },
    issues: issues.sort((a, b) => a.id.localeCompare(b.id)), occurrences
  }
}
module.exports = { analyzeNormalization, fingerprint, sortedIds }
