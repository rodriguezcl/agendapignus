import { vehicleControlFriday } from '../../../domain/vehicles/vehicle-controls.mjs'

export function sameGeneratedVehicleControl(item, record, day = '') {
  if (!item?.vehicleControl || !record?.vehicleControl) return false
  const aliases = [item.id, item.historyId, item.taskId, item.sourceTaskId].filter(Boolean).map(String)
  if ([record.id, record.historyId, record.taskId, record.sourceTaskId].filter(Boolean).some(id => aliases.includes(String(id)))) return true
  return item.vehicleId != null && String(item.vehicleId) === String(record.vehicleId)
    && vehicleControlFriday({ ...item, date: item.date || day }) === vehicleControlFriday(record)
}

const protectedControl = (record, fromDate, day = '') => (record.date || day) < fromDate
  || Boolean(record.startedAt || record.completedAt || record.technicalStatus || record.technicalReportedAt)
  || Boolean(record.status && record.status !== 'Pendiente')

// Generation may refresh a pending future control, never erase an old control
// or overwrite a report. Inspect both projections because older tasks can hold
// progress that has not yet been copied into their history row.
export function prepareVehicleControlGeneration(snapshot, generated, fromDate) {
  const history = snapshot.history || []
  const plans = [...Object.entries(snapshot.agenda?.weekly || {}).filter(([day]) => !day.startsWith('_'))]
  if (snapshot.agenda?.date) plans.push([snapshot.agenda.date, snapshot.agenda])
  const records = generated.flatMap(candidate => {
    const existing = history.filter(record => sameGeneratedVehicleControl(record, candidate))
    if (protectedControl(candidate, fromDate) || existing.some(record => protectedControl(record, fromDate))) return []
    if (plans.some(([day, plan]) => (plan.teams || []).some(team => (team.tasks || []).some(task =>
      sameGeneratedVehicleControl(task, candidate, day) && protectedControl(task, fromDate, day))))) return []
    const original = existing[0]
    return [{
      ...original, ...candidate,
      id: original?.id || candidate.id,
      sourceTaskId: original?.sourceTaskId || original?.id || candidate.sourceTaskId
    }]
  })
  const updates = new Map(records.map(record => [String(record.id), record]))
  const existingIds = new Set(history.map(record => String(record.id)))
  return {
    records,
    history: [...history.map(record => updates.get(String(record.id)) || record), ...records.filter(record => !existingIds.has(String(record.id)))]
  }
}
