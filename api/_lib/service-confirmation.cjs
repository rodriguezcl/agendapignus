function assertServiceConfirmationChange(previous, next, now = new Date()) {
  const before = previous?.awaitingConfirmation === true, after = next?.awaitingConfirmation === true
  if (before === after) {
    if (after && (next.startedAt || ['Completado', 'Avance registrado'].includes(next.status))) throw new Error('Confirmá el servicio antes de iniciarlo o completarlo.')
    return
  }
  const source = previous || next
  if (source.vehicleControl || source.startedAt || source.completedAt || source.technicalStatus || source.technicianRequest || ['Completado', 'Avance registrado', 'Cancelado', 'Reprogramado', 'Requiere revisión'].includes(source.status)) throw new Error('Este servicio no admite cambiar su confirmación.')
  const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  if (String(next.date || '') < today) throw new Error('El día del servicio ya pasó. Reprogramalo antes de confirmarlo.')
}
function assertServiceConfirmed(record) {
  if (record?.awaitingConfirmation === true) throw Object.assign(new Error('El servicio está pendiente de confirmación del cliente.'), { statusCode: 409 })
}
module.exports = { assertServiceConfirmationChange, assertServiceConfirmed }
