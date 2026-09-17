import { taskOccupiedInterval, minutesAsTime } from './service-scheduling.mjs'

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
  const occupied = tasks.map((task, index) => ({ task, index, interval: taskOccupiedInterval(task) }))
    .filter(({ task, interval }) => interval && (task.serviceId || task.service || task.client || task.vehicleControl))
    .sort((a, b) => a.interval.start - b.interval.start)
  const gaps = []
  let end = null
  for (const { index, interval } of occupied) {
    const start = Math.max(end ?? lower, lower), stop = Math.min(interval.start, upper)
    if (end !== null && stop - start >= 90) gaps.push({ beforeIndex: index, start: minutesAsTime(start), end: minutesAsTime(stop) })
    end = Math.max(end ?? 0, interval.end)
  }
  return gaps
}
