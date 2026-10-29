import React, { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { usePermissions } from '../../presentation/contexts/permissions-context.jsx'
import ModuleIntroduction from '../../components/ModuleIntroduction.jsx'
import EditorModal from '../../components/ui/EditorModal.jsx'
import RegistrationForms from './RegistrationForms.jsx'
import LegacyRegistration from './LegacyRegistration.jsx'
import { TITLES } from '../../../shared/registration/schema.mjs'
import './forms-inbox.css'

const states = { open: 'Por completar', submitted: 'Recibidos · gestión pendiente', correction: 'En corrección', reviewed: 'Gestionados en SoftGuard', cancelled: 'Cancelados' }
export default function FormsInbox({ onOpenService, onOpenTicket, openRequest, onOpenRequestHandled }) {
  const { can } = usePermissions()
  const [search,setSearch]=useState(''),[kind,setKind]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),[retry,setRetry]=useState(0)
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false)
  useEffect(()=>{let live=true;setLoading(true);setError('');const timer=setTimeout(()=>{
    requestJson('/api/registration/forms?'+new URLSearchParams({list:'1',search,kind,status,page:String(page)})).then(result=>{if(live)setData(result)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)})
  },200);return()=>{live=false;clearTimeout(timer)}},[search,kind,status,page,retry])
  useEffect(()=>{const changed=()=>setRetry(n=>n+1);window.addEventListener('registration-changed',changed);window.addEventListener('tickets-changed',changed);return()=>{window.removeEventListener('registration-changed',changed);window.removeEventListener('tickets-changed',changed)}},[])
  const requestSequence=useRef(0)
  useEffect(()=>{
    if(!openRequest)return
    let live=true;const id=openRequest.id;const sequence=++requestSequence.current
    setError('');setSelected(null)
    if(String(id).startsWith('legacy:'))requestJson('/api/registration/forms?'+new URLSearchParams({legacyId:id})).then(data=>{if(live&&sequence===requestSequence.current)setSelected(data.item)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)onOpenRequestHandled?.()})
    else {setSelected({id,serviceId:openRequest.serviceId});onOpenRequestHandled?.()}
    return()=>{live=false}
  },[openRequest])
  async function refreshSelected(){
    setRetry(n=>n+1)
    if(selected?.source==='google')try{const result=await requestJson('/api/registration/forms?'+new URLSearchParams({legacyId:selected.id}));setSelected(current=>current?.id===result.item.id?result.item:current)}catch(e){setError(e.message);setSelected(null)}
  }
  if(!can('forms.view'))return null
  return <section className="forms-inbox">
    <ModuleIntroduction><p>Compartí enlaces y revisá respuestas, correcciones y cargas pendientes en SoftGuard.</p></ModuleIntroduction>
    <div className="forms-inbox-filters panel">
      <label>Buscar cliente, cuenta o correo<input type="search" value={search} maxLength={160} placeholder="Nombre, PIG / CLI, correo o ticket" onChange={e=>{setSearch(e.target.value);setPage(1)}} /></label>
      <label>Tipo de formulario<select value={kind} onChange={e=>{setKind(e.target.value);setPage(1)}}><option value="">Todos los tipos</option>{Object.entries(TITLES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Estado<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">Todos los estados</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" className="secondary" disabled={loading} onClick={()=>setRetry(n=>n+1)}>Actualizar</button>
    </div>
    {error&&<p role="alert">{error} <button className="secondary" onClick={()=>setRetry(n=>n+1)}>Reintentar</button></p>}
    {loading&&<p role="status">Consultando formularios…</p>}
    {!error&&data&&<>
      <div className="forms-inbox-counts" aria-label="Estados de los formularios">{Object.entries(states).map(([key,label])=><button type="button" key={key} aria-pressed={status===key} onClick={()=>{setStatus(status===key?'':key);setPage(1)}}><strong>{data.counts[key]||0}</strong><span>{label}</span></button>)}</div>
      <p>{data.total} formulario(s){search||kind?' con los filtros actuales':''}.</p>
      {!data.total?<div className="panel forms-inbox-empty"><p>No hay formularios para esta búsqueda.</p><small>Los enlaces se generan desde la instalación en Agenda semanal o al crear una reserva de ventas.</small></div>:<div className="panel forms-inbox-table" aria-busy={loading}><table><thead><tr><th>Cliente / cuenta</th><th>Visita</th><th>Formulario</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.items.map(item=><tr key={item.id}><td data-label="Cliente / cuenta"><strong>{item.client}</strong>{item.account&&<small>{item.account}</small>}</td><td data-label="Visita">{item.date?String(item.date).split('-').reverse().join('/'):'Sin instalación vinculada'}{item.time&&<small>{item.time} hs</small>}</td><td data-label="Formulario">{TITLES[item.kind]||'Tipo por identificar'}<small>{item.source==='google'?'Google / registro anterior':'Formulario propio'}</small></td><td data-label="Estado"><span className={`forms-inbox-status status-${item.status}`}>{states[item.status]}</span>{item.version>0&&<small>Respuesta {item.version}</small>}</td><td data-label="Acciones"><div className="forms-inbox-actions"><button type="button" className="secondary" disabled={loading} onClick={()=>setSelected(item)}>Ver formulario</button>{onOpenService&&item.serviceId&&<button type="button" className="secondary" disabled={loading} onClick={()=>onOpenService(item.serviceId)}>Ver servicio</button>}</div></td></tr>)}</tbody></table></div>}
      <nav className="forms-inbox-pages" aria-label="Páginas de formularios"><button className="secondary" disabled={loading||data.page<=1} onClick={()=>setPage(data.page-1)}>Anterior</button><span>Página {data.page} de {data.pages}</span><button className="secondary" disabled={loading||data.page>=data.pages} onClick={()=>setPage(data.page+1)}>Siguiente</button></nav>
    </>}
    {selected&&<EditorModal active title="Formulario de alta" eyebrow={selected.source==='google'?'GOOGLE / REGISTRO ANTERIOR':TITLES[selected.kind]||'FORMULARIO PROPIO'} busy={busy} onClose={()=>setSelected(null)}>{selected.source==='google'?<LegacyRegistration key={selected.id} item={selected} onBusyChange={setBusy} onChanged={refreshSelected} onOpenService={onOpenService} onOpenTicket={onOpenTicket}/>:<><RegistrationForms hideHeading key={selected.id} id={selected.id} onBusyChange={setBusy}/>{selected.serviceId&&onOpenService&&<button type="button" className="secondary" disabled={busy} onClick={()=>onOpenService(selected.serviceId)}>Ver instalación / vincular PIG</button>}</>}</EditorModal>}
  </section>
}
