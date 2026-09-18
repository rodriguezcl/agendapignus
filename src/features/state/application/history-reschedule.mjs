import { weeklyServiceOperations } from './weekly-service-save.mjs'
import { requiresDifferentRescheduleDay } from '../../../domain/history/history-edit-policy.mjs'
import { serviceRecordFingerprint } from '../../../domain/history/service-concurrency.mjs'

export function historyRescheduleOperations(snapshot, { base, day, time, team, today, now = new Date().toISOString() }) {
  if (day === base.date && requiresDifferentRescheduleDay(base)) throw new Error('La reprogramación pendiente requiere una fecha distinta del día original.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today || new Date(`${day}T12:00:00Z`).getUTCDay() === 0) throw new Error('Elegí una fecha habilitada, desde hoy en adelante.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Indicá un horario válido.')
  if (!team?.teamId || !team.memberIds?.length) throw new Error('Seleccioná un equipo con técnicos asignados.')
  const current = snapshot.history?.find(item => String(item.id) === String(base.id))
  if (!current || serviceRecordFingerprint(current) !== serviceRecordFingerprint(base)) throw new Error('El servicio cambió. Actualizá el Historial antes de reprogramar.')
  const sourceTeams = snapshot.agenda?.weekly?.[base.date]?.teams || []
  const source = sourceTeams.find(item => item.tasks?.some(task => String(task.historyId || '') === String(base.id) || (base.sourceTaskId && String(task.taskId) === String(base.sourceTaskId))))
  const baseTask = source?.tasks.find(task => String(task.historyId || '') === String(base.id) || (base.sourceTaskId && String(task.taskId) === String(base.sourceTaskId)))
  const reset = { status: 'Pendiente', scheduledDate: '', technicianRequest: '', technicalStatus: '', technicalObservation: '', technicalReportedAt: '', technicalReportedById: '', technicalReportedByName: '', startedAt: '', startedById: '', startedByName: '', completedAt: '' }
  const record = {
    ...current, ...reset, date: day, time, scheduledTime: time,
    teamId: team.teamId, team: team.label, technicianIds: [...team.memberIds], technicians: [...team.members],
    rescheduledFrom: base.date, reprogrammedAt: now,
    reschedulingHistory: [...(current.reschedulingHistory || []), { date: current.date, time: current.time, team: current.team, technicianIds: current.technicianIds, technicalStatus: current.technicalStatus, technicalObservation: current.technicalObservation, technicalReportedAt: current.technicalReportedAt, technicalReportedByName: current.technicalReportedByName, reprogrammedAt: now }]
  }
  const task = { ...baseTask, ...record, taskId: baseTask?.taskId || current.sourceTaskId || current.id, historyId: current.id }
  record.sourceTaskId = task.taskId
  return weeklyServiceOperations(snapshot, { day, team, task, record, baseRecord: current, baseTask, sourceDay: current.date, sourceTeamId: source?.teamId || '' })
}
