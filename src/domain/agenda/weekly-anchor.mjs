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

// A rolling window, independent of calendar-week and month boundaries.
export function weeklyVisibleDays(anchor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor || '')) return []
  const date = new Date(`${anchor}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) return []
  const days = []
  while (days.length < 5) {
    if (date.getUTCDay() !== 0) days.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return days
}

export function shiftWeeklyAnchor(anchor, direction) {
  const first = weeklyVisibleDays(anchor)[0]
  if (!first) return anchor
  const step = direction < 0 ? -1 : 1
  let next = addCalendarDays(first, step)
  if (new Date(`${next}T12:00:00Z`).getUTCDay() === 0) next = addCalendarDays(next, step)
  return next
}

export function defaultWeeklyAnchor(now = new Date()) {
  const parts = argentinaDateTime(now)
  const today = `${parts.year}-${parts.month}-${parts.day}`
  if (parts.weekday === 'Sun') return addCalendarDays(today, 1)
  if (parts.weekday === 'Sat' && Number(parts.hour) >= 12) return addCalendarDays(today, 2)
  return today
}
