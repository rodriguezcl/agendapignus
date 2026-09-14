const text = value => String(value || '').trim()
const sortedIds = values => [...new Set((values || []).map(value => text(value)).filter(Boolean))].sort()
const sameIds = (left, right) => JSON.stringify(sortedIds(left)) === JSON.stringify(sortedIds(right))

const taskHasContent = task => Boolean(task && (
  task.historyId || task.customerId || task.serviceId ||
  ['client', 'service', 'address', 'phone', 'detail', 'internalNote'].some(key => text(task[key])) ||
  (task.internalChecklist || []).some(item => text(item?.text))
))

const sameReference = (task, record, idKey, nameKey) => {
  const taskId = text(task?.[idKey]), recordId = text(record?.[idKey])
  return taskId && recordId ? taskId === recordId : text(task?.[nameKey]) === text(record?.[nameKey])
}

const taskMatchesRecord = (task, team, teamIndex, record, date) => {
  if (text(record?.date) !== text(date)) return false
  const identityMatches = task.historyId
    ? text(record.id) === text(task.historyId)
    : task.taskId
      ? text(record.sourceTaskId) === text(task.taskId) || text(record.id) === `work-${text(task.taskId)}`
      : text(record.team) === `Equipo ${teamIndex + 1}` && text(record.time || record.scheduledTime) === text(task.time) && text(record.client) === text(task.client)
  if (!identityMatches) return false
  const teamMatches = team.teamId && record.teamId ? text(team.teamId) === text(record.teamId) : text(record.team) === `Equipo ${teamIndex + 1}`
  return teamMatches &&
    sameIds(team.memberIds, record.technicianIds) &&
    text(record.time || record.scheduledTime) === text(task.time) &&
    sameReference(task, record, 'serviceId', 'service') &&
    sameReference(task, record, 'customerId', 'client') &&
    ['address', 'phone', 'detail', 'internalNote', 'paymentMethod', 'amount', 'monthlyFee', 'form'].every(key => text(task[key]) === text(record[key]))
}

export function agendaHasUnsavedServices({ teams = [], history = [], date = '' } = {}) {
  return teams.some((team, teamIndex) => (team.tasks || []).some(task =>
    taskHasContent(task) && !history.some(record => taskMatchesRecord(task, team, teamIndex, record, date))
  ))
}
