import { serviceRecordFingerprint } from '../../../domain/history/service-concurrency.mjs'
import { appendConfigurationHistory, vehicleConfigurationSnapshot } from '../../../domain/configuration/configuration-history.mjs'

export const controlFriday = record => record.vehicleControlScheduledFriday || record.date
const same = (a, b) => String(a) === String(b)

export function swapVehicleResponsibilities(snapshot, { friday, vehicleIds, baseRecords, today, user }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(friday || '') || new Date(`${friday}T12:00:00Z`).getUTCDay() !== 5 || friday < today) throw new Error('Elegí un viernes de hoy en adelante.')
  if (vehicleIds?.length !== 2 || same(vehicleIds[0], vehicleIds[1])) throw new Error('Elegí dos vehículos diferentes.')
  const records = vehicleIds.map(vehicleId => {
    const matches = (snapshot.history || []).filter(record => record.vehicleControl && same(record.vehicleId, vehicleId) && controlFriday(record) === friday)
    if (matches.length !== 1) throw new Error('Cada vehículo debe tener un control programado para ese viernes. Revisá la agenda.')
    const record = matches[0], base = baseRecords?.find(item => same(item.id, record.id))
    if (!base || serviceRecordFingerprint(record) !== serviceRecordFingerprint(base)) throw new Error('Un control cambió. Cerrá y volvé a abrir el intercambio para revisar sus responsables.')
    if (record.date < today || record.status !== 'Pendiente' || record.technicalStatus || record.startedAt || record.completedAt) throw new Error('Sólo se pueden intercambiar controles pendientes, sin iniciar y de hoy en adelante.')
    if (record.technicianIds?.length !== 1 || !record.technicianIds[0] || !record.technicians?.[0]) throw new Error('Cada control debe tener un único responsable identificado.')
    return record
  })
  if (same(records[0].technicianIds[0], records[1].technicianIds[0])) throw new Error('Los vehículos ya tienen el mismo responsable.')
  const next = structuredClone(snapshot), month = friday.slice(0, 7)
  const config = next.agenda?.weekly?._monthlyTeams?.[month]
  if (!config?.vehicleAssignments) throw new Error('Guardá primero los responsables mensuales.')
  const before = vehicleConfigurationSnapshot(config.vehicleAssignments, next.vehicles, next.employees)
  for (const [index, original] of records.entries()) {
    const incoming = records[1 - index], technicianId = incoming.technicianIds[0]
    const plans = [next.agenda.weekly[original.date], next.agenda.date === original.date ? next.agenda : null].filter(Boolean)
    const linked = task => same(task.historyId, original.id) || Boolean(original.sourceTaskId && same(task.taskId, original.sourceTaskId))
    const primary = plans[0]
    const destinations = (primary?.teams || []).filter(team => team.memberIds?.some(id => same(id, technicianId)))
    if (destinations.length !== 1) throw new Error(`No hay un equipo único para ${incoming.technicians[0]} el día del control. Revisá su asignación en la agenda.`)
    const destination = destinations[0]
    const patch = { technicianIds: [technicianId], technicians: [incoming.technicians[0]], teamId: destination.teamId, team: destination.label }
    for (const plan of plans) {
      const target = plan.teams.find(team => same(team.teamId, destination.teamId))
      const tasks = plan.teams.flatMap(team => team.tasks || []).filter(linked)
      if (!target || tasks.length !== 1) throw new Error('La agenda no tiene una tarjeta única para cada control. Actualizá antes de intercambiar.')
      plan.teams.forEach(team => { team.tasks = (team.tasks || []).filter(task => !linked(task)) })
      target.tasks.push({ ...tasks[0], ...patch })
      target.tasks.sort((a, b) => String(a.time).localeCompare(String(b.time)))
    }
    Object.assign(next.history.find(record => same(record.id, original.id)), patch)
    const assignment = config.vehicleAssignments.find(item => same(item.vehicleId, original.vehicleId))
    if (!assignment) throw new Error('Falta la configuración mensual de uno de los vehículos.')
    assignment.weeklyOverrides = { ...assignment.weeklyOverrides, [friday]: technicianId }
    if (same(assignment.technicianId, technicianId)) delete assignment.weeklyOverrides[friday]
  }
  config.configurationHistory = appendConfigurationHistory(config.configurationHistory, {
    type: 'vehicles', period: month, before,
    after: vehicleConfigurationSnapshot(config.vehicleAssignments, next.vehicles, next.employees), user
  })
  return next
}
