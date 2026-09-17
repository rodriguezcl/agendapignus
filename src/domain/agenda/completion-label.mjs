import { completedServiceRelease, taskOccupiedInterval } from './service-scheduling.mjs'

// Finishing one job does not imply the team is free: other jobs may be due.
export function completionLabel(task) {
  const completion = completedServiceRelease(task)
  const interval = taskOccupiedInterval(task)
  if (!completion || !interval) return ''
  const delayed = completion.completedMinutes > interval.start + interval.estimatedMinutes
  return delayed ? `Finalizó con demora a las ${completion.completedTime}` : `Finalizó a las ${completion.completedTime}`
}
