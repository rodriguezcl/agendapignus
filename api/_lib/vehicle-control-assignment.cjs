const same = (a, b) => String(a || '') === String(b || '')
const closed = record => ['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(record.status) || Boolean(record.technicalStatus || record.startedAt || record.completedAt)

// Synchronize only existing pending controls; never create deleted controls here.
function synchronizeVehicleControlAssignments(state, previous = {}) {
  const next = structuredClone(state)
  const weekly = next.agenda?.weekly || {}
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  // A day-specific staffing edit moves the control with its responsible
  // technician; it must not turn a team change into a monthly replacement.
  const staffing = teams => JSON.stringify((teams || []).map(team => [team.teamId, team.memberIds, team.members]))
  const changedDays = new Set()
  for (const [day, plan] of Object.entries(weekly)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const old = previous.agenda?.weekly?.[day]
    if (old && staffing(plan.teams) !== staffing(old.teams)) changedDays.add(day)
  }
  const dailyDay = next.agenda?.date
  if (dailyDay && dailyDay === previous.agenda?.date && staffing(next.agenda.teams) !== staffing(previous.agenda.teams)) {
    changedDays.add(dailyDay)
    // Match the edited day's staffing before resolving a destination in either view.
    for (const team of weekly[dailyDay]?.teams || []) {
      const daily = next.agenda.teams?.find(item => same(item.teamId, team.teamId))
      if (daily) { team.memberIds = [...(daily.memberIds || [])]; team.members = [...(daily.members || [])] }
    }
  }
  for (const record of next.history || []) {
    if (!record.vehicleControl || closed(record) || (!changedDays.has(record.date) && !(record.date >= today))) continue
    const linked = task => Boolean(task.historyId && same(task.historyId, record.id) || task.taskId && same(task.taskId, record.sourceTaskId))
    const plans = [weekly[record.date], next.agenda?.date === record.date ? next.agenda : null].filter(Boolean)
    const primary = plans[0]
    const source = primary?.teams?.find(team => team.tasks?.some(linked))
    if (!source) continue // Never recreate a removed control.
    const task = source.tasks.find(linked)
    const oldTask = previous.agenda?.weekly?.[record.date]?.teams?.flatMap(team => team.tasks || []).find(linked)
    const oldRecord = previous.history?.find(item => same(item.id, record.id))
    // Explicit responsibility edits are handled by the existing override policy.
    if (oldTask && !same(oldTask.technicianIds?.[0], task.technicianIds?.[0]) || oldRecord && !same(oldRecord.technicianIds?.[0], record.technicianIds?.[0])) continue
    const destinations = primary.teams.filter(team => team.memberIds?.some(id => same(id, record.technicianIds?.[0])))
    if (destinations.length !== 1) continue // Intermediate selections must not guess responsibility.
    const destination = destinations[0]
    record.teamId = destination.teamId
    record.team = destination.label || record.team
    for (const plan of plans) {
      const target = plan.teams?.find(team => same(team.teamId, destination.teamId))
      const existing = plan.teams?.flatMap(team => team.tasks || []).find(linked)
      if (!target || !existing) continue
      plan.teams.forEach(team => { team.tasks = (team.tasks || []).filter(item => !linked(item)) })
      target.tasks ||= []
      target.tasks.push({ ...existing, technicianIds: [...record.technicianIds], technicians: [...(record.technicians || [])] })
      target.tasks.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
    }
  }
  for (const record of next.history || []) {
    if (!record.vehicleControl || closed(record)) continue
    const day = record.date
    const linked = task => (task.historyId && same(task.historyId, record.id)) || (task.taskId && same(task.taskId, record.sourceTaskId))
    const weeklyTeam = weekly[day]?.teams?.find(team => team.tasks?.some(linked))
    const dailyTeam = next.agenda?.date === day ? next.agenda.teams?.find(team => team.tasks?.some(linked)) : null
    const oldDaily = previous.agenda?.date === day ? previous.agenda.teams?.find(team => same(team.teamId, dailyTeam?.teamId)) : null
    const dailyChanged = dailyTeam && oldDaily && JSON.stringify(dailyTeam.memberIds) !== JSON.stringify(oldDaily.memberIds)
    const team = dailyChanged ? dailyTeam : weeklyTeam || dailyTeam
    if (!team) continue
    const task = team.tasks.find(linked)
    const ids = team.memberIds || []
    const proposed = task.technicianIds?.[0]
    const oldRecord = previous.history?.find(item => same(item.id, record.id))
    const explicitReplacement = oldRecord && !same(oldRecord.technicianIds?.[0], record.technicianIds?.[0])
    const oldTask = previous.agenda?.weekly?.[day]?.teams?.flatMap(item => item.tasks || []).find(linked)
    const taskReplacement = oldTask && !same(oldTask.technicianIds?.[0], proposed)
    if (!explicitReplacement && !taskReplacement && !dailyChanged) continue
    const selected = explicitReplacement ? record.technicianIds?.[0] :
      ids.find(id => same(id, proposed)) || ids.find(id => same(id, record.technicianIds?.[0])) || (ids.length === 1 ? ids[0] : null)
    if (!selected) continue // Empty/intermediate teams or ambiguous replacements need explicit selection.
    const position = ids.findIndex(id => same(id, selected))
    const name = (explicitReplacement ? record.technicians?.[0] : '') || team.members?.[position] || next.employees?.find(employee => same(employee.id, selected))?.name
    if (!name) continue
    if (dailyChanged && weeklyTeam) {
      weeklyTeam.memberIds = [...dailyTeam.memberIds]
      weeklyTeam.members = [...dailyTeam.members]
    }
    const changed = !same(record.technicianIds?.[0], selected)
    record.technicianIds = [selected]
    record.technicians = [name]
    record.teamId = team.teamId
    record.team = team.label || record.team
    for (const projection of [weeklyTeam, dailyTeam].filter(Boolean)) {
      for (const item of projection.tasks.filter(linked)) {
        item.technicianIds = [selected]
        item.technicians = [name]
      }
    }
    if (changed || explicitReplacement) {
      const friday = record.vehicleControlScheduledFriday || day
      const month = record.monthlyVehicleAssignment || friday.slice(0, 7)
      const assignment = weekly._monthlyTeams?.[month]?.vehicleAssignments?.find(item => same(item.vehicleId, record.vehicleId))
      if (assignment && !same(assignment.technicianId, selected)) assignment.weeklyOverrides = { ...assignment.weeklyOverrides, [friday]: selected }
      else if (assignment?.weeklyOverrides?.[friday]) {
        const overrides = { ...assignment.weeklyOverrides }
        delete overrides[friday]
        assignment.weeklyOverrides = overrides
      }
    }
  }
  return next
}
module.exports = { synchronizeVehicleControlAssignments }
