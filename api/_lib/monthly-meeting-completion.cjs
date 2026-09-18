const { synchronizeAgendaHistoryRecord } = require('./history-record-operation.cjs')

function completeExpiredMonthlyMeetings(state, now = new Date()) {
  const instant = new Date(now).getTime()
  const changes = []
  let agenda = state.agenda
  const history = (state.history || []).map(record => {
    const name = String(record.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
    if (name !== 'reunion mensual' || record.vehicleControl || !['Pendiente', 'En proceso', 'Iniciado'].includes(record.status || 'Pendiente') || record.completedAt || record.technicalStatus || record.technicianRequest || record.scheduledDate) return record
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) return record
    const weekday = new Date(`${record.date}T12:00:00Z`).getUTCDay()
    const hour = weekday === 5 ? '20' : weekday === 6 ? '12' : '17'
    const end = new Date(`${record.date}T${hour}:00:00-03:00`)
    if (!Number.isFinite(end.getTime()) || !Number.isFinite(instant) || instant < end.getTime()) return record
    const next = { ...record, status: 'Completado', completedAt: end.toISOString(), autoCompletedAt: new Date(now).toISOString(), autoCompletionReason: 'monthly-meeting-day-end' }
    changes.push({ previous: record, next })
    agenda = synchronizeAgendaHistoryRecord(agenda, record, next)
    return next
  })
  return { state: changes.length ? { ...state, history, agenda } : state, changes }
}
module.exports = { completeExpiredMonthlyMeetings }
