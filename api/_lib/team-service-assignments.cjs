const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || [])

// Membership changes affect open, not-yet-started ordinary services only.
// Completed reports and vehicle controls retain their original responsibility.
function synchronizeTeamServiceAssignments(state, previous) {
  const changed = new Map()
  const collect = (day, teams, before) => {
    for (const team of teams || []) {
      if (!team.teamId) continue
      const old = (before || []).find(item => String(item.teamId) === String(team.teamId))
      if (old && (!same(old.memberIds, team.memberIds) || !same(old.members, team.members))) {
        changed.set(`${day}:${team.teamId}`, team)
      }
    }
  }
  for (const [day, plan] of Object.entries(state.agenda?.weekly || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) collect(day, plan.teams, previous?.agenda?.weekly?.[day]?.teams)
  }
  if (state.agenda?.date === previous?.agenda?.date) collect(state.agenda.date, state.agenda.teams, previous.agenda.teams)
  if (!changed.size) return state
  return { ...state, history: (state.history || []).map(record => {
    if (record.vehicleControl || record.startedAt || record.technicalStatus || record.technicalReportedAt || record.technicianRequest || !['Pendiente', undefined, ''].includes(record.status)) return record
    const team = changed.get(`${record.date}:${record.teamId}`)
    return team ? { ...record, technicianIds: [...(team.memberIds || [])], technicians: [...(team.members || [])] } : record
  }) }
}
module.exports = { synchronizeTeamServiceAssignments }
