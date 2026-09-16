function startTechnicianServiceRecord(record, user, now = new Date().toISOString()) {
  if (!record) {
    const error = new Error('El servicio no existe.')
    error.statusCode = 404
    throw error
  }
  if (!record.technicianIds?.some(id => String(id) === String(user.id))) {
    const error = new Error('El servicio no está asignado al técnico autenticado.')
    error.statusCode = 403
    throw error
  }
  if (record.vehicleControl) {
    const error = new Error('El control vehicular se completa directamente con foto y kilometraje.')
    error.statusCode = 400
    throw error
  }
  if (record.technicalStatus || ['Completado', 'Cancelado', 'Reprogramado'].includes(record.status)) {
    const error = new Error('El servicio ya fue informado y no puede iniciarse.')
    error.statusCode = 409
    throw error
  }
  if (record.startedAt) return record
  const instant = new Date(now)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const serviceDate = String(record.date || '')
  const scheduledMatch = String(record.time || record.scheduledTime || '').match(/^(\d{1,2}):(\d{2})$/)
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute)
  const scheduledMinutes = scheduledMatch ? Number(scheduledMatch[1]) * 60 + Number(scheduledMatch[2]) : null
  if (serviceDate > today || (serviceDate === today && scheduledMinutes != null && scheduledMinutes > currentMinutes)) {
    const error = new Error('El servicio podrá iniciarse cuando llegue su fecha y hora programadas.')
    error.statusCode = 409
    throw error
  }
  return {
    ...record,
    startedAt: now,
    startedById: user.id,
    startedByName: user.name || user.email || 'Técnico'
  }
}

function assertTechnicianServiceStarted(record) {
  if (!record.vehicleControl && !record.startedAt) {
    const error = new Error('Para marcar el servicio completado primero debés presionar Iniciar servicio.')
    error.statusCode = 409
    throw error
  }
}

module.exports = { startTechnicianServiceRecord, assertTechnicianServiceStarted }
