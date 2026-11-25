const { guardForDate, firstSaturday } = require('./annual-guard-rotation.cjs')
const identity = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const dayAfter = (day, count) => { const date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0,10) }
function redistributeInactiveGuards(state, today) {
 const weekly = state.agenda?.weekly
 if (!weekly?._annualGuards) return state
 const configs = { ...weekly._annualGuards }, changedYears = new Set()
 const employees = state.employees || []
 const employeeFor = guard => guard.technicianId != null ? employees.find(e => String(e.id) === String(guard.technicianId)) : employees.find(e => identity(e.name) === identity(guard.name))
 for (const [year, config] of Object.entries(configs)) {
  if (year < today.slice(0,4)) continue
  const rotation = config.rotation || []
  if (!rotation.some(g => employeeFor(g)?.status === 'Inactivo')) continue
  let effectiveFrom = year > today.slice(0,4) ? firstSaturday(year) : dayAfter(today, 1)
  while (new Date(effectiveFrom + 'T12:00:00Z').getUTCDay() !== 6) effectiveFrom = dayAfter(effectiveFrom, 1)
  if (!effectiveFrom.startsWith(year)) continue
  const expected = guardForDate(effectiveFrom, config)
  const position = rotation.findIndex(g => String(g.technicianId || g.name) === String(expected?.technicianId || expected?.name))
  const ordered = [...rotation.slice(Math.max(0,position)), ...rotation.slice(0,Math.max(0,position))]
  const active = ordered.filter(g => employeeFor(g)?.status === 'Activo')
  configs[year] = { ...config, rotation: active, startDate: effectiveFrom, effectiveFrom,
   previousRotations: [...(config.previousRotations || []), { effectiveFrom: config.effectiveFrom || year + '-01-01', startDate: config.startDate || firstSaturday(year), rotation }],
   redistributionReason: 'Baja de técnico', redistributedAt: today }
  changedYears.add(year)
 }
 if (!changedYears.size) return state
 const assignments = new Map(), historyById = new Map((state.history || []).map(r => [String(r.id), r]))
 const open = record => !record?.startedAt && !record?.technicalStatus && !record?.completedAt && !['Completado','Cancelado','Reprogramado','Avance registrado'].includes(record?.status)
 const updateTeams = (teams, day) => {
  if (!day || day <= today) return teams
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay()
  const saturday = weekday === 5 ? dayAfter(day,1) : day
  if (![5,6].includes(weekday) || !changedYears.has(saturday.slice(0,4))) return teams
  const before = guardForDate(saturday, weekly._annualGuards[saturday.slice(0,4)])
  const after = guardForDate(saturday, configs[saturday.slice(0,4)])
  return (teams || []).map((team,index) => {
   const wasGuard = weekday === 6 ? index === 0 && ((team.memberIds || []).length === 0 || team.memberIds?.some(id => String(id) === String(before?.technicianId))) : String(team.label || '').startsWith('Guardia')
   if (!wasGuard || (team.tasks || []).some(t => !open(historyById.get(String(t.historyId)) || t))) return team
   const memberIds = after?.technicianId ? [after.technicianId] : [], members = after?.name ? [after.name] : []
   assignments.set(day + ':' + team.teamId, { technicianIds: memberIds, technicians: members })
   return { ...team, memberIds, members, ...(weekday === 5 ? { label: after ? 'Guardia · ' + after.name : 'Guardia' } : {}), tasks: (team.tasks || []).map(t => ({ ...t, technicianIds: memberIds, technicians: members })) }
  })
 }
 const nextWeekly = Object.fromEntries(Object.entries(weekly).map(([day,plan]) => [day, /^\d{4}-\d{2}-\d{2}$/.test(day) ? { ...plan, teams: updateTeams(plan.teams,day) } : plan]))
 nextWeekly._annualGuards = configs
 const agenda = { ...state.agenda, weekly: nextWeekly, teams: updateTeams(state.agenda.teams, state.agenda.date) }
 const history = (state.history || []).map(r => { const assignment = assignments.get(r.date + ':' + r.teamId); return assignment && open(r) ? { ...r, ...assignment } : r })
 return { ...state, agenda, history }
}
module.exports = { redistributeInactiveGuards }
