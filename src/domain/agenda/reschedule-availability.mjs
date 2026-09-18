import { taskOccupiedInterval, allowedMeetingControlOverlap } from './service-scheduling.mjs'

export const completeRescheduleSlot = (day, time) => /^\d{4}-\d{2}-\d{2}$/.test(day || '') && /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')

// Pure filtering: never modifies the draft, teams or their tasks.
export function availableRescheduleTeams(teams, record, day, time) {
  if (!completeRescheduleSlot(day, time)) return []
  const interval = taskOccupiedInterval({ ...record, date: day, time, scheduledTime: time, status: 'Pendiente', technicalStatus: '', completedAt: '', technicalReportedAt: '' })
  const sameService = task => (record.id && String(task.historyId || task.id || '') === String(record.id)) || (record.sourceTaskId && String(task.taskId || task.sourceTaskId || '') === String(record.sourceTaskId))
  return teams.filter(team => !teams.some(other => {
    const shared = String(team.teamId) === String(other.teamId) || (other.memberIds || []).some(id => (team.memberIds || []).some(member => String(member) === String(id)))
    if (!shared) return false
    return (other.tasks || []).some(task => {
      if (sameService(task) || allowedMeetingControlOverlap(record, task) || !(task.serviceId || task.service || task.client || task.customerId)) return false
      const occupied = taskOccupiedInterval(task)
      return occupied && interval.start < occupied.end && occupied.start < interval.end
    })
  }))
}
