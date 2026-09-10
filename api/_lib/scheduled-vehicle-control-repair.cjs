const { fingerprint } = require('./normalization-analysis.cjs')

function restoreScheduledVehicleControls(state, month = '2026-09') {
  const next = structuredClone(state), weekly = next.agenda?.weekly || {}
  const config = weekly._monthlyTeams?.[month]
  if (!Array.isArray(config?.vehicleAssignments)) throw new Error(`Falta la configuración vehicular de ${month}.`)
  const employees = new Map((next.employees || []).map(item => [String(item.id), item]))
  const vehicles = new Map((next.vehicles || []).map(item => [String(item.id), item]))
  const assignments = new Map(config.vehicleAssignments.map(item => [String(item.vehicleId), item]))
  const historyIds = new Set((next.history || []).map(item => String(item.id)))
  const restored = []
  for (const [date, plan] of Object.entries(weekly)) {
    if (!date.startsWith(`${month}-`) || !Array.isArray(plan?.teams)) continue
    for (const team of plan.teams) for (const task of team.tasks || []) {
      if (!task.vehicleControl || historyIds.has(String(task.historyId || task.taskId))) continue
      const id = String(task.historyId || ''), vehicleId = String(task.vehicleId || '')
      if (!id || id !== String(task.taskId || '') || !id.startsWith(`vehicle-control-${task.vehicleControlScheduledFriday || date}-`)) throw new Error(`Identidad vehicular inconsistente en ${date}.`)
      if (task.monthlyVehicleAssignment !== month || task.serviceId !== 'vehicle-weekly-control' || task.time !== '15:30' || Number(task.estimatedMinutes) !== 15) throw new Error(`El control ${id} cambió en campos protegidos.`)
      const assignment = assignments.get(vehicleId), friday = task.vehicleControlScheduledFriday || date
      const technicianId = String(assignment?.weeklyOverrides?.[friday] || assignment?.technicianId || '')
      const employee = employees.get(technicianId), vehicle = vehicles.get(vehicleId)
      if (!assignment || !employee || !vehicle) throw new Error(`No se pudo resolver responsable o vehículo para ${id}.`)
      task.technicianIds = [technicianId]
      task.technicians = [employee.name]
      task.status = 'Pendiente'
      const record = { ...structuredClone(task), id, sourceTaskId: String(task.taskId), date, scheduledTime: task.time,
        status: 'Pendiente', team: team.label || '', teamId: String(team.teamId || ''), technicianIds: [technicianId], technicians: [employee.name],
        vehicleId, vehicleBrand: vehicle.brand, vehicleModel: vehicle.model, vehiclePlate: vehicle.plate,
        vehicleMileageAtScheduling: vehicle.mileage == null ? null : Number(vehicle.mileage) }
      restored.push(record); historyIds.add(id)
    }
  }
  const expected = config.vehicleAssignments.length * 3
  if (restored.length !== expected) throw new Error(`Se esperaban ${expected} controles pendientes y se encontraron ${restored.length}.`)
  restored.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  next.history.push(...restored)
  return { state: next, records: restored, sourceFingerprint: fingerprint(state) }
}
module.exports = { restoreScheduledVehicleControls }
