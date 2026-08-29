const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export const VEHICLE_CONTROL_SERVICE = 'Control semanal de vehículo'
export const VEHICLE_CONTROL_TIME = '15:30'

export const vehicleLabel = vehicle => {
  const brand = vehicle?.brand || vehicle?.vehicleBrand
  const model = vehicle?.model || vehicle?.vehicleModel
  const plate = vehicle?.plate || vehicle?.vehiclePlate
  return [brand, model, plate && `· ${plate}`].filter(Boolean).join(' ')
}

export const monthFridays = month => {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return []
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1, 1, 12)
  const dates = []
  while (date.getMonth() === monthNumber - 1) {
    if (date.getDay() === 5) dates.push(`${month}-${String(date.getDate()).padStart(2, '0')}`)
    date.setDate(date.getDate() + 1)
  }
  return dates
}

export const isFordKa = vehicle => normalize(vehicle?.brand).includes('ford') && /(^|\s)ka($|\s)/.test(normalize(vehicle?.model))

export function suggestedVehicleAssignments(vehicles, teams) {
  const configuredVehicles = vehicles || []
  const configuredTeams = teams || []
  const soloTechnicianId = configuredTeams.find(team => (team.memberIds || []).length === 1)?.memberIds?.[0]
  const availableTechnicianIds = configuredTeams.flatMap(team => team.memberIds || []).filter((id, index, all) => all.findIndex(value => String(value) === String(id)) === index)
  const used = new Set()
  const fordKa = configuredVehicles.find(isFordKa)
  const orderedVehicles = fordKa ? [fordKa, ...configuredVehicles.filter(vehicle => vehicle !== fordKa)] : configuredVehicles
  const assignments = orderedVehicles.map(vehicle => {
    let technicianId = isFordKa(vehicle) && soloTechnicianId ? soloTechnicianId : availableTechnicianIds.find(id => !used.has(String(id)) && String(id) !== String(soloTechnicianId || ''))
    if (!technicianId) technicianId = availableTechnicianIds.find(id => !used.has(String(id))) || ''
    if (technicianId) used.add(String(technicianId))
    return { vehicleId: vehicle.id, technicianId }
  })
  return configuredVehicles.map(vehicle => assignments.find(item => String(item.vehicleId) === String(vehicle.id)))
}

export const vehicleControlId = (date, vehicleId) => `vehicle-control-${date}-${vehicleId}`

export function buildVehicleControlRecords({ month, assignments, vehicles, technicians, teams, fromDate = '' }) {
  const byVehicle = new Map((vehicles || []).map(vehicle => [String(vehicle.id), vehicle]))
  const byTechnician = new Map((technicians || []).map(technician => [String(technician.id), technician]))
  return monthFridays(month).filter(date => !fromDate || date >= fromDate).flatMap(date => (assignments || []).map(assignment => {
    const vehicle = byVehicle.get(String(assignment.vehicleId))
    const technician = byTechnician.get(String(assignment.technicianId))
    if (!vehicle || !technician) return null
    const teamIndex = (teams || []).findIndex(team => (team.memberIds || []).some(id => String(id) === String(technician.id)))
    const id = vehicleControlId(date, vehicle.id)
    return {
      id,
      sourceTaskId: id,
      date,
      time: VEHICLE_CONTROL_TIME,
      service: VEHICLE_CONTROL_SERVICE,
      client: vehicleLabel(vehicle),
      address: 'Flota de la empresa',
      phone: '',
      detail: 'Cargar una foto del interior del vehículo e informar el kilometraje actualizado.',
      status: 'Pendiente',
      team: teamIndex >= 0 ? (teams[teamIndex].label || `Equipo ${teamIndex + 1}`) : 'Responsable de vehículo',
      teamId: teamIndex >= 0 ? teams[teamIndex].teamId : '',
      technicianIds: [technician.id],
      technicians: [technician.name],
      vehicleControl: true,
      vehicleId: vehicle.id,
      vehicleBrand: vehicle.brand,
      vehicleModel: vehicle.model,
      vehiclePlate: vehicle.plate,
      vehicleMileageAtScheduling: vehicle.mileage == null ? null : Number(vehicle.mileage),
      monthlyVehicleAssignment: month
    }
  }).filter(Boolean))
}

export function vehicleControlTask(record) {
  return {
    taskId: record.sourceTaskId || record.id,
    historyId: record.id,
    time: record.time,
    service: record.service,
    client: record.client,
    address: record.address,
    phone: record.phone,
    detail: record.detail,
    vehicleControl: true,
    vehicleId: record.vehicleId,
    monthlyVehicleAssignment: record.monthlyVehicleAssignment
  }
}
