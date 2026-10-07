export const canReorderService = task => Boolean(task?.taskId && task?.historyId && !task.vehicleControl && !task.startedAt && !task.completedAt && !task.technicalStatus && (!task.status || task.status === 'Pendiente'))

// Both changes are built against the latest snapshot and persisted together.
export function reorderServices(state, { day, teamId, changes, baseline, validate, stamp = value => value }) {
  const next = structuredClone(state)
  const team = next.agenda?.weekly?.[day]?.teams?.find(item => String(item.teamId) === String(teamId))
  if (!team || changes.length !== 2 || new Set(changes.map(item => item.taskId)).size !== 2) throw new Error('Seleccioná dos servicios guardados del mismo equipo.')
  for (const change of changes) {
    const task = team.tasks.find(item => item.taskId === change.taskId)
    const record = next.history.find(item => item.id === task?.historyId)
    const original = baseline.find(item => item.taskId === change.taskId)
    if (!canReorderService(task) || !record || !canReorderService({ ...task, ...record, taskId: task.taskId, historyId: task.historyId })) throw new Error('Solo se pueden reordenar servicios pendientes y no iniciados.')
    if (!original || task.time !== original.time || String(task.estimatedMinutes || '') !== String(original.estimatedMinutes || '')) throw new Error('El servicio cambió en otra sesión. Cerrá y volvé a abrir para revisar sus horarios.')
    Object.assign(task, stamp({ ...task, time: change.time, scheduledTime: change.time }))
    Object.assign(record, stamp({ ...record, time: change.time, scheduledTime: change.time }))
    if (next.agenda.date === day) for (const dailyTeam of next.agenda.teams || []) {
      const dailyTask = dailyTeam.tasks?.find(item => item.taskId === task.taskId || item.historyId === task.historyId)
      if (dailyTask) Object.assign(dailyTask, { time: change.time, scheduledTime: change.time })
    }
  }
  validate(team, next.history)
  team.tasks.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
  if (next.agenda.date === day) for (const item of next.agenda.teams || []) item.tasks?.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
  return next
}
