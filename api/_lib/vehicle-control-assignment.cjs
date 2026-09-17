const same = (a, b) => String(a || '') === String(b || '')
const closed = record => ['Completado', 'Cancelado', 'Reprogramado'].includes(record.status) || Boolean(record.technicalStatus)

// Synchronize only existing pending controls; never create deleted controls here.
function synchronizeVehicleControlAssignments(state, previous = {}) {
  const next = structuredClone(state)
  const weekly = next.agenda?.weekly || {}
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
      if (assignment) assignment.weeklyOverrides = { ...assignment.weeklyOverrides, [friday]: selected }
    }
  }
  return next
}
module.exports = { synchronizeVehicleControlAssignments }
