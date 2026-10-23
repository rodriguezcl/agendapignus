import React from 'react'
import { ticketDate } from './ticket-ui.mjs'
import './ticket-sla.css'

const resolutionLabel = target => ({ overdue: 'Resolución vencida', met: 'Resuelto en plazo', late: 'Resuelto fuera de plazo', pending: 'Resolución objetivo' })[target?.status] || 'Resolución objetivo'
const targetLabel = (kind, target) => kind === 'resolution' ? resolutionLabel(target) : ({
  firstResponse: { overdue: 'Primera respuesta vencida', pending: 'Primera respuesta pendiente', met: 'Primera respuesta en plazo', late: 'Primera respuesta fuera de plazo', unanswered: 'Sin respuesta humana registrada' },
  update: { overdue: 'Sin novedades · revisar el caso', pending: 'Próximo aviso sin novedades', met: 'Seguimiento finalizado', late: 'Seguimiento finalizado' }
})[kind]?.[target?.status] || ''

export default function TicketSlaSummary({ summary, compact = false }) {
  if (!summary || summary.status === 'not-started') return compact ? null : <p className="tickets-muted">Los plazos de este caso comenzarán cuando se active su seguimiento de SLA.</p>
  if (summary.status === 'excluded') return compact ? null : <p className="tickets-muted">Caso cerrado antes de activar el SLA; no se evalúan plazos anteriores.</p>
  if (compact) return <span className={`tickets-sla-compact tickets-sla-${summary.resolution.status}`}><span>{resolutionLabel(summary.resolution)}</span><time dateTime={summary.resolution.dueAt}>{ticketDate(summary.resolution.dueAt)}</time>{summary.status !== 'closed' && summary.firstResponse.status === 'overdue' && <span>Primera respuesta vencida</span>}{summary.status !== 'closed' && summary.update.status === 'overdue' && <span>Sin novedades · revisar</span>}</span>
  return <section className="tickets-sla-detail" aria-label="Plazos de atención del ticket"><div className="tickets-section-heading"><h3>SLA · plazos de atención</h3>{summary.cycle > 1 && <span className="tickets-muted">Ciclo {summary.cycle}</span>}</div><dl className="tickets-sla-targets">
    {['firstResponse', 'resolution', 'update'].map(kind => { const target = summary[kind]; if (!target) return null; return <div key={kind} className={`tickets-sla-target tickets-sla-${target.status}`}><dt>{targetLabel(kind, target)}</dt><dd><time dateTime={target.dueAt}>{ticketDate(target.dueAt)}</time>{target.completedAt && kind !== 'update' && <small>Registrado: <time dateTime={target.completedAt}>{ticketDate(target.completedAt)}</time></small>}</dd></div> })}
  </dl><p className="tickets-muted">Horas corridas. La espera y la coordinación de una visita no detienen ni reinician el plazo de resolución.{summary.adoptedAt && ` Seguimiento iniciado el ${ticketDate(summary.adoptedAt)}.`}</p></section>
}

export function TicketServiceSchedule({ ticket, compact = false }) {
  const services = Array.isArray(ticket.serviceSchedule) ? ticket.serviceSchedule : ticket.serviceSchedule ? [ticket.serviceSchedule] : []
  const pending = services.filter(service => !['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado'].includes(service.status))
  if (compact) return pending.length ? <span className="tickets-service-scheduled">Servicio programado</span> : null
  if (!services.length && !ticket.resolvedByServiceId) return null
  return <section className="tickets-service-schedule" aria-label="Servicios vinculados al ticket"><h3>Servicios del caso</h3>{services.length > 0 && <ul>{services.map((service, index) => <li key={service.id || service.serviceId || index}><div><strong>{service.service || service.label || 'Visita técnica'}</strong><span>{service.date ? service.date.split('-').reverse().join('/') : 'Fecha por coordinar'}{service.time ? ` · ${service.time} hs` : ''}{service.team ? ` · ${service.team}` : ''}</span></div><span className="tickets-status">{service.status || 'Programado'}</span></li>)}</ul>}{ticket.resolvedByServiceId && <p className="tickets-feedback">La resolución de este ticket quedó respaldada por el informe del servicio completado.</p>}</section>
}
