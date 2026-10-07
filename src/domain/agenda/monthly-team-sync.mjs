const same = (a, b) => a != null && b != null && String(a) === String(b)
const signature = ids => JSON.stringify((ids || []).map(String).sort())
const pending = task => !task.startedAt && !task.completedAt && !task.technicalStatus && (!task.status || task.status === 'Pendiente')

// Only inherited staffing is replaced. Legacy differences are treated as manual
// exceptions rather than guessing whether they came from an older template.
export function synchronizeMonthlyTeams(state, { month, teams, fromDate }) {
  const next = structuredClone(state)
  const weekly = next.agenda.weekly
  const previous = weekly._monthlyTeams?.[month]?.teams || []
  const originalHistory = state.history || []
  const linkedRecord = (task, day) => originalHistory.find(record => record.date === day && (
    (task.historyId && same(record.id, task.historyId)) ||
    (task.taskId && (same(record.sourceTaskId, task.taskId) || same(record.taskId, task.taskId)))
  ))
  const sync = (plan, day) => {
    if (!day?.startsWith(`${month}-`) || day < fromDate || [0, 6].includes(new Date(`${day}T12:00:00`).getDay())) return
    for (const team of plan.teams || []) {
      const old = previous.find(item => same(item.teamId, team.teamId))
      const replacement = teams.find(item => same(item.teamId, team.teamId))
      if (!old || !replacement || team.guardOverride || team.monthlyStaffingOverride || signature(team.memberIds) !== signature(old.memberIds)) continue
      // Do not change the crew of a team already working or with closed work.
      if ((team.tasks || []).some(task => !pending(task) || !pending(linkedRecord(task, day) || {}))) continue
      const ids = [...(replacement.memberIds || [])], names = [...(replacement.members || [])]
      for (const task of team.tasks || []) {
        if (task.vehicleControl) continue // vehicle rotation is reconciled afterwards
        const record = linkedRecord(task, day)
        // Keep explicit per-service assignments as well as per-day exceptions.
        if ((task.technicianIds?.length && signature(task.technicianIds) !== signature(old.memberIds)) ||
            (record?.technicianIds?.length && signature(record.technicianIds) !== signature(old.memberIds))) continue
        if (task.technicianIds) task.technicianIds = [...ids]
        if (task.technicians) task.technicians = [...names]
        if (record) {
          const target = next.history.find(item => same(item.id, record.id))
          target.technicianIds = [...ids]
          target.technicians = [...names]
        }
      }
      team.memberIds = ids
      team.members = names
    }
  }
  for (const [day, plan] of Object.entries(weekly)) if (!day.startsWith('_')) sync(plan, day)
  sync(next.agenda, next.agenda.date)
  return next
}
