import { stateOperations } from './state-operations.mjs'
import { serviceRecordFingerprint } from '../../../domain/history/service-concurrency.mjs'
import { planningHoursForDay } from '../../../domain/agenda/service-gaps.mjs'
import { timeInMinutes, validServiceEstimatedMinutes } from '../../../domain/agenda/service-scheduling.mjs'
import { serviceHasChanges } from '../../../domain/agenda/service-changes.mjs'

export function planServiceJourneyOperations(snapshot, { base, visits, today, teamsForDate, createId }) {
  const record = snapshot.history.find(item => String(item.id) === String(base.id))
  if (!record || serviceRecordFingerprint(record) !== serviceRecordFingerprint(base)) throw new Error('El servicio cambió. Volvé a abrir la planificación.')
  const originalTask = snapshot.agenda?.weekly?.[record.date]?.teams?.flatMap(team => team.tasks || []).find(task => String(task.historyId) === String(record.id))
  const dailyTask = snapshot.agenda?.date === record.date ? snapshot.agenda.teams?.flatMap(team => team.tasks || []).find(task => String(task.historyId) === String(record.id)) : null
  if ([originalTask, dailyTask].some(task => task && serviceHasChanges(task, record))) throw new Error('Guardá los cambios del servicio antes de planificar sus jornadas.')
  if (record.serviceJourney || record.startedAt || record.technicalStatus || record.status !== 'Pendiente' || record.vehicleControl) throw new Error('Solo se pueden planificar varias jornadas antes de iniciar el servicio.')
  if (!Array.isArray(visits) || visits.length < 2 || visits.length > 20) throw new Error('Agregá entre 2 y 20 jornadas.')
  if (visits[0].date !== record.date || visits[0].time !== record.time || String(visits[0].teamId) !== String(record.teamId)) throw new Error('La primera jornada debe conservar la fecha, hora y equipo del servicio original.')
  const next = structuredClone(snapshot)
  const groupId = record.id
  for (const [index, visit] of visits.entries()) {
    const hours = planningHoursForDay(visit.date), start = timeInMinutes(visit.time)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visit.date) || visit.date < today || !hours || start === null || !validServiceEstimatedMinutes(visit.estimatedMinutes) || start < timeInMinutes(hours.min) || start + Number(visit.estimatedMinutes) > timeInMinutes(hours.max)) throw new Error(`Jornada ${index + 1}: revisá fecha, horario y duración dentro de la jornada laboral.`)
    if (index && visit.date <= visits[index - 1].date) throw new Error('Las fechas de las jornadas deben ser consecutivas en orden, aunque puedan tener días libres entre ellas.')
    const choices = teamsForDate(visit.date, snapshot.agenda?.weekly)
    const team = choices.find(item => String(item.teamId) === String(visit.teamId))
    if (!team?.memberIds?.length) throw new Error(`Jornada ${index + 1}: el equipo ya no está disponible.`)
    const taskId = index ? createId() : record.sourceTaskId
    if (!taskId) throw new Error('El servicio original no tiene una tarjeta identificada.')
    const id = index ? `work-${taskId}` : record.id
    const serviceJourney = { id: groupId, index: index + 1, total: visits.length }
    const child = { ...record, id, sourceTaskId: taskId, date: visit.date, time: visit.time, scheduledTime: visit.time, estimatedMinutes: Number(visit.estimatedMinutes), estimatedMinutesCustomized: true, teamId: team.teamId, team: team.label, technicianIds: [...team.memberIds], technicians: [...team.members], serviceJourney }
    if (index) {
      for (const key of ['completedAt', 'startedAt', 'technicalStatus', 'technicalObservation', 'technicalReportedAt', 'technicalReportedById', 'technicalReportedByName', 'servicePhotoUrl', 'servicePhotoAttachedAt']) delete child[key]
      child.servicePhotoAttached = false
    }
    if (!index) next.history = next.history.map(item => String(item.id) === String(id) ? child : item)
    else next.history.push(child)
    next.agenda ||= {}; next.agenda.weekly ||= {}
    const plan = next.agenda.weekly[visit.date] ||= { teams: structuredClone(choices) }
    const insert = teams => {
      let destination = teams.find(item => String(item.teamId) === String(team.teamId))
      if (!destination) { destination = { ...structuredClone(team), tasks: [] }; teams.push(destination) }
      const task = { ...child, taskId, historyId: id }
      destination.tasks = [...(destination.tasks || []).filter(item => String(item.taskId) !== String(taskId)), task].sort((a,b) => String(a.time).localeCompare(String(b.time)))
    }
    insert(plan.teams)
    if (next.agenda.date === visit.date) insert(next.agenda.teams)
  }
  const operations = stateOperations(snapshot, next)
  // A concurrent change of crew must not leave the new records with old members.
  for (const visit of visits) {
    const team = snapshot.agenda?.weekly?.[visit.date]?.teams?.find(item => String(item.teamId) === String(visit.teamId))
    if (team) for (const key of ['memberIds', 'members']) {
      const existed = Object.hasOwn(team, key)
      operations.unshift({ path: ['agenda', 'weekly', visit.date, 'teams', { key: 'teamId', id: String(team.teamId) }, key], before: team[key] ?? null, after: team[key] ?? null, existed, exists: existed })
    }
  }
  for (const key of Object.keys(snapshot.agenda?.weekly || {}).filter(key => key.startsWith('_'))) {
    const value = snapshot.agenda.weekly[key]
    operations.unshift({ path: ['agenda', 'weekly', key], before: value, after: value, existed: true, exists: true })
  }
  return operations
}
