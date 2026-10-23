import React from 'react'
import { TICKET_PRIORITIES } from './ticket-ui.mjs'
import './ticket-sla.css'

export function initialSlaConfig() {
  return { clock: 'elapsed', priorities: {
    'Crítica': { firstResponseMinutes: 15, resolutionMinutes: 240, updateMinutes: 60 },
    Alta: { firstResponseMinutes: 60, resolutionMinutes: 1440, updateMinutes: 240 },
    Media: { firstResponseMinutes: 240, resolutionMinutes: 4320, updateMinutes: 1440 },
    Baja: { firstResponseMinutes: 480, resolutionMinutes: 7200, updateMinutes: 2880 }
  } }
}

export default function TicketSlaSettings({ value, disabled, onChange }) {
  const config = value || initialSlaConfig()
  const change = (priority, key, text, scale) => onChange({ ...config, priorities: { ...config.priorities, [priority]: { ...config.priorities[priority], [key]: text === '' ? '' : Math.round(Number(text) * scale) } } })
  return <section className="tickets-settings-section tickets-sla-settings" aria-labelledby="tickets-sla-title">
    <div><h3 id="tickets-sla-title">SLA · plazos de atención</h3><p className="tickets-sla-intro">Definí cuándo debe darse la primera respuesta, resolverse el caso y avisarse al responsable si no hay novedades.</p></div>
    <div className="tickets-sla-table-scroll"><table className="tickets-sla-table"><thead><tr><th scope="col">Prioridad</th><th scope="col">Primera respuesta <small>Minutos</small></th><th scope="col">Resolución efectiva <small>Horas</small></th><th scope="col">Aviso sin novedades <small>Horas</small></th></tr></thead><tbody>
      {TICKET_PRIORITIES.map(priority => <tr key={priority}><th scope="row"><span className={`tickets-priority tickets-priority--${priority.toLowerCase()}`}>{priority}</span></th>
        {[['firstResponseMinutes', 'Primera respuesta', 1], ['resolutionMinutes', 'Resolución efectiva', 60], ['updateMinutes', 'Aviso sin novedades', 60]].map(([key, label, scale]) => <td key={key}><input type="number" inputMode="decimal" required min={scale === 1 ? 1 : 0.25} max={525600 / scale} step={scale === 1 ? 1 : 0.25} disabled={disabled} aria-label={`${label}, prioridad ${priority}, ${scale === 1 ? 'minutos' : 'horas'}`} value={config.priorities[priority][key] === '' ? '' : config.priorities[priority][key] / scale} onChange={event => change(priority, key, event.target.value, scale)} /></td>)}
      </tr>)}
    </tbody></table></div>
    <div className="tickets-sla-rules"><p><strong>Horas corridas, las 24 horas, todos los días.</strong> El estado «En espera» no detiene el plazo. Agendar una visita tampoco lo reinicia.</p><p>Los cambios se aplican a nuevos tickets. Cada caso conserva sus reglas; cambiar su prioridad recalcula el vencimiento desde el inicio del mismo ciclo. Una reapertura inicia un nuevo ciclo y conserva los anteriores.</p><p>El aviso sin novedades se dirige al equipo responsable para que revise el caso y dé una respuesta concreta. El acuse de recepción no cuenta como respuesta humana.</p></div>
  </section>
}
