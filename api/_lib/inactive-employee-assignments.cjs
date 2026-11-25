const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

// Preserve reports and historical team snapshots. Only operational assignments
// are removed; services themselves are never deleted or marked completed.
function removeInactiveAssignments(state, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })) {
  state = require('./redistribute-inactive-guards.cjs').redistributeInactiveGuards(state, today)
  const inactive = (state.employees || []).filter(employee => employee.status === 'Inactivo')
  if (!inactive.length) return state
  const ids = new Set(inactive.map(employee => String(employee.id)))
  const names = new Set(inactive.map(employee => normalize(employee.name || [employee.firstName, employee.lastName].filter(Boolean).join(' '))).filter(Boolean))
  const strip = (item, idKey, nameKey) => {
    const oldIds = item[idKey] || [], oldNames = item[nameKey] || []
    const positions = Array.from({ length: Math.max(oldIds.length, oldNames.length) }, (_, index) => index)
    const keep = positions.filter(index => oldIds[index] != null ? !ids.has(String(oldIds[index])) : !names.has(normalize(oldNames[index])))
    if (keep.length === positions.length) return item
    return { ...item, [idKey]: keep.filter(index => oldIds[index] != null).map(index => oldIds[index]), [nameKey]: keep.filter(index => oldNames[index] != null).map(index => oldNames[index]) }
  }
  const closed = item => ['Completado', 'Cancelado', 'Reprogramado'].includes(item?.status)
  const records = new Map((state.history || []).map(record => [String(record.id), record]))
  const cleanTask = task => closed(records.get(String(task.historyId)) || task) ? task : strip(task, 'technicianIds', 'technicians')
  const teams = (items, day) => (items || []).map(team => ({
    ...(day && day < today ? team : (() => {
      const next = strip(team, 'memberIds', 'members')
      return next !== team && String(team.label || '').startsWith('Guardia · ') ? { ...next, label: 'Guardia' } : next
    })()),
    ...(team.tasks ? { tasks: team.tasks.map(cleanTask) } : {})
  }))
  const agenda = state.agenda
  return { ...state,
    history: (state.history || []).map(record => closed(record) ? record : strip(record, 'technicianIds', 'technicians')),
    ...(agenda ? { agenda: { ...agenda, teams: teams(agenda.teams, agenda.date), weekly: Object.fromEntries(Object.entries(agenda.weekly || {}).map(([day, plan]) => {
      if (day === '_monthlyTeams') return [day, Object.fromEntries(Object.entries(plan || {}).map(([month, config]) => [month, month < today.slice(0, 7) ? config : { ...config, teams: teams(config.teams) }]))]
      return [day, /^\d{4}-\d{2}-\d{2}$/.test(day) ? { ...plan, teams: teams(plan.teams, day) } : plan]
    })) } } : {})
  }
}
module.exports = { removeInactiveAssignments }
