const DEFAULT_CONTROL_TIME = '15:30'
const ARGENTINA_OFFSET = '-03:00'

export function vehicleControlScheduledAt(record) {
  const date = String(record?.date || '')
  const time = String(record?.time || record?.scheduledTime || DEFAULT_CONTROL_TIME).slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const scheduled = new Date(`${date}T${time}:00${ARGENTINA_OFFSET}`)
  return Number.isNaN(scheduled.getTime()) ? null : scheduled
}

export function vehicleControlIsOpen(record, now = Date.now()) {
  if (!record?.vehicleControl) return true
  const scheduled = vehicleControlScheduledAt(record)
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return Boolean(scheduled && Number.isFinite(current) && current >= scheduled.getTime())
}

export function vehicleControlWindowLabel(record) {
  const scheduled = vehicleControlScheduledAt(record)
  if (!scheduled) return 'la fecha y hora programadas'
  const date = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(scheduled)
  const time = String(record?.time || record?.scheduledTime || DEFAULT_CONTROL_TIME).slice(0, 5)
  return `${date} a las ${time} Hs`
}
