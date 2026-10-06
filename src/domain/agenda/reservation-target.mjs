// Resolve against the visible plan, never by customer name or stale array indexes.
export function reservationTarget(record, plan) {
  const same = (a, b) => a != null && a !== '' && b != null && b !== '' && String(a) === String(b)
  for (const [teamIndex, team] of (plan?.teams || []).entries()) {
    for (const [taskIndex, task] of (team.tasks || []).entries()) {
      if (same(task.historyId, record.id) || (!task.historyId && same(task.taskId, record.taskId))) {
        return { teamIndex, taskIndex }
      }
    }
  }
  return null
}
