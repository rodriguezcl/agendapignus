const localDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
function resolved(record) {
  if (['Cancelado', 'Reprogramado'].includes(record?.status)) return true
  if (record?.vehicleControl) return record.technicalStatus === 'Completado' || record.status === 'Completado'
  if (record?.status === 'Requiere revisión' && record.technicianRequest === 'Reprogramación solicitada') return true
  return Boolean(record?.technicalStatus || ['Completado', 'Avance registrado'].includes(record?.status))
}
function cutoff(records = [], user, today = localDate(), weekly = {}) {
  return records.filter(record => (!user || record.technicianIds?.some(id => String(id) === String(user.id)))
    && !require('./vehicle-controls-pause.cjs').pausedVehicleControl(record, weekly) && !record.awaitingConfirmation && !resolved(record) && /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') && record.date <= today)
    .map(record => record.date).sort()[0] || ''
}
const visible = (record, date) => !date || !record.date || record.date <= date
module.exports = { cutoff, visible, resolved }
