import React, { useEffect, useRef } from 'react'
import Icon from '../../../components/ui/Icon.jsx'
import './ticket-service-schedule.css'

export default function TicketServiceSchedule({ selection, suggestedService, today, gaps, unavailable, onChange, onClose, onContinue }) {
  const root = useRef(null)
  const optionKey = gap => JSON.stringify([String(gap.teamId), gap.start])
  const selected = gaps.find(gap => String(gap.teamId) === String(selection.teamId) && gap.start === selection.startTime)
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
      {suggestedService && <p><b>Servicio sugerido:</b> {suggestedService.name}. Podés cambiarlo en el siguiente paso.</p>}
      <form onSubmit={event => { event.preventDefault(); onContinue() }}>
        <label>Fecha<input required type="date" min={today} value={selection.day} onChange={event => onChange({ day: event.target.value, teamId: '', startTime: '' })} /></label>
        <label>Franja disponible<select required disabled={!selection.day || Boolean(unavailable) || !gaps.length} value={selected ? optionKey(selected) : ''} onChange={event => { const gap = gaps.find(item => optionKey(item) === event.target.value); onChange({ teamId: gap?.teamId || '', startTime: gap?.start || '' }) }}><option value="">Seleccionar franja</option>{gaps.map(gap => <option key={optionKey(gap)} value={optionKey(gap)}>{gap.start} hs a {gap.end} hs - {gap.teamLabel} · {gap.members.join(' / ')}</option>)}</select></label>
        {unavailable ? <p className="field-error" role="status">{unavailable}</p> : !gaps.length ? <p role="status">No hay franjas disponibles para la fecha seleccionada. Elegí otra fecha.</p> : <p>En el siguiente paso {suggestedService ? 'revisá' : 'elegí'} el tipo de servicio y su duración. Podés ajustar la hora dentro de la disponibilidad.</p>}
        <div className="modal-actions"><button type="button" className="secondary" title="Volvé a la agenda sin crear un servicio." onClick={onClose}>Cancelar</button><button type="submit" className="primary" title="Completá el servicio con los datos de este ticket." disabled={!selected || Boolean(unavailable)}>Continuar</button></div>
      </form>
    </section>
  </div>
}
