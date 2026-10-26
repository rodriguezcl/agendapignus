import React from 'react'
import { TICKET_PRIORITIES } from './ticket-ui.mjs'
import './ticket-sla.css'

export function initialSlaConfig() {
  return { clock: 'business', priorities: {
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
    <div className="tickets-sla-table-scroll"><table className="tickets-sla-table"><thead><tr><th scope="col">Prioridad</th><th scope="col">Primera respuesta <small>Minutos laborales</small></th><th scope="col">Resolución efectiva <small>Horas laborales</small></th><th scope="col">Aviso sin novedades <small>Horas laborales</small></th></tr></thead><tbody>
      {TICKET_PRIORITIES.map(priority => <tr key={priority}><th scope="row"><span className={`tickets-priority tickets-priority--${priority.toLowerCase()}`}>{priority}</span></th>
        {[['firstResponseMinutes', 'Primera respuesta', 1], ['resolutionMinutes', 'Resolución efectiva', 60], ['updateMinutes', 'Aviso sin novedades', 60]].map(([key, label, scale]) => <td key={key}><input type="number" inputMode="decimal" required min={scale === 1 ? 1 : 0.25} max={525600 / scale} step={scale === 1 ? 1 : 0.25} disabled={disabled} aria-label={`${label}, prioridad ${priority}, ${scale === 1 ? 'minutos' : 'horas'}`} value={config.priorities[priority][key] === '' ? '' : config.priorities[priority][key] / scale} onChange={event => change(priority, key, event.target.value, scale)} /></td>)}
      </tr>)}
    </tbody></table></div>
    <div className="tickets-sla-rules"><p><strong>Solo se cuentan horas laborales, según la jornada de los técnicos.</strong> Desde el ingreso, incluyendo el almuerzo; sábados hasta las 12:00. Domingos y feriados no consumen plazo ni generan nuevos avisos SLA.</p>{config.calendar?.weekdays && <p>{['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'].map((day,index)=>`${day}: ${config.calendar.weekdays[index+1]?.start}–${config.calendar.weekdays[index+1]?.end}`).join(' · ')}. La jornada se administra en Configuración → Jornada laboral.</p>}<p>El estado «En espera» no pausa el tiempo laboral. Agendar una visita no reinicia el plazo. Cada ticket conserva sus objetivos y jornada; los cambios posteriores se aplican a nuevos casos. Cambiar la prioridad recalcula desde el inicio del ciclo. Una reapertura conserva los ciclos anteriores.</p><p>El aviso sin novedades se dirige al equipo responsable. El acuse de recepción no cuenta como respuesta humana.</p></div>
  </section>
}
