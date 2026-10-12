import workday from '../../../api/_lib/workday.cjs'
import { completedServiceRelease, taskOccupiedInterval } from './service-scheduling.mjs'

// Finishing one job does not imply the team is free: other jobs may be due.
export function completionLabel(task) {
  const completion = completedServiceRelease(task)
  const interval = taskOccupiedInterval(task)
  if (!completion || !interval) return ''
  const delayed = completion.completedMinutes > workday.workingEnd(interval.start, interval.estimatedMinutes)
  return delayed ? `Finalizó con demora a las ${completion.completedTime}` : `Finalizó a las ${completion.completedTime}`
}
