const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export const VEHICLE_CONTROL_SERVICE = 'Control semanal de vehículo'
export const VEHICLE_CONTROL_SERVICE_ID = 'vehicle-weekly-control'
export const VEHICLE_CONTROL_SERVICE_CODE = 'vehicle-weekly-control'
export const VEHICLE_CONTROL_ESTIMATED_MINUTES = 15
export const VEHICLE_CONTROL_TIME = '15:30'

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

const previousDate = date => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay()

export const vehicleControlFriday = record => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(record?.vehicleControlScheduledFriday || ''))) return record.vehicleControlScheduledFriday
  return String(record?.id || '').match(/^vehicle-control-(\d{4}-\d{2}-\d{2})-/)?.[1] || record?.date || ''
}

export function vehicleControlOperationalDate(friday, holidays = [], holidayOverrides = {}) {
  const holidayDates = new Set((holidays || []).map(item => String(item?.date || '')).filter(Boolean))
  let candidate = friday
  // Los controles se realizan en una jornada ordinaria de lunes a viernes. Un
  // feriado solamente se salta cuando Administración ya lo definió como cerrado.
  for (let attempts = 0; attempts < 14; attempts += 1) {
    const day = weekday(candidate)
    const configuredHoliday = holidayDates.has(candidate) || Object.prototype.hasOwnProperty.call(holidayOverrides || {}, candidate)
    const closedHoliday = configuredHoliday && holidayOverrides?.[candidate]?.status === 'closed'
    if (day >= 1 && day <= 5 && !closedHoliday) return candidate
    candidate = previousDate(candidate)
  }
  return friday
}

export function rescheduleVehicleControlRecords(records, { holidays = [], holidayOverrides = {} } = {}) {
  return (records || []).map(record => {
    if (!record?.vehicleControl || record.technicalStatus || record.status === 'Completado') return record
    const friday = vehicleControlFriday(record)
    const date = vehicleControlOperationalDate(friday, holidays, holidayOverrides)
    return date === record.date && record.vehicleControlScheduledFriday === friday
      ? record
      : { ...record, date, vehicleControlScheduledFriday: friday }
  })
}

export function buildVehicleControlRecords({ month, assignments, vehicles, technicians, teams, fromDate = '', holidays = [], holidayOverrides = {} }) {
  const byVehicle = new Map((vehicles || []).map(vehicle => [String(vehicle.id), vehicle]))
  const byTechnician = new Map((technicians || []).map(technician => [String(technician.id), technician]))
  return monthFridays(month).flatMap(friday => (assignments || []).map(assignment => {
    const date = vehicleControlOperationalDate(friday, holidays, holidayOverrides)
    if (fromDate && date < fromDate) return null
    const vehicle = byVehicle.get(String(assignment.vehicleId))
    const assignedTechnicianId = assignment.weeklyOverrides?.[friday] || assignment.technicianId
    const technician = byTechnician.get(String(assignedTechnicianId))
    if (!vehicle || !technician) return null
    const teamIndex = (teams || []).findIndex(team => (team.memberIds || []).some(id => String(id) === String(technician.id)))
    const id = vehicleControlId(friday, vehicle.id)
    return {
      id,
      sourceTaskId: id,
      date,
      time: VEHICLE_CONTROL_TIME,
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
