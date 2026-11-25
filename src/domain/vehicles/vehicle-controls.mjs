import controlPause from '../../../api/_lib/vehicle-controls-pause.cjs'
import controlSchedule from '../../../api/_lib/vehicle-control-schedule.cjs'
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export const VEHICLE_CONTROL_SERVICE = 'Control semanal de vehículo'
export const VEHICLE_CONTROL_SERVICE_ID = 'vehicle-weekly-control'
export const VEHICLE_CONTROL_SERVICE_CODE = 'vehicle-weekly-control'
export const VEHICLE_CONTROL_ESTIMATED_MINUTES = 15
export const VEHICLE_CONTROL_TIME = '15:45'

export const vehicleControlService = () => ({
  id: VEHICLE_CONTROL_SERVICE_ID,
  code: VEHICLE_CONTROL_SERVICE_CODE,
  category: 'vehicle-control',
  name: VEHICLE_CONTROL_SERVICE,
  description: 'Control interno de limpieza, fotografía y kilometraje de la flota.',
  estimatedMinutes: VEHICLE_CONTROL_ESTIMATED_MINUTES,
  status: 'Activo',
  system: true
})

export function ensureVehicleControlService(services = []) {
  let found = false
  const next = (services || []).map(service => {
    const matches = service?.code === VEHICLE_CONTROL_SERVICE_CODE || normalize(service?.name) === normalize(VEHICLE_CONTROL_SERVICE)
    if (!matches) return service
    found = true
    return { ...service, ...vehicleControlService() }
  })
  return found ? next : [...next, vehicleControlService()]
}

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

const monthOffset = month => {
  const [year, monthNumber] = String(month || '').split('-').map(Number)
  return Number.isFinite(year) && Number.isFinite(monthNumber) ? year * 12 + monthNumber - 1 : 0
}

export function suggestedVehicleAssignments(vehicles, teams, { month = '', assignmentHistory = [] } = {}) {
  const configuredVehicles = vehicles || []
  const configuredTeams = teams || []
  const soloTechnicianIds = configuredTeams.filter(team => (team.memberIds || []).length === 1).map(team => team.memberIds[0])
  const availableTechnicianIds = configuredTeams.flatMap(team => team.memberIds || []).filter((id, index, all) => all.findIndex(value => String(value) === String(id)) === index)
  const history = (assignmentHistory || []).flat().filter(Boolean)
  const totalCounts = new Map()
  const vehicleCounts = new Map()
  history.forEach(assignment => {
    const technicianId = String(assignment.technicianId || '')
    const vehicleId = String(assignment.vehicleId || '')
    if (!technicianId || !vehicleId) return
    totalCounts.set(technicianId, (totalCounts.get(technicianId) || 0) + 1)
    vehicleCounts.set(`${vehicleId}:${technicianId}`, (vehicleCounts.get(`${vehicleId}:${technicianId}`) || 0) + 1)
  })
  const used = new Set()
  const fordKa = configuredVehicles.find(isFordKa)
  const orderedVehicles = fordKa ? [fordKa, ...configuredVehicles.filter(vehicle => vehicle !== fordKa)] : configuredVehicles
  const offset = monthOffset(month)
  const assignments = orderedVehicles.map((vehicle, vehicleIndex) => {
    const candidateIds = isFordKa(vehicle) && soloTechnicianIds.length ? soloTechnicianIds : availableTechnicianIds
    const candidates = candidateIds.map(id => {
      const index = availableTechnicianIds.findIndex(candidate => String(candidate) === String(id))
      return {
        id,
        used: used.has(String(id)) ? 1 : 0,
        sameVehicle: vehicleCounts.get(`${String(vehicle.id)}:${String(id)}`) || 0,
        total: totalCounts.get(String(id)) || 0,
        rotation: (index - offset - vehicleIndex + availableTechnicianIds.length * 100) % Math.max(1, availableTechnicianIds.length)
      }
    }).sort((a, b) => a.used - b.used || a.sameVehicle - b.sameVehicle || a.total - b.total || a.rotation - b.rotation)
    const technicianId = candidates[0]?.id || ''
    if (technicianId) used.add(String(technicianId))
    return { vehicleId: vehicle.id, technicianId }
  })
  return configuredVehicles.map(vehicle => assignments.find(item => String(item.vehicleId) === String(vehicle.id)))
}

export const vehicleControlId = (date, vehicleId) => `vehicle-control-${date}-${vehicleId}`

export const vehicleControlFriday = controlSchedule.vehicleControlFriday
export const vehicleControlSchedule = controlSchedule.vehicleControlSchedule

export function vehicleControlOperationalDate(friday, holidays = [], holidayOverrides = {}) {
  return vehicleControlSchedule(friday, { _holidayOverrides: holidayOverrides }).date
}

export function rescheduleVehicleControlRecords(records, { holidays = [], weekly = {}, holidayOverrides = weekly._holidayOverrides || {}, fromDate = '' } = {}) {
  if (controlPause.vehicleControlsPaused(weekly)) return records || []
  return (records || []).map(record => {
    if (!record?.vehicleControl || (fromDate && record.date < fromDate) || record.startedAt || record.completedAt || record.technicalStatus || record.technicalReportedAt || ['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(record.status)) return record
    const friday = vehicleControlFriday(record)
    const schedule = vehicleControlSchedule(friday, { ...weekly, _holidayOverrides: holidayOverrides }, record.teamId)
    return schedule.date === record.date && schedule.time === record.time && record.vehicleControlScheduledFriday === friday
      ? record
      : { ...record, ...schedule, vehicleControlScheduledFriday: friday }
  })
}

export function buildVehicleControlRecords({ month, assignments, vehicles, technicians, teams, fromDate = '', holidays = [], weekly = {}, holidayOverrides = weekly._holidayOverrides || {} }) {
  if (controlPause.vehicleControlsPaused(weekly)) return []
  const byVehicle = new Map((vehicles || []).map(vehicle => [String(vehicle.id), vehicle]))
  const byTechnician = new Map((technicians || []).map(technician => [String(technician.id), technician]))
  return monthFridays(month).flatMap(friday => (assignments || []).map(assignment => {
    if (fromDate && friday < fromDate) return null
    const vehicle = byVehicle.get(String(assignment.vehicleId))
    const assignedTechnicianId = assignment.weeklyOverrides?.[friday] || assignment.technicianId
    const technician = byTechnician.get(String(assignedTechnicianId))
    if (!vehicle || !technician) return null
    const teamIndex = (teams || []).findIndex(team => (team.memberIds || []).some(id => String(id) === String(technician.id)))
    const schedule = vehicleControlSchedule(friday, { ...weekly, _holidayOverrides: holidayOverrides }, teams?.[teamIndex]?.teamId)
    if (fromDate && schedule.date < fromDate) return null
    const id = vehicleControlId(friday, vehicle.id)
    return {
      id,
      sourceTaskId: id,
      date: schedule.date,
      time: schedule.time,
      serviceId: VEHICLE_CONTROL_SERVICE_ID,
      service: VEHICLE_CONTROL_SERVICE,
      estimatedMinutes: VEHICLE_CONTROL_ESTIMATED_MINUTES,
      estimatedMinutesCustomized: false,
      client: vehicleLabel(vehicle),
      address: '',
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
      vehicleControlScheduledFriday: friday,
      monthlyVehicleAssignment: month
    }
  }).filter(Boolean))
}

export function vehicleControlTask(record) {
  return {
    taskId: record.sourceTaskId || record.id,
    historyId: record.id,
    time: record.time,
    serviceId: record.serviceId || VEHICLE_CONTROL_SERVICE_ID,
    service: record.service,
    estimatedMinutes: record.estimatedMinutes || VEHICLE_CONTROL_ESTIMATED_MINUTES,
    estimatedMinutesCustomized: false,
    client: record.client,
    address: record.address,
    phone: record.phone,
    detail: record.detail,
    vehicleControl: true,
    vehicleId: record.vehicleId,
    technicianIds: record.technicianIds || [],
    technicians: record.technicians || [],
    vehicleControlScheduledFriday: vehicleControlFriday(record),
    monthlyVehicleAssignment: record.monthlyVehicleAssignment
  }
}
