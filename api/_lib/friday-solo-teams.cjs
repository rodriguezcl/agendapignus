const { serviceSlotReleased } = require('./service-slot-released.cjs')
const { workdayForDate } = require('./workday.cjs')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const soloId = team => team?.memberIds?.length === 1 && (team.members || []).length <= 1 ? String(team.memberIds[0]) : ''
const locked = record => Boolean(record.startedAt || record.technicalStatus || record.technicalReportedAt || ['Completado', 'Avance registrado', 'En curso'].includes(record.status))
const guardTask = task => !task.vehicleControl && !serviceSlotReleased(task) && Boolean(task.serviceId || task.service || task.client || task.historyId) && /^(?:1[6-9]:[0-5]\d|20:00)$/.test(task.time || task.scheduledTime || '')
const friday = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T12:00:00Z`).getUTCDay() === 5

// Si el equipo individual pasa a trabajar acompañado, la guardia conserva
// al técnico que la adelantó; sólo los servicios ordinarios cambian de grupo.
function preserveFridayGuardCrew(state, previous, day) {
  const plan = state.agenda?.weekly?.[day]
  if (!plan) return state
  let next = state
  for (const team of plan.teams || []) {
    const before = previous?.agenda?.weekly?.[day]?.teams?.find(item => String(item.teamId) === String(team.teamId))
    if (!soloId(before) || team.memberIds?.length < 2 || !team.memberIds?.some(id => String(id) === soloId(before))) continue
    const previousGuards = (before.tasks || []).filter(guardTask)
    const moved = (team.tasks || []).filter(task => previousGuards.some(old => old.taskId && old.taskId === task.taskId) && guardTask(task) && !locked(task) && !(previous.history || []).some(record => (record.id === task.historyId || record.sourceTaskId === task.taskId) && locked(record)))
    if (!moved.length) continue
    const currentPlan = next.agenda.weekly[day]
    const target = currentPlan.teams.find(item => soloId(item) === soloId(before)) || {
      teamId: 'friday-guard-' + day + '-' + soloId(before), label: 'Guardia · ' + before.members[0],
      memberIds: [...before.memberIds], members: [...before.members], tasks: []
    }
    const ids = new Set(moved.map(task => task.taskId))
    const recordIds = new Set(moved.map(task => task.historyId).filter(Boolean))
    const reassign = item => ({ ...item, teamId: target.teamId, team: target.label, technicianIds: [...target.memberIds], technicians: [...target.members] })
    const transfer = teams => {
      const result = (teams || []).map(item => String(item.teamId) === String(team.teamId) ? { ...item, tasks: (item.tasks || []).filter(task => !ids.has(task.taskId)) } : item)
      const existing = result.find(item => String(item.teamId) === String(target.teamId))
      const destination = { ...target, ...(existing || {}), tasks: [...(existing?.tasks || target.tasks || []).filter(task => !ids.has(task.taskId)), ...moved.map(reassign)].sort((a,b) => String(a.time).localeCompare(String(b.time))) }
      return existing ? result.map(item => item === existing ? destination : item) : [...result, destination]
    }
    const agenda = { ...next.agenda, weekly: { ...next.agenda.weekly, [day]: { ...currentPlan,
      teams: transfer(currentPlan.teams), removedTeams: (currentPlan.removedTeams || []).filter(marker => String(marker.teamId) !== String(target.teamId))
    } } }
    if (agenda.date === day) agenda.teams = transfer(agenda.teams)
    next = { ...next, agenda, history: (next.history || []).map(record => record.date === day && (ids.has(record.sourceTaskId) || recordIds.has(record.id)) ? reassign(record) : record) }
  }
  return next
}

// Consolidación operativa: conserva identidades de servicios, responsables y horarios.
// Se ejecuta únicamente para viernes modificados; nunca migra semanas históricas
// como efecto secundario de guardar otro módulo.
function unifyFridaySoloTeams(state, previous, { days, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) } = {}) {
  const weekly = state.agenda?.weekly || {}
  const changedMonths = new Set(Object.keys(weekly._monthlyTeams || {}).filter(month => !same(weekly._monthlyTeams[month]?.teams, previous?.agenda?.weekly?._monthlyTeams?.[month]?.teams)))
  const candidates = days || Object.keys(weekly).filter(day => !same(weekly[day], previous?.agenda?.weekly?.[day]) || changedMonths.has(day.slice(0, 7)))
  if (!days && state.agenda?.date && !same(state.agenda.teams, previous?.agenda?.teams)) candidates.push(state.agenda.date)
  let next = state
  for (const day of new Set(candidates)) {
    if (!friday(day) || day < today) continue
    let saved = next.agenda.weekly?.[day] || (next.agenda.date === day ? { teams: next.agenda.teams || [] } : null)
    const dailyChanged = next.agenda.date === day && previous?.agenda?.date === day && !same(state.agenda.teams, previous.agenda.teams)
    if (saved && dailyChanged && same(state.agenda.weekly?.[day], previous?.agenda?.weekly?.[day])) {
      const daily = next.agenda.teams || []
      saved = { ...saved, teams: [...(saved.teams || []).filter(team => !daily.some(item => String(item.teamId) === String(team.teamId))), ...daily] }
    }
    if (!saved) continue
    const aligned = saved === next.agenda.weekly?.[day] ? next : { ...next, agenda: { ...next.agenda, weekly: { ...next.agenda.weekly, [day]: saved } } }
    const separated = preserveFridayGuardCrew(aligned, previous, day)
    if (separated !== aligned) { next = separated; saved = next.agenda.weekly[day] }
    const monthly = weekly._monthlyTeams?.[day.slice(0, 7)]?.teams || []
    const removed = new Set((saved.removedTeams || []).map(marker => String(marker.teamId || '')))
    const effective = monthly.filter(team => !removed.has(String(team.teamId))).map(team => saved.teams?.find(item => String(item.teamId) === String(team.teamId)) || { ...team, tasks: [] })
    effective.push(...(saved.teams || []).filter(team => !effective.some(item => String(item.teamId) === String(team.teamId)) && !removed.has(String(team.teamId))))
    const guardIds = new Set(effective.filter(team => soloId(team) && team.tasks?.some(guardTask)).map(soloId))
    let plan = saved
    for (const technician of guardIds) {
      const group = effective.filter(team => soloId(team) === technician && team.teamId)
      if (group.length < 2) continue
      const records = (next.history || []).filter(record => record.date === day)
      const protectedTeams = group.filter(team => team.tasks?.some(locked) || records.some(record => String(record.teamId) === String(team.teamId) && locked(record)))
      // Un informe ya iniciado conserva su equipo original. Si hay dos, no se
      // reescribe esa historia automáticamente.
      if (protectedTeams.length > 1) continue
      const target = protectedTeams[0] || group.find(team => monthly.some(item => String(item.teamId) === String(team.teamId))) || group[0]
      const targetHours = workdayForDate(day, weekly, target.teamId)
      if (group.some(team => !same(workdayForDate(day, weekly, team.teamId), targetHours))) continue
      const sourceIds = new Set(group.filter(team => team !== target).map(team => String(team.teamId)))
      const remap = value => ({ ...value, ...(sourceIds.has(String(value.teamId)) ? { teamId: target.teamId, ...(Object.hasOwn(value, 'team') ? { team: target.label } : {}) } : {}) })
      const mergeTasks = teams => {
        const tasks = [], seen = new Map()
        for (const team of teams) for (const original of team.tasks || []) {
          const task = remap(original)
          const key = task.taskId ? `task:${task.taskId}` : task.historyId ? `history:${task.historyId}` : ''
          if (key && seen.has(key)) {
            if (!same(seen.get(key), task)) throw new Error('Hay versiones distintas de un servicio en los equipos a unificar. Recargá la agenda.')
            continue
          }
          if (key) seen.set(key, task)
          tasks.push(task)
        }
        return tasks.sort((a, b) => String(a.time || a.scheduledTime || '').localeCompare(String(b.time || b.scheduledTime || '')))
      }
      const merged = { ...target, tasks: mergeTasks(group) }
      const teams = (plan.teams || []).filter(team => !sourceIds.has(String(team.teamId))).map(team => String(team.teamId) === String(target.teamId) ? merged : team)
      if (!teams.some(team => String(team.teamId) === String(target.teamId))) teams.push(merged)
      const removedTeams = [...(plan.removedTeams || []), ...[...sourceIds].filter(id => !(plan.removedTeams || []).some(marker => String(marker.teamId) === id)).map(id => ({ id: `team:${id}`, teamId: id }))]
      const removedSlots = plan.removedSlots?.map(slot => sourceIds.has(String(slot.teamId)) ? { ...slot, teamId: target.teamId } : slot)
      const newPlan = { ...plan, teams, removedTeams, ...(removedSlots ? { removedSlots } : {}) }
      const agenda = { ...next.agenda, weekly: { ...next.agenda.weekly, [day]: newPlan } }
      if (agenda.date === day) {
        const daily = agenda.teams || []
        const dailyGroup = daily.filter(team => sourceIds.has(String(team.teamId)) || String(team.teamId) === String(target.teamId))
        const dailyTarget = { ...merged, tasks: mergeTasks([merged, ...dailyGroup]) }
        agenda.teams = daily.filter(team => !sourceIds.has(String(team.teamId))).map(team => String(team.teamId) === String(target.teamId) ? dailyTarget : team)
        if (!agenda.teams.some(team => String(team.teamId) === String(target.teamId))) agenda.teams.push(dailyTarget)
      }
      plan = newPlan
      next = { ...next, agenda, history: (next.history || []).map(record => record.date === day && sourceIds.has(String(record.teamId)) ? remap(record) : record) }
    }
  }
  return next
}
module.exports = { unifyFridaySoloTeams }
