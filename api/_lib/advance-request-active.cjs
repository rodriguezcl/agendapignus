function isAdvanceRequestActive(record, now = Date.now()) {
  if (record?.advanceRequest?.status !== 'pending' || record.startedAt || record.technicalStatus || record.awaitingConfirmation || record.vehicleControl || ['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado'].includes(record.status)) return false
  const instant = new Date(now)
  if (!Number.isFinite(instant.getTime())) return false
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant).map(part => [part.type, part.value]))
  const time = String(record.advanceRequest.scheduledTime || record.originalScheduledTime || record.time || '').slice(0, 5)
  return record.date === `${parts.year}-${parts.month}-${parts.day}` && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && time > `${parts.hour}:${parts.minute}`
}
module.exports = { isAdvanceRequestActive }
