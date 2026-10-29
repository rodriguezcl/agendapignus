import React, {useEffect, useState} from 'react'
import {requestJson} from '../../infrastructure/http/json-request.mjs'
import {usePermissions} from '../../presentation/contexts/permissions-context.jsx'
import RegistrationFormPanel from '../tickets/RegistrationFormPanel.jsx'
import '../tickets/tickets.css'

export default function LegacyRegistration({item, onOpenService, onOpenTicket, onBusyChange, onChanged}) {
  const {can}=usePermissions()
  const [ticketId,setTicketId]=useState(item.tickets?.find(t=>t.status!=='Resuelto')?.id || item.tickets?.[0]?.id || '')
  const [ticket,setTicket]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false)
  useEffect(()=>{let live=true;setTicket(null);setError('');if(ticketId)requestJson('/api/tickets?'+new URLSearchParams({id:ticketId})).then(data=>{if(live)setTicket(data.ticket)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[ticketId,retry])
  return <div className="legacy-registration">
    <p><strong>{item.client}</strong></p>
    <p>Origen: Google / registro anterior. Las respuestas completas siguen en Google; no se importaron al sistema.</p>
    {item.email&&<p>Correo del formulario: <strong>{item.email}</strong></p>}
    {item.match==='email'&&<p role="status">Coincidencia única de correo y tipo de formulario. Verificá la instalación y confirmá la vinculación; todavía no se modificó el ticket.</p>}
    {item.status==='cancelled'?<p>La instalación está cancelada. El registro se conserva como historial.</p>:item.status==='reviewed'?<p>{item.serviceId?'El formulario está registrado y la instalación tiene una cuenta vinculada.':'El aviso de Google fue resuelto. Consultá su historial para revisar la gestión.'}</p>:<p>La gestión seguirá pendiente hasta vincular el formulario con la instalación y completar la vinculación del PIG.</p>}
    {item.tickets?.length>1&&<label>Aviso de Google<select disabled={busy} value={ticketId} onChange={e=>setTicketId(e.target.value)}>{item.tickets.map(t=><option key={t.id} value={t.id}>Ticket#{t.number} · {t.status}</option>)}</select></label>}
    {error&&<p role="alert">{error} <button type="button" className="secondary" onClick={()=>setRetry(n=>n+1)}>Reintentar</button></p>}
    {ticketId&&!ticket&&!error&&<p role="status">Consultando aviso…</p>}
    {ticket&&item.status!=='cancelled'&&<RegistrationFormPanel key={ticket.id+':'+ticket.version} ticket={ticket} suggestedServiceId={item.serviceId} can={can} onBusyChange={value=>{setBusy(value);onBusyChange?.(value)}} onSaved={()=>{setRetry(n=>n+1);window.dispatchEvent(new Event('registration-changed'));onChanged?.()}} />}
    <div className="forms-inbox-actions">
      {item.serviceId&&onOpenService&&<button type="button" disabled={busy} className="secondary" onClick={()=>onOpenService(item.serviceId)}>Ver instalación / vincular PIG</button>}
      {ticketId&&onOpenTicket&&<button type="button" disabled={busy} className="secondary" onClick={()=>onOpenTicket(ticketId)}>Ver historial del ticket</button>}
    </div>
  </div>
}
