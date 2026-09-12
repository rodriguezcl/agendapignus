const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'

const argentinaDateTime = now => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: ARGENTINA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23'
}).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))

const addCalendarDays = (dateKey, days) => {
  const value = new Date(`${dateKey}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function defaultWeeklyAnchor(now = new Date()) {
  const parts = argentinaDateTime(now)
  const today = `${parts.year}-${parts.month}-${parts.day}`
  if (parts.weekday === 'Sun') return addCalendarDays(today, 1)
  if (parts.weekday === 'Sat' && Number(parts.hour) >= 12) return addCalendarDays(today, 2)
  return today
}
