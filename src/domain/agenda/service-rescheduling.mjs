// Keep each visit as evidence before opening the next scheduled visit.
export function rescheduledServiceFields(previous, now = new Date().toISOString()) {
  const fields = ['date', 'time', 'scheduledTime', 'teamId', 'team', 'technicianIds', 'technicians', 'status', 'startedAt', 'startedById', 'startedByName', 'technicalStatus', 'technicianRequest', 'technicalObservation', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'completedAt']
  const visit = Object.fromEntries(fields.filter(key => previous[key] !== undefined).map(key => [key, structuredClone(previous[key])]))
  return {
    status: 'Pendiente', scheduledDate: '', technicianRequest: '', technicalStatus: '',
    technicalObservation: '', technicalReportedAt: '', technicalReportedById: '', technicalReportedByName: '',
    startedAt: '', startedById: '', startedByName: '', completedAt: '',
    rescheduledFrom: previous.date, reprogrammedAt: now,
    reschedulingHistory: [...(previous.reschedulingHistory || []), { ...visit, reprogrammedAt: now }]
  }
}

// Only repair an unfinished visit whose start demonstrably predates its move.
// Never infer a pause for a completed job or a legitimate start at destination.
export function repairMovedServiceStart(record) {
  const start = Date.parse(record?.startedAt), moved = Date.parse(record?.reprogrammedAt)
  if (!record || record.vehicleControl || record.status !== 'Pendiente' || record.technicalStatus || record.completedAt ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.rescheduledFrom || '') || record.rescheduledFrom === record.date ||
      !Number.isFinite(start) || !Number.isFinite(moved) || start >= moved) return record
  const startDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(start))
  if (startDay !== record.rescheduledFrom || startDay >= record.date) return record
  const fields = rescheduledServiceFields({ ...record, date: record.rescheduledFrom }, record.reprogrammedAt)
  // The old scheduled time/team are unknown after the move; don't invent them.
  const visit = fields.reschedulingHistory.at(-1)
  for (const key of ['time', 'scheduledTime', 'teamId', 'team', 'technicianIds', 'technicians']) delete visit[key]
  return { ...record, ...fields }
}

export function repairMovedServiceState(state, id) {
  const previous = state.history?.find(record => String(record.id) === String(id))
  const record = repairMovedServiceStart(previous)
  if (!previous || record === previous) return state
  const fields = Object.fromEntries(Object.keys(record).filter(key => JSON.stringify(record[key]) !== JSON.stringify(previous[key])).map(key => [key, record[key]]))
  const repairTeams = teams => (teams || []).map(team => ({ ...team, tasks: (team.tasks || []).map(task =>
    String(task.historyId || '') === String(id) || (previous.sourceTaskId && String(task.taskId) === String(previous.sourceTaskId)) ? { ...task, ...fields } : task) }))
  const agenda = { ...state.agenda, weekly: { ...state.agenda?.weekly } }
  if (agenda.date === record.date) agenda.teams = repairTeams(agenda.teams)
  if (agenda.weekly[record.date]) agenda.weekly[record.date] = { ...agenda.weekly[record.date], teams: repairTeams(agenda.weekly[record.date].teams) }
  return { ...state, history: state.history.map(item => item === previous ? record : item), agenda }
}
