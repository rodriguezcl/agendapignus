import { taskOccupiedInterval, minutesAsTime } from './service-scheduling.mjs'

export function planningHoursForDay(day) {
  const weekDay = new Date(`${day}T12:00:00`).getDay()
  if (!Number.isInteger(weekDay) || weekDay === 0) return null
  const max = weekDay === 5 ? '20:00' : weekDay === 6 ? '12:00' : '17:00'
  return { min: '08:00', max, label: `08:00 a ${max}` }
}

// Only internal gaps: empty placeholders do not reserve working time.
export function serviceGaps(tasks, { min, max, day, now = new Date() } = {}) {
  const minutes = value => /^\d{2}:\d{2}$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null
  let lower = minutes(min) ?? 0
  const upper = minutes(max) ?? 1440
  if (day) {
    const instant = new Date(now)
    if (Number.isNaN(instant.getTime())) return []
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant).map(part => [part.type, part.value]))
    const today = `${parts.year}-${parts.month}-${parts.day}`
    if (day < today) return []
    if (day === today) {
      const elapsed = Number(parts.hour) * 60 + Number(parts.minute) + (Number(parts.second) > 0 || instant.getMilliseconds() > 0 ? 1 : 0)
      lower = Math.max(lower, Math.ceil(elapsed / 15) * 15)
    }
  }
  const hasService = task => Boolean(task.serviceId || task.service || task.client || task.vehicleControl)
  const cards = tasks.map((task, index) => ({ task, index, start: minutes(task.time || task.scheduledTime) }))
    .filter(card => card.start !== null).sort((a, b) => a.start - b.start)
  const occupied = tasks.map((task, index) => ({ task, index, interval: taskOccupiedInterval(task) }))
    .filter(({ task, interval }) => interval && hasService(task))
    .sort((a, b) => a.interval.start - b.interval.start)
  const gaps = []
  let end = null
  for (const { index, interval } of occupied) {
    const start = Math.max(end ?? lower, lower), stop = Math.min(interval.start, upper)
    // Lunch is not bookable: require 90 continuous minutes on either side,
    // rather than adding together time separated by the 13:30–14:00 break.
    if (end !== null) {
      const available = [[start, Math.min(stop, 13 * 60 + 30)], [Math.max(start, 14 * 60), stop]]
      for (const [from, to] of available) {
        if (to - from < 90) continue
        // An empty card at the start already offers this available slot.
        if (cards.some(card => card.start === from && !hasService(card.task))) continue
        // Empty cards are also chronological anchors, not occupied intervals.
        const nextCard = cards.find(card => card.start >= from)
        gaps.push({ beforeIndex: nextCard?.index ?? index, start: minutesAsTime(from), end: minutesAsTime(to) })
      }
    }
    end = Math.max(end ?? 0, interval.end)
  }
  return gaps
}
