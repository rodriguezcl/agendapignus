export const DEFAULT_SERVICE_ESTIMATED_MINUTES = 60
export const MINIMUM_SERVICE_RESERVATION_MINUTES = 60
export const MAX_SERVICE_ESTIMATED_MINUTES = 12 * 60

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

export const taskReservationMinutes = task => Math.max(
  MINIMUM_SERVICE_RESERVATION_MINUTES,
  normalizeServiceEstimatedMinutes(task?.estimatedMinutes)
)

export const taskOccupiedInterval = task => {
  const start = timeInMinutes(task?.time || task?.scheduledTime)
  if (start === null) return null
  const estimatedMinutes = normalizeServiceEstimatedMinutes(task?.estimatedMinutes)
  const occupiedMinutes = taskReservationMinutes(task)
  return {
    start,
    serviceEnd: start + estimatedMinutes,
    end: start + occupiedMinutes,
    estimatedMinutes,
    occupiedMinutes,
    startTime: minutesAsTime(start),
    serviceEndTime: minutesAsTime(start + estimatedMinutes),
    endTime: minutesAsTime(start + occupiedMinutes)
  }
}

export const serviceScheduleConflicts = (teams = [], hasContent = task => Boolean(task?.serviceId || task?.service || task?.customerId || task?.client)) => teams.flatMap((team, teamIndex) => {
  const scheduled = (team.tasks || [])
    .filter(hasContent)
    .map((task, taskIndex) => ({ task, taskIndex, interval: taskOccupiedInterval(task) }))
    .filter(item => item.interval)
    .sort((left, right) => left.interval.start - right.interval.start)
  const conflicts = []
  scheduled.forEach((current, currentIndex) => {
    scheduled.slice(0, currentIndex).forEach(previous => {
      if (current.interval.start < previous.interval.end && previous.interval.start < current.interval.end) {
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
