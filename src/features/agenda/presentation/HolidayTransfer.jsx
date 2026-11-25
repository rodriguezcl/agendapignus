import Icon from '../../../components/ui/Icon.jsx'
import React, { useState } from 'react'
import { usePermissions } from '../../../presentation/contexts/permissions-context.jsx'
import { transferHoliday } from '../../../domain/agenda/holidays.mjs'
import { currentLocalDate } from '../../../presentation/formatting.mjs'
export default function HolidayTransfer({ holiday, decision, persist, user, onNotice, history }) {
 const { can } = usePermissions()
 const [open,setOpen]=useState(false), [date,setDate]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('')
 if (!can('weekly.holidays') || !persist || holiday.date < currentLocalDate()) return null
 if (decision?.transferredTo) return <p className="holiday-transfer">Feriado trasladado al {decision.transferredTo.split('-').reverse().join('/')}.</p>
 const count=(history||[]).filter(r=>r.date===date&&!['Cancelado','Completado','Avance registrado','Reprogramado'].includes(r.status)).length
 async function submit(event){event.preventDefault();setBusy(true);setError('');try{await persist(snapshot=>transferHoliday(snapshot,{from:holiday.date,to:date,holiday,user,today:currentLocalDate()}));setOpen(false);onNotice('Feriado trasladado. La fecha original quedó laboral y la nueva no operativa. Los controles vehiculares pendientes se ajustaron al día y horario reglamentarios. Los demás servicios se conservaron; revisalos en Historial.')}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <>{!open?<button type="button" className="secondary holiday-transfer" onClick={()=>setOpen(true)}><Icon name="calendar" size={16} />Trasladar feriado</button>:<form className="holiday-transfer" onSubmit={submit}>
 <label>Nueva fecha del feriado<input required type="date" min={currentLocalDate()} value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
 <p>La fecha original quedará laboral y la nueva fecha se bloqueará. Los controles vehiculares pendientes se ajustarán al día y horario reglamentarios. Los demás servicios ya agendados no se mueven ni se cancelan.</p>
 {count>0&&<p role="status">Hay {count} servicio(s) pendiente(s) en la fecha elegida. Revisalos en Historial.</p>}
 {error&&<p role="alert" className="field-error">{error}</p>}
 <div className="holiday-decision-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancelar</button><button type="submit" className="primary" disabled={busy||!date}>{busy?'Guardando…':'Confirmar traslado'}</button></div></form>}</>
}
