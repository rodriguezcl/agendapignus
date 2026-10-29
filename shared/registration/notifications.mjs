// Only replace an existing notice when an authorized registration notice covers it.
export function combineRegistrationNotifications(operational, tickets, registrations) {
  const services = new Set(registrations.flatMap(n => [...(n.recordIds || []), n.target?.recordId].filter(Boolean).map(String)))
  const coveredTickets = new Set(registrations.flatMap(n => n.ticketIds || []).map(String))
  return [
    ...operational.filter(n => !(n.id.startsWith('reservation:') && services.has(String(n.target?.recordId || n.id.slice('reservation:'.length))))),
    ...tickets.filter(n => !coveredTickets.has(String(n.target?.ticketId))),
    ...registrations
  ]
}
