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

const zonedDateTime = value => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.second)
  }
}

export const completedServiceRelease = task => {
  const completed = task?.status === 'Completado' || task?.technicalStatus === 'Completado'
  const completedAt = task?.completedAt || task?.technicalReportedAt
  const completion = completed && completedAt ? zonedDateTime(completedAt) : null
  const taskDate = String(task?.date || '')
  const start = timeInMinutes(task?.time || task?.scheduledTime)
  if (!completion || !taskDate || completion.date !== taskDate || start === null || completion.minutes < start) return null
  const elapsedMinutes = completion.minutes + (completion.seconds > 0 ? 1 : 0)
  const release = Math.ceil(elapsedMinutes / LIVE_SCHEDULE_STEP_MINUTES) * LIVE_SCHEDULE_STEP_MINUTES
  return {
    completedAt,
    completedMinutes: completion.minutes,
    completedTime: minutesAsTime(completion.minutes),
    release,
    releaseTime: minutesAsTime(release)
  }
}

export const taskReservationMinutes = task => Math.max(
  MINIMUM_SERVICE_RESERVATION_MINUTES,
  normalizeServiceEstimatedMinutes(task?.estimatedMinutes)
)

export const taskOccupiedInterval = task => {
  const start = timeInMinutes(task?.time || task?.scheduledTime)
  if (start === null) return null
  const estimatedMinutes = normalizeServiceEstimatedMinutes(task?.estimatedMinutes)
  const completion = completedServiceRelease(task)
  const estimatedOccupiedMinutes = taskReservationMinutes(task)
  const occupiedMinutes = completion ? completion.release - start : estimatedOccupiedMinutes
  const serviceEnd = completion ? completion.completedMinutes : start + estimatedMinutes
  const end = completion ? completion.release : start + estimatedOccupiedMinutes
  return {
    start,
    serviceEnd,
    end,
    estimatedMinutes,
    occupiedMinutes,
    actualCompletion: Boolean(completion),
    completedAt: completion?.completedAt || '',
    completedTime: completion?.completedTime || '',
    releaseTime: completion?.releaseTime || '',
    startTime: minutesAsTime(start),
    serviceEndTime: minutesAsTime(serviceEnd),
    endTime: minutesAsTime(end)
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
