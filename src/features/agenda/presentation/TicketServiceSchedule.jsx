import React, { useEffect, useRef } from 'react'
import Icon from '../../../components/ui/Icon.jsx'
import './ticket-service-schedule.css'

export default function TicketServiceSchedule({ selection, today, teams, gaps, unavailable, onChange, onClose, onContinue }) {
  const root = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    root.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])
  const keys = event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const controls = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]
    if (event.shiftKey && [root.current, controls[0]].includes(document.activeElement)) { event.preventDefault(); controls.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
  }
  return <div className="modal-layer" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={root} tabIndex={-1} className="modal ticket-service-schedule" role="dialog" aria-modal="true" aria-label="Agendar servicio del ticket" onKeyDown={keys}>
      <button type="button" className="close-modal" aria-label="Cerrar planificación" title="Volvé a la agenda sin crear un servicio." onClick={onClose}><Icon name="close" /></button>
      <p className="eyebrow">Ticket#{selection.ticket.number}</p><h2>Agendar servicio</h2><p>{selection.ticket.title}</p>
      <form onSubmit={event => { event.preventDefault(); onContinue() }}>
        <label>Fecha<input required type="date" min={today} value={selection.day} onChange={event => onChange({ day: event.target.value, teamId: '', startTime: '' })} /></label>
        <label>Equipo<select required disabled={!selection.day || Boolean(unavailable)} value={selection.teamId} onChange={event => onChange({ teamId: event.target.value, startTime: '' })}><option value="">Seleccionar equipo</option>{teams.map(team => <option key={team.teamId} value={team.teamId} disabled={!team.members?.length}>{team.label} · {team.members?.join(' / ') || 'Sin técnicos asignados'}</option>)}</select></label>
        <label>Franja disponible<select required disabled={!selection.teamId || Boolean(unavailable)} value={selection.startTime} onChange={event => onChange({ startTime: event.target.value })}><option value="">Seleccionar franja</option>{gaps.map(gap => <option key={gap.start} value={gap.start}>{gap.start} a {gap.end} hs</option>)}</select></label>
        {unavailable ? <p className="field-error" role="status">{unavailable}</p> : selection.teamId && !gaps.length ? <p role="status">No hay franjas disponibles para ese equipo. Elegí otra fecha o equipo.</p> : <p>En el siguiente paso elegí el tipo de servicio y su duración. Podés ajustar la hora dentro de la disponibilidad.</p>}
        <div className="modal-actions"><button type="button" className="secondary" title="Volvé a la agenda sin crear un servicio." onClick={onClose}>Cancelar</button><button type="submit" className="primary" title="Completá el servicio con los datos de este ticket." disabled={!selection.startTime || Boolean(unavailable)}>Continuar</button></div>
      </form>
    </section>
  </div>
}
