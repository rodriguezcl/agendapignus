import { customerLinkPatch } from './customer-linking.mjs'
import suggestion from '../../../../api/_lib/ticket-service-suggestion.cjs'
import { normalizeServiceEstimatedMinutes } from '../../../domain/agenda/service-scheduling.mjs'

export function suggestedServiceForTicket(ticket, services = []) {
  return services.find(service => String(service.id) === String(ticket?.suggestedServiceId || '') && suggestion.eligibleService(service)) || null
}

export function ticketReferenceDetail(detail, number) {
  const value = String(detail || '').trim()
  const reference = /^\d+$/.test(String(number || '')) ? `Ticket#${number}` : ''
  if (!reference || new RegExp(`Ticket#${number}(?!\\d)`, 'i').test(value)) return value
  return `${reference}${value ? ` · ${value}` : ''}`
}

export function ticketServiceDraft(ticket, customers, user, services = []) {
  if (!ticket?.id || !/^\d+$/.test(String(ticket.number || ''))) throw new Error('No se pudo identificar el ticket. Volvé a abrirlo antes de agendar.')
  if (['Resuelto', 'Fusionado'].includes(ticket.status)) throw new Error('El ticket ya no está abierto. Revisá su estado antes de agendar.')
  const customer = customers.find(item => String(item.customerId) === String(ticket.customerId || ''))
  if (!customer) throw new Error('Primero vinculá el ticket a un abonado o cliente disponible en la agenda.')
  const service = suggestedServiceForTicket(ticket, services)
  return {
    ...customerLinkPatch(null, customer, user),
    ...(service ? { serviceId: service.id, service: service.name, serviceTypes: [{ id: service.id, name: service.name }], estimatedMinutes: normalizeServiceEstimatedMinutes(service.estimatedMinutes), estimatedMinutesCustomized: false } : {}),
    ...(ticket.registrationForm?.confirmedAt ? { form: 'Completo', formEmail: ticket.registrationForm.email, installationZone: ticket.registrationForm.kind } : {}),
    sourceTicketId: String(ticket.id), ticketNumber: String(ticket.number),
    detail: ticketReferenceDetail([ticket.title, ticket.description].filter(Boolean).join('\n\n'), ticket.number)
  }
}

export function ticketLinkFields(task, record) {
  const sourceTicketId = record?.sourceTicketId || task?.sourceTicketId
  const ticketNumber = record?.ticketNumber || task?.ticketNumber
  return sourceTicketId ? { sourceTicketId: String(sourceTicketId), ticketNumber: String(ticketNumber || '') } : {}
}
