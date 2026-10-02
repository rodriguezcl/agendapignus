import { suggestedVehicleAssignments, buildVehicleControlRecords, vehicleControlTask, vehicleControlFriday } from './vehicle-controls.mjs'

const same = (a, b) => String(a) === String(b)
const editable = (record, fromDate) => record.date >= fromDate && !record.startedAt && !record.technicalStatus && !record.completedAt && !['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(record.status)

// Recalculate monthly defaults, but preserve genuine per-Friday replacements.
export function synchronizeMonthlyVehicles(state, { month, teams, vehicles, technicians, fromDate, holidays = [] }) {
  const next = structuredClone(state)
  const weekly = next.agenda.weekly
  const previous = weekly._monthlyTeams?.[month] || {}
  const history = Object.entries(weekly._monthlyTeams || {}).filter(([key]) => key < month).sort(([a], [b]) => a.localeCompare(b)).map(([, config]) => config.vehicleAssignments || [])
  const assignments = suggestedVehicleAssignments(vehicles, teams, { month, assignmentHistory: history }).map(assignment => {
    if (!assignment.technicianId) throw new Error('Completá los equipos mensuales antes de asignar vehículos.')
    const old = previous.vehicleAssignments?.find(item => same(item.vehicleId, assignment.vehicleId))
    const weeklyOverrides = Object.fromEntries(Object.entries(old?.weeklyOverrides || {}).filter(([, id]) => !same(id, old.technicianId)))
    return { ...assignment, ...(Object.keys(weeklyOverrides).length ? { weeklyOverrides } : {}) }
  })
  const generated = buildVehicleControlRecords({ month, assignments, vehicles, technicians, teams, fromDate, holidays, holidayOverrides: weekly._holidayOverrides || {} })
  const existing = next.history.filter(record => record.vehicleControl && (record.monthlyVehicleAssignment || vehicleControlFriday(record).slice(0, 7)) === month)
  const freshMonth = !previous.vehicleAssignments?.length && !existing.length
  const targets = freshMonth ? generated : existing.filter(record => editable(record, fromDate)).map(record => {
    const assignment = assignments.find(item => same(item.vehicleId, record.vehicleId))
    if (!assignment) return record
    const id = assignment.weeklyOverrides?.[vehicleControlFriday(record)] || assignment.technicianId
    const technician = technicians.find(item => same(item.id, id))
    if (!technician) throw new Error('Un reemplazo vehicular ya no corresponde a un técnico activo. Revisá Vehículos del mes.')
    return { ...record, technicianIds: [technician.id], technicians: [technician.name] }
  })
  for (const record of targets) {
    const day = record.date
    const plan = weekly[day] || { teams: teams.map(team => ({ ...team, tasks: [] })) }
    const removed = plan.removedTaskIds || []
    if (freshMonth && [record.id, record.sourceTaskId].some(id => removed.includes(id))) continue
    let destination = plan.teams.find(team => team.memberIds?.some(id => same(id, record.technicianIds[0])))
    if (!destination) {
      const template = teams.find(team => team.memberIds?.some(id => same(id, record.technicianIds[0])))
      if (!template) throw new Error('El responsable vehicular no pertenece a ningún equipo del mes.')
      // Never silently replace an existing day's staffing.
      if (plan.teams.some(team => same(team.teamId, template.teamId))) throw new Error('La dotación de una jornada no coincide con los equipos del mes. Revisá la asignación diaria antes de guardar.')
      destination = { ...template, tasks: [] }; plan.teams.push(destination)
    }
    record.teamId = destination.teamId; record.team = destination.label
    const linked = task => same(task.historyId, record.id) || same(task.taskId, record.sourceTaskId || record.id)
    const oldTask = plan.teams.flatMap(team => team.tasks || []).find(linked)
    plan.teams.forEach(team => { team.tasks = (team.tasks || []).filter(task => !linked(task)) })
    destination.tasks.push({ ...oldTask, ...vehicleControlTask(record) })
    destination.tasks.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
    weekly[day] = plan
    const index = next.history.findIndex(item => same(item.id, record.id))
    if (index >= 0) next.history[index] = record
    else next.history.push(record)
    if (next.agenda.date === day) {
      const dailyDestination = next.agenda.teams?.find(team => team.memberIds?.some(id => same(id, record.technicianIds[0])))
      if (!dailyDestination && next.agenda.teams?.some(team => team.tasks?.some(linked))) throw new Error('La agenda diaria no tiene un equipo para el responsable vehicular. Revisá su dotación antes de guardar.')
      if (dailyDestination) {
        next.agenda.teams.forEach(team => { team.tasks = (team.tasks || []).filter(task => !linked(task)) })
        dailyDestination.tasks.push({ ...oldTask, ...vehicleControlTask(record) })
      }
    }
  }
  const controls = next.history.filter(record => record.vehicleControl && editable(record, fromDate) && (record.monthlyVehicleAssignment || vehicleControlFriday(record).slice(0, 7)) === month)
  const slots = new Set()
  for (const record of controls) {
    const key = `${record.date}:${record.time}:${record.technicianIds?.[0]}`
    if (slots.has(key)) throw new Error('Un reemplazo por fecha se superpone con la nueva rotación. Revisá Vehículos del mes antes de guardar.')
    slots.add(key)
  }
  weekly._monthlyTeams = { ...weekly._monthlyTeams, [month]: { ...previous, teams, vehicleAssignments: assignments } }
  return next
}
