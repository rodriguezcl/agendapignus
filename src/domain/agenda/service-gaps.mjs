import { taskOccupiedInterval, minutesAsTime, serviceSlotReleased } from './service-scheduling.mjs'
import workday from '../../../api/_lib/workday.cjs'

export function planningHoursForDay(day, weekly = {}, teamId = '') {
  const row = workday.workdayForDate(day, weekly, teamId)
  if (!row) return null
  return { min: row.start, max: row.end, bookable: row.bookable, breakStart: row.breakStart, breakEnd: row.breakEnd, label: `${row.start} a ${row.end}` }
}

// Empty placeholders do not reserve working time. Include the final stretch when closing hours are known.
export function serviceGaps(tasks, { min, max, bookable, breakStart = '13:00', breakEnd = '14:00', fullAvailability = false, day, now = new Date(), blockedIntervals = [] } = {}) {
  const minutes = value => /^\d{2}:\d{2}$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null
  let lower = minutes(fullAvailability ? bookable || min : min) ?? 0
  const lunchStart = minutes(breakStart), lunchEnd = minutes(breakEnd)
  const minimumGap = fullAvailability ? 60 : 90
  // Friday 16:00–20:00 is reserved for advancing Saturday guard duty,
  // not general availability. Keep planningHoursForDay unchanged for that workflow.
  const friday = day && new Date(`${day}T12:00:00`).getDay() === 5
  const upper = Math.min(minutes(max) ?? 1440, friday ? 16 * 60 : 1440)
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
  const occupied = tasks.map((task, index) => ({ task, index, interval: taskOccupiedInterval(task, { breakStart, breakEnd }) }))
    .filter(({ task, interval }) => interval && hasService(task))
    .concat(blockedIntervals.filter(Boolean).map(interval => ({ index: tasks.length, interval })))
    .sort((a, b) => a.interval.start - b.interval.start)
  const gaps = []
  // A cancelled first/only visit still provides an anchor for the released slot.
  const releasedStarts = cards.filter(({ task }) => hasService(task) && serviceSlotReleased(task, day)).map(card => card.start)
  const firstReleased = releasedStarts.length ? Math.min(...releasedStarts) : null
  let end = fullAvailability ? lower : firstReleased !== null && (!occupied.length || firstReleased <= occupied[0].interval.start) ? firstReleased : null
  for (const { index, interval } of occupied) {
    const start = Math.max(end ?? lower, lower), stop = Math.min(interval.start, upper)
    // Lunch is not bookable: require 90 continuous minutes on either side,
    // rather than adding together time separated by the 13:00–14:00 break.
    if (end !== null) {
      const available = [[start, Math.min(stop, lunchStart)], [Math.max(start, lunchEnd), stop]]
      for (const [from, to] of available) {
        if (to - from < minimumGap) continue
        // An empty card at the start already offers this available slot.
        if (!fullAvailability && cards.some(card => card.start === from && !hasService(card.task))) continue
        // Empty cards are also chronological anchors, not occupied intervals.
        const nextCard = cards.find(card => card.start >= from)
        gaps.push({ beforeIndex: nextCard?.index ?? index, start: minutesAsTime(from), end: minutesAsTime(to) })
      }
    }
    end = Math.max(end ?? 0, interval.end)
  }
  if (end !== null && minutes(max) !== null) {
    const start = Math.max(end, lower)
    for (const [from, to] of [[start, Math.min(upper, lunchStart)], [Math.max(start, lunchEnd), upper]]) {
      if (to - from < minimumGap || !fullAvailability && cards.some(card => card.start === from && !hasService(card.task))) continue
      const nextCard = cards.find(card => card.start >= from)
      gaps.push({ beforeIndex: nextCard?.index ?? tasks.length, start: minutesAsTime(from), end: minutesAsTime(to) })
    }
  }
  return gaps
}

// Only this day's teams are supplied. External services block time without
// becoming cards (or changing the local beforeIndex anchors).
export function teamServiceGaps(teams, teamIndex, options = {}, hoursForTeam = () => options) {
  const team = teams[teamIndex]
  if (!team) return []
  const members = new Set((team.memberIds || []).map(String))
  const blockedIntervals = teams.flatMap((other, index) => {
    if (index === teamIndex) return []
    return (other.tasks || []).flatMap(task => {
      const assigned = task.vehicleControl && task.technicianIds?.length ? task.technicianIds : other.memberIds || []
      if (!assigned.some(id => members.has(String(id))) || !(task.serviceId || task.service || task.client || task.vehicleControl)) return []
      const interval = taskOccupiedInterval(task, hoursForTeam(other) || {})
      return interval ? [interval] : []
    })
  })
  return serviceGaps(team.tasks || [], { ...options, blockedIntervals })
}
