const permissions = require('./permission-catalog.cjs')

function sanitizeTechnicianFollowup(record, user) {
  if (!record || permissions.roleCode(user) !== 'technician') return record
  const userId = String(user?.id ?? '')
  const own = userId && [record.followup?.createdById, record.followup?.assigneeId]
    .some(value => value != null && String(value) === userId)
  let visible = record
  if (record.followup && !own) {
    const { followup, ...rest } = record
    visible = { ...rest, hasFollowup: true }
  }
  // El historial del cliente puede incluir otras visitas; sus referencias no
  // conceden acceso al reclamo que debe atender otro técnico.
  if (!(record.technicianIds || []).some(value => userId && String(value) === userId)) {
    const { sourceTicketId, ticketNumber, ticketResolution, ...rest } = visible
    visible = rest
  }
  return visible
}

module.exports = { sanitizeTechnicianFollowup }
