import { planningHoursForDay } from './service-gaps.mjs'
import { minutesAsTime, timeInMinutes, taskOccupiedInterval } from './service-scheduling.mjs'

export function rescheduleSlots(day, record, teams, availableTeams, now = new Date()) {
  const rows = teams.map(team => ({ ...team, slots: [] }))
  const hours = planningHoursForDay(day)
  if (!hours || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return rows
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  if (day < today) return rows
  const lower = Math.max(timeInMinutes(hours.min), day === today ? Math.ceil((Number(parts.hour) * 60 + Number(parts.minute) + (Number(parts.second) > 0 ? 1 : 0)) / 15) * 15 : 0)
  const upper = new Date(`${day}T12:00:00`).getDay() === 5 ? 16 * 60 : timeInMinutes(hours.max)
  for (let start = lower; start < upper; start += 15) {
    const time = minutesAsTime(start)
    // Calculate the future pending visit, not the released original request.
    const interval = taskOccupiedInterval({ ...record, date: day, time, scheduledTime: time, status: 'Pendiente', technicalStatus: '', technicianRequest: '', completedAt: '', technicalReportedAt: '', journeyClosedAt: '' })
    if (!interval || interval.end > upper || (start < 14 * 60 && interval.end > 13 * 60 + 30)) continue
    const available = new Set(availableTeams(day, time, record).map(team => String(team.teamId)))
    for (const row of rows) if (available.has(String(row.teamId))) row.slots.push({ time, end: minutesAsTime(interval.serviceEnd) })
  }
  return rows
}
