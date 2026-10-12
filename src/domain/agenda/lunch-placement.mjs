// Presentation only: preserve task indexes and never turn lunch into a bookable gap.
export function withLunchNotice(tasks, gaps, hours) {
  if (!hours || hours.breakStart >= hours.max || hours.breakEnd <= hours.min) return gaps
  const index = tasks.findIndex(task => (task.time || task.scheduledTime || '') >= hours.breakStart)
  const lunch = { kind: 'lunch', start: hours.breakStart, end: hours.breakEnd, beforeIndex: index < 0 ? tasks.length : index, hours }
  return [...gaps, lunch].sort((a, b) => a.beforeIndex - b.beforeIndex || a.start.localeCompare(b.start))
}
