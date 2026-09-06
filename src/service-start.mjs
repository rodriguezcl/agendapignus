import { SCHEDULE_TIME_ZONE, timeInMinutes } from './service-scheduling.mjs'
import { vehicleControlIsOpen } from './vehicle-control-window.mjs'

export function serviceHasStarted(record, now = new Date()) {
  if (record?.vehicleControl) return vehicleControlIsOpen(record, now)
  const current = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(current.getTime())) return false
  const today = current.toLocaleDateString('sv-SE', { timeZone: SCHEDULE_TIME_ZONE })
  const date = String(record?.date || '')
  if (date < today) return true
  if (date > today) return false
  const scheduled = timeInMinutes(record?.time || record?.scheduledTime)
  if (scheduled === null) return true
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(current).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return scheduled <= Number(parts.hour) * 60 + Number(parts.minute)
}
