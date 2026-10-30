import React, { useEffect, useRef, useState } from 'react'
import { usePermissions } from '../presentation/contexts/permissions-context.jsx'
import { requestJson } from '../infrastructure/http/json-request.mjs'
import './installation-experience-mail.css'
const labels={verified:'Envío confirmado manualmente',queued:'Pendiente de envío',retry:'Reintento programado',sending:'Enviando',sent:'Enviado al servidor de correo',needs_email:'Falta el correo del cliente',failed:'Envío rechazado o fallido',uncertain:'Entrega sin confirmar: requiere revisión',cancelled:'No enviado: instalación sin cierre vigente'}
const date=value=>value?new Date(value).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}):''
function WhatsAppItem({item,active,canManage,onSaved,onBusyChange}) {
  const [verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const saving=useRef(false)
  const review=async event=>{
    event.preventDefault();if(saving.current||!verified)return
    saving.current=true;setBusy(true);setError('');onBusyChange?.(true)
    try {
      await requestJson('/api/customers/experience-mail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,updatedAt:item.updatedAt,action:'review-whatsapp',verified:true})})
      window.dispatchEvent(new Event('experience-mail-changed'));onSaved()
    }catch(failure){setError(failure.message||'No se pudo finalizar la revisión.')}
    finally{saving.current=false;setBusy(false);onBusyChange?.(false)}
  }
  const status={queued:'Pendiente de envío',retry:'Reintento programado',sending:'Comunicando con GoHighLevel',accepted:'Recibido por GoHighLevel · flujo en curso',processed:'Flujo finalizado · entrega por verificar',reviewed:'Revisión finalizada · sin reenvío',needs_phone:'Falta un teléfono válido del cliente',failed:'Solicitud rechazada',uncertain:'Recepción sin confirmar · requiere revisión',draft:'Flujo de GoHighLevel en borrador',cancelled:'Aviso descartado: la visita cambió o ya no está confirmada'}
  return <article className="experience-mail-item">
    <h4>{item.kind==='experience'?'WhatsApp · Experiencia y reseña de la instalación':'WhatsApp · Confirmación de visita técnica'}</h4><strong>{item.kind==='experience'&&item.status==='cancelled'?'Aviso descartado: instalación sin cierre vigente':status[item.status]||item.status}</strong>
    <p>{item.account} · {item.client}</p>
    <dl><div><dt>Teléfono</dt><dd>{item.recipient||'Sin registrar'}</dd></div><div><dt>Aviso generado</dt><dd>{date(item.createdAt)}</dd></div>{item.sentAt&&<div><dt>Recibido por GoHighLevel</dt><dd>{date(item.sentAt)}</dd></div>}</dl>
    {item.error&&<p role="status">{item.error}</p>}
    {['accepted','processed'].includes(item.status)&&<p>Consultá la conversación en GoHighLevel para comprobar si WhatsApp entregó el mensaje.</p>}
    {item.status==='needs_phone'&&<p>Corregí el contacto del servicio con un número válido y código de área. Se programará el aviso al guardar.</p>}
    {!active&&['queued','retry'].includes(item.status)&&<p>El canal de WhatsApp está pausado.</p>}
    {['uncertain','failed','draft'].includes(item.status)&&<p>Revisá el historial del flujo en GoHighLevel antes de contactar al cliente nuevamente.</p>}
    {item.status==='uncertain'&&canManage&&<form onSubmit={review}>
      <label className="experience-mail-verify"><input type="checkbox" checked={verified} disabled={busy} onChange={event=>setVerified(event.target.checked)}/>Revisé GoHighLevel: este flujo terminó o fue detenido.</label>
      <p>Finalizar la revisión libera los próximos avisos del contacto. No reenvía este mensaje ni lo marca como entregado.</p>
      {error&&<p role="alert">{error}</p>}
      <button type="submit" className="secondary" disabled={busy||!verified} title="Registrá la revisión y permití procesar los próximos avisos de este contacto.">{busy?'Guardando…':'Finalizar revisión'}</button>
    </form>}
  </article>
}
function MailItem({item,active,onSaved,onBusyChange,canManage}) {
  const [email,setEmail]=useState(item.recipient||''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[verified,setVerified]=useState(false)
  const saving=useRef(false)
  const submit=async event=>{
    event.preventDefault();if(saving.current)return
    saving.current=true;setBusy(true);onBusyChange?.(true);setError('')
    try {
      await requestJson('/api/customers/experience-mail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,updatedAt:item.updatedAt,email,...(item.status==='uncertain'?{action:'confirm-sent',verified}:{})})})
      window.dispatchEvent(new Event('experience-mail-changed'));onSaved()
    }catch(failure){setError(failure.message||'No se pudo guardar el correo.')}
    finally{saving.current=false;setBusy(false);onBusyChange?.(false)}
  }
  return <article className="experience-mail-item">
    <h4>{item.kind==='appointment'?'Correo · Confirmación de visita técnica':item.kind==='registration'?'Confirmación de alta y vinculación PIG':'Invitación a compartir la experiencia'}</h4><strong>{item.kind==='appointment'&&item.status==='cancelled'?'No enviado: la visita cambió o ya no está confirmada':item.kind==='registration'&&item.status==='cancelled'?'No enviado: instalación cancelada o vinculación modificada':labels[item.status]||item.status}</strong>
    <p>{item.account} · {item.client}</p>
    <dl><div><dt>Destinatario</dt><dd>{item.recipient||'Sin registrar'}</dd></div>{item.kind!=='registration'&&<div><dt>Técnicos participantes</dt><dd>{item.technicians.join(' / ')||'Equipo técnico'}</dd></div>}<div><dt>Correo generado</dt><dd>{date(item.createdAt)}</dd></div>{item.sentAt&&<div><dt>Enviado</dt><dd>{date(item.sentAt)} · {item.sender}</dd></div>}</dl>
    {!active&&['queued','retry','needs_email','failed'].includes(item.status)&&<p>El correo de soporte debe estar activo en modo operativo para enviar este correo.</p>}
    {item.error&&<p role="status">{item.error}</p>}
    {item.status==='uncertain'&&<p>No se reenviará automáticamente para evitar duplicados. Revisá el envío con la persona responsable del correo.</p>}
    {canManage&&['needs_email','failed'].includes(item.status)&&<form onSubmit={submit}><label>Correo del cliente<input type="email" required maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)} placeholder="cliente@ejemplo.com" /></label><small>Verificá que pertenece al cliente. Se usará para este correo.</small><button type="submit" className="primary" disabled={busy||!email.trim()} title="Guardá el destinatario y programá el envío del correo.">{busy?'Guardando…':'Guardar y programar envío'}</button></form>}
    {canManage&&item.status==='uncertain'&&<form onSubmit={submit}><label className="experience-mail-verify"><input type="checkbox" checked={verified} disabled={busy} onChange={event=>setVerified(event.target.checked)} />Verifiqué en el buzón que este correo fue enviado.</label><button type="submit" className="secondary" disabled={busy||!verified} title="Registrá la verificación manual del envío, sin reenviar el correo.">Confirmar envío verificado</button></form>}
    {error&&<p role="alert">{error}</p>}
    <details><summary>Historial del envío</summary>{item.history.map((event,index)=><p key={index}>{date(event.at)} · {({verified:'Envío verificado manualmente',created:'Correo generado',recipient:'Destinatario actualizado',sent:'Aceptado por el servidor de correo',failed:'Falló el envío',retry:'Reintento programado',uncertain:'Entrega incierta',cancelled:'Envío cancelado'})[event.action]||event.action}{event.byName&&` · ${event.byName}`}{event.recipient&&` · ${event.recipient}`}</p>)}</details>
  </article>
}
export default function InstallationExperienceMail({customerId,id,onBusyChange,onResolved}) {
  const {can}=usePermissions(),[data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const allowed=can('accounts.view')&&can('records.contact')
  useEffect(()=>{
    if(!allowed)return
    let alive=true;setError('');setData(null)
    requestJson('/api/customers/experience-mail?'+new URLSearchParams(id?{id}:{customerId})).then(result=>{if(alive)setData(result)}).catch(failure=>{if(alive)setError(failure.message)})
    return()=>{alive=false}
  },[allowed,customerId,id,retry])
  if(!allowed)return null
  return <section className="experience-mail-section" aria-label="Avisos de instalación"><h3>Avisos de instalación</h3><p>Confirmaciones de visita, alta de la cuenta y solicitud de experiencia.</p>{!data&&!error&&<p role="status">Consultando envíos…</p>}{error&&<p role="alert">{error} <button type="button" className="secondary" title="Volvé a consultar el estado del envío." onClick={()=>setRetry(n=>n+1)}>Reintentar</button></p>}{data&&!data.items.length&&<p>Todavía no se generaron avisos de instalación para esta cuenta.</p>}{data?.items.map(item=>item.channel==='whatsapp'?<WhatsAppItem key={`${item.id}:${item.updatedAt}`} item={item} active={item.kind==='experience'?data.whatsappExperienceActive:data.whatsappActive} canManage={can('customers.experience.manage')} onBusyChange={onBusyChange} onSaved={()=>{setRetry(n=>n+1);onResolved?.()}}/>:<MailItem key={`${item.id}:${item.updatedAt}`} item={item} active={data.active} canManage={can('customers.experience.manage')} onBusyChange={onBusyChange} onSaved={()=>{setRetry(n=>n+1);onResolved?.()}} />)}</section>
}
