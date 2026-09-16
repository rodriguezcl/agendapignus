import { taskOccupiedInterval, minutesAsTime } from './service-scheduling.mjs'

// Only internal gaps: empty placeholders do not reserve working time.
export function serviceGaps(tasks, { min, max } = {}) {
  const minutes = value => /^\d{2}:\d{2}$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null
  const lower = minutes(min) ?? 0, upper = minutes(max) ?? 1440
  const occupied = tasks.map((task, index) => ({ task, index, interval: taskOccupiedInterval(task) }))
    .filter(({ task, interval }) => interval && (task.serviceId || task.service || task.client || task.vehicleControl))
    .sort((a, b) => a.interval.start - b.interval.start)
  const gaps = []
  let end = null
  for (const { index, interval } of occupied) {
    const start = Math.max(end ?? lower, lower), stop = Math.min(interval.start, upper)
    if (end !== null && stop - start >= 60) gaps.push({ beforeIndex: index, start: minutesAsTime(start), end: minutesAsTime(stop) })
    end = Math.max(end ?? 0, interval.end)
  }
  return gaps
}
