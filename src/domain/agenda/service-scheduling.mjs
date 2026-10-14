import completionPolicy from '../../../api/_lib/service-completion-minute.cjs'
import workday from '../../../api/_lib/workday.cjs'
import slotPolicy from '../../../api/_lib/service-slot-released.cjs'
import vehicleOverlapPolicy from '../../../api/_lib/independent-vehicle-controls.cjs'
export const { serviceSlotReleased } = slotPolicy
export const DEFAULT_SERVICE_ESTIMATED_MINUTES = 60
export const MINIMUM_SERVICE_RESERVATION_MINUTES = 60
export const MAX_SERVICE_ESTIMATED_MINUTES = 12 * 60
export const LIVE_SCHEDULE_STEP_MINUTES = 15
export const SCHEDULE_TIME_ZONE = 'America/Argentina/Buenos_Aires'

export const validServiceEstimatedMinutes = value => {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= MAX_SERVICE_ESTIMATED_MINUTES
}

export const normalizeServiceEstimatedMinutes = (value, fallback = DEFAULT_SERVICE_ESTIMATED_MINUTES) => (
  validServiceEstimatedMinutes(value) ? Number(value) : fallback
)

export const timeInMinutes = value => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null
}

export const minutesAsTime = value => {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return ''
  const normalized = Math.max(0, Math.round(minutes))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export const completedServiceRelease = task => {
  const completion = completionPolicy.serviceCompletionMinute(task)
  if (!completion) return null
  return {
    completedAt: completion.completedAt,
    completedMinutes: completion.minutes,
    completedTime: minutesAsTime(completion.minutes),
    release: completion.minutes,
    releaseTime: minutesAsTime(completion.minutes)
  }
}

export const isMonthlyMeeting = task => String(task?.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ') === 'reunion mensual'
export const allowedMeetingControlOverlap = (first, second) => Boolean(vehicleOverlapPolicy.independentVehicleControls(first, second) || (isMonthlyMeeting(first) && second?.vehicleControl) || (first?.vehicleControl && isMonthlyMeeting(second)))

export const taskReservationMinutes = task => Math.max(
  task?.vehicleControl || isMonthlyMeeting(task) ? 15 : MINIMUM_SERVICE_RESERVATION_MINUTES,
  normalizeServiceEstimatedMinutes(task?.estimatedMinutes)
)

export const taskOccupiedInterval = (task, hours = {}) => {
  if (serviceSlotReleased(task)) return null
  const start = timeInMinutes(task?.time || task?.scheduledTime)
  if (start === null) return null
  const estimatedMinutes = normalizeServiceEstimatedMinutes(task?.estimatedMinutes)
  const completion = completedServiceRelease(task)
  const estimatedOccupiedMinutes = taskReservationMinutes(task)
  const plannedServiceEnd = workday.workingEnd(start, estimatedMinutes, hours)
  const plannedEnd = workday.workingEnd(start, estimatedOccupiedMinutes, hours)
  // Una finalización anticipada libera agenda. Un atraso es una contingencia
  // operativa y no debe convertir retroactivamente la planificación en conflicto.
  const earlyCompletion = Boolean(completion && completion.release < plannedEnd)
  const serviceEnd = earlyCompletion ? completion.completedMinutes : plannedServiceEnd
  const end = earlyCompletion ? completion.release : plannedEnd
  const occupiedMinutes = end - start
  return {
    start,
    serviceEnd,
    end,
    estimatedMinutes,
    occupiedMinutes,
    actualCompletion: Boolean(completion),
    earlyCompletion,
    completedAt: completion?.completedAt || '',
    completedTime: completion?.completedTime || '',
    releaseTime: completion?.releaseTime || '',
    startTime: minutesAsTime(start),
    serviceEndTime: minutesAsTime(serviceEnd),
    endTime: earlyCompletion ? completion.releaseTime : minutesAsTime(end)
  }
}

export const serviceScheduleConflicts = (teams = [], hasContent = task => Boolean(task?.serviceId || task?.service || task?.customerId || task?.client), weekly = {}) => teams.flatMap((team, teamIndex) => {
  const scheduled = (team.tasks || [])
    .filter(hasContent)
    .map((task, taskIndex) => ({ task, taskIndex, interval: taskOccupiedInterval(task, workday.workdayForDate(task.date, weekly, team.teamId)) }))
    .filter(item => item.interval)
    .sort((left, right) => left.interval.start - right.interval.start)
  const conflicts = []
  scheduled.forEach((current, currentIndex) => {
    scheduled.slice(0, currentIndex).forEach(previous => {
      if (!allowedMeetingControlOverlap(current.task, previous.task) && current.interval.start < previous.interval.end && previous.interval.start < current.interval.end) {
        conflicts.push({ teamIndex, firstTaskIndex: previous.taskIndex, secondTaskIndex: current.taskIndex, firstTask: previous.task, secondTask: current.task, first: previous.interval, second: current.interval })
      }
    })
  })
  return conflicts
})

export const removeOverlappingDefaultSlots = (tasks = [], hasContent = task => Boolean(task?.serviceId || task?.service || task?.customerId || task?.client)) => {
  const occupied = tasks.filter(hasContent).map(taskOccupiedInterval).filter(Boolean)
  return tasks.filter(task => {
    if (hasContent(task) || task?.manualSlot) return true
    const slot = taskOccupiedInterval({ ...task, estimatedMinutes: MINIMUM_SERVICE_RESERVATION_MINUTES })
    return !slot || !occupied.some(interval => slot.start < interval.end && interval.start < slot.end)
  })
}
