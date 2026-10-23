import { planningHoursForDay } from './service-gaps.mjs'
import { minutesAsTime, timeInMinutes, taskOccupiedInterval } from './service-scheduling.mjs'
import { teamHasAdvancedFridayGuard } from './weekend-guard.mjs'

export function rescheduleSlots(day, record, teams, availableTeams, now = new Date(), weekly = null) {
  const rows = teams.map(team => ({ ...team, slots: [] }))
  const hours = planningHoursForDay(day)
  if (!hours || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return rows
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  if (day < today) return rows
  const lower = Math.max(weekly ? 0 : timeInMinutes(hours.min), day === today ? Math.ceil((Number(parts.hour) * 60 + Number(parts.minute) + (Number(parts.second) > 0 ? 1 : 0)) / 15) * 15 : 0)
  const friday = new Date(`${day}T12:00:00`).getDay() === 5
  const upper = friday ? 20 * 60 : weekly ? 1440 : timeInMinutes(hours.max)
  const closingByTeam = new Map(rows.map(team => [String(team.teamId), friday && !teamHasAdvancedFridayGuard(teams, team) ? 16 * 60 : upper]))
  for (let start = lower; start < upper; start += 15) {
    const time = minutesAsTime(start)
    const available = new Set(availableTeams(day, time, record).map(team => String(team.teamId)))
    for (const row of rows) if (available.has(String(row.teamId))) {
      const configured = planningHoursForDay(day, weekly || {}, row.teamId)
      const interval = taskOccupiedInterval({ ...record, date: day, time, scheduledTime: time, status: 'Pendiente', technicalStatus: '', technicianRequest: '', completedAt: '', technicalReportedAt: '', journeyClosedAt: '' }, configured)
      if (!interval || interval.end > closingByTeam.get(String(row.teamId)) || start < timeInMinutes(weekly ? configured.bookable : configured.min) || interval.end > timeInMinutes(configured.max) || start >= timeInMinutes(configured.breakStart) && start < timeInMinutes(configured.breakEnd)) continue
      row.slots.push({ time, end: minutesAsTime(interval.serviceEnd) })
    }
  }
  return rows
}
