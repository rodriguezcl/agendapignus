// Recorded work keeps its original crew even when staffing changes later.
function preserveServiceAssignment(record) {
  return Boolean(record && (
    ['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(record.status) ||
    ['startedAt', 'completedAt', 'technicalStatus', 'technicalObservation', 'technicalReport', 'technicalReportedAt', 'journeyClosedAt', 'technicianRequest'].some(key => record[key]) ||
    record.workCompletion || record.alarmZones || record.categoryCorrections?.length || record.administrativeCorrections?.length
  ))
}

function serviceAssignmentProtection(state = {}) {
  const recordIds = new Set(), taskIds = new Set()
  const add = (set, values) => values.filter(value => value != null && value !== '').forEach(value => set.add(String(value)))
  const matches = (set, values) => values.some(value => value != null && value !== '' && set.has(String(value)))
  const rememberRecord = record => { add(recordIds, [record.id]); add(taskIds, [record.sourceTaskId, record.taskId]) }
  const rememberTask = task => { add(recordIds, [task.historyId, task.sourceHistoryId]); add(taskIds, [task.taskId, task.sourceTaskId]) }
  for (const record of state.history || []) if (preserveServiceAssignment(record)) rememberRecord(record)
  const teams = [...(state.agenda?.teams || []), ...Object.entries(state.agenda?.weekly || {}).filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day)).flatMap(([, plan]) => plan?.teams || [])]
  for (const team of teams) for (const task of team.tasks || []) if (preserveServiceAssignment(task)) rememberTask(task)
  const record = value => preserveServiceAssignment(value) || matches(recordIds, [value?.id]) || matches(taskIds, [value?.sourceTaskId, value?.taskId])
  // Link aliases so a report in either agenda copy also protects the canonical
  // history row and the other copy, even while one lacks the report fields.
  for (const value of state.history || []) if (record(value)) rememberRecord(value)
  const task = value => preserveServiceAssignment(value) || matches(recordIds, [value?.historyId, value?.sourceHistoryId]) || matches(taskIds, [value?.taskId, value?.sourceTaskId])
  return { record, task }
}

module.exports = { preserveServiceAssignment, serviceAssignmentProtection }
