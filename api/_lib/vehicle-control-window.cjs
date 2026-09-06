const DEFAULT_CONTROL_TIME = '15:30'
const ARGENTINA_OFFSET = '-03:00'
const CONTROL_TIME_ZONE = 'America/Argentina/Buenos_Aires'

const recordIsResolved = record => Boolean(record?.technicalStatus || ['Completado', 'Cancelado', 'Reprogramado'].includes(record?.status))

function argentinaDate(now) {
  const current = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(current.getTime())) return ''
  return current.toLocaleDateString('sv-SE', { timeZone: CONTROL_TIME_ZONE })
}

function vehicleControlDayAgendaCompleted(record, records = []) {
  if (!record?.vehicleControl) return false
  const date = String(record.date || '')
  const ordinaryServices = (records || []).filter(item => !item?.vehicleControl && String(item?.date || '') === date)
  return ordinaryServices.every(recordIsResolved)
}

function vehicleControlScheduledAt(record) {
  const date = String(record?.date || '')
  const time = String(record?.time || record?.scheduledTime || DEFAULT_CONTROL_TIME).slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const scheduled = new Date(`${date}T${time}:00${ARGENTINA_OFFSET}`)
  return Number.isNaN(scheduled.getTime()) ? null : scheduled
}

function vehicleControlIsOpen(record, now = Date.now(), assignedRecords = null) {
  if (!record?.vehicleControl) return true
  const scheduled = vehicleControlScheduledAt(record)
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!scheduled || !Number.isFinite(current)) return false
  if (current >= scheduled.getTime()) return true
  return Array.isArray(assignedRecords) && argentinaDate(now) === String(record.date || '') && vehicleControlDayAgendaCompleted(record, assignedRecords)
}

function vehicleControlWindowLabel(record) {
  const scheduled = vehicleControlScheduledAt(record)
  if (!scheduled) return 'la fecha y hora programadas'
  const date = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(scheduled)
  const time = String(record?.time || record?.scheduledTime || DEFAULT_CONTROL_TIME).slice(0, 5)
  return `${date} a las ${time} Hs, o antes si ya finalizaste los demás servicios del día`
}

module.exports = { vehicleControlDayAgendaCompleted, vehicleControlIsOpen, vehicleControlScheduledAt, vehicleControlWindowLabel }
