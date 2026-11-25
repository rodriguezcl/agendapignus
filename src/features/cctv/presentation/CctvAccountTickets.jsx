import React, { useEffect, useState } from 'react'
import { requestJson } from '../../../infrastructure/http/json-request.mjs'
import { ticketDate, ticketNumber, ticketStatusLabel } from '../../tickets/ticket-ui.mjs'

const pageSize = 20

export default function CctvAccountTickets({ customerId, onOpenTicket }) {
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ view: 'list', customerId, page, pageSize })
    requestJson(`/api/tickets?${query}`, { signal: controller.signal }, 'No se pudieron cargar los tickets de la cuenta.')
      .then(data => { if (!controller.signal.aborted) setResult(data) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [customerId, page, retry])

  const load = nextPage => {
    setResult(null)
    setError('')
    setPage(nextPage)
    setRetry(value => value + 1)
  }

  return <>
    <h3>Tickets asociados</h3>
    {error ? <div className="cctv-alert" role="alert">{error}
      <button type="button" className="secondary" onClick={() => load(page)}>Reintentar</button>
    </div> : !result ? <p role="status">Cargando tickets de la cuenta…</p> : result.total === 0
      ? <p className="cctv-empty">No hay tickets asociados a esta cuenta disponibles para tu usuario.</p>
      : <>
        <div className="cctv-table-wrap">
          <table className="cctv-table" aria-label="Tickets asociados a la cuenta">
            <thead><tr><th scope="col">Fecha de creación</th><th scope="col">Ticket y asunto</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead>
            <tbody>{result.items.map(ticket => <tr key={ticket.id}>
              <td data-label="Fecha de creación">{ticketDate(ticket.createdAt)}</td>
              <td data-label="Ticket y asunto"><strong>{ticketNumber(ticket)} · {ticket.title}</strong></td>
              <td data-label="Estado">{ticketStatusLabel(ticket)}</td>
              <td><button type="button" className="secondary" aria-label={`Ver ${ticketNumber(ticket)}`} onClick={() => onOpenTicket(ticket.id)}>Ver ticket</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        {(page > 1 || result.total > result.pageSize) && <nav className="cctv-inline-actions" aria-label="Páginas de tickets">
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => load(page - 1)}>Anterior</button>
          <span>Página {page} de {Math.ceil(result.total / result.pageSize)}</span>
          <button type="button" className="secondary" disabled={page * result.pageSize >= result.total} onClick={() => load(page + 1)}>Siguiente</button>
        </nav>}
      </>}
  </>
}
