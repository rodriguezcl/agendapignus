const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es-AR')

const searchableDate = value => {
  if (!value) return ''
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : `${value} ${parsed.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
}

export function technicianHistorySearchText(record) {
  return normalize([
    record.client,
    record.clientAccount,
    record.clientNameAtService,
    record.service,
    record.detail,
    record.address,
    record.phone,
    record.technicalStatus,
    record.status,
    searchableDate(record.date),
    record.time,
    record.team,
    ...(record.technicians || [])
  ].join(' '))
}

export function filterTechnicianHistory(records, query) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return records
  return records.filter(record => {
    const searchable = technicianHistorySearchText(record)
    return terms.every(term => searchable.includes(term))
  })
}

export function technicianTeamLabel(record) {
  const technicians = [...new Set((record?.technicians || []).map(name => String(name).trim()).filter(Boolean))]
  const team = String(record?.team || '').trim()
  if (!technicians.length) return team || 'Sin técnicos asignados'
  return [team, technicians.join(' / ')].filter(Boolean).join(' · ')
}

export function technicianRecordResolved(record) {
  if (record?.vehicleControl) return record?.technicalStatus === 'Completado' || record?.status === 'Completado'
  return Boolean(record?.technicalStatus || record?.status === 'Completado' || record?.status === 'Cancelado' || record?.status === 'Reprogramado')
}

const nextCalendarDate = value => {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function technicianAgendaServices(records, today) {
  const tomorrow = nextCalendarDate(today)
  return (records || []).filter(record => {
    if (technicianRecordResolved(record)) return false
    const date = String(record?.date || '')
    // La agenda operativa incluye cualquier pendiente vencido y limita el
    // futuro al día siguiente. La misma regla se aplica a controles vehiculares
    // y servicios comunes para que ninguna tarea posterior quede anticipada.
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= tomorrow
  })
}

export function overdueVehicleControls(records, today) {
  return (records || []).filter(record => record?.vehicleControl && record.date < today && !technicianRecordResolved(record))
}

export function blockingOverdueVehicleControl(records, index, today) {
  return (records || []).slice(0, index).find(record => record?.vehicleControl && record.date < today && !technicianRecordResolved(record)) || null
}
