import React, { useEffect, useRef, useState } from 'react'
import { requestJson } from '../../infrastructure/http/json-request.mjs'
import { newCommandId } from './ticket-ui.mjs'
export default function RegistrationFormPanel({ ticket, can, onSaved, onCoordinateService }) {
 const info=ticket.registrationForm
 const [mode,setMode]=useState('existing'),[items,setItems]=useState([]),[serviceId,setServiceId]=useState(''),[email,setEmail]=useState(info.email||info.candidates?.[0]||''),[replace,setReplace]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('')
 const [customer,setCustomer]=useState(ticket.customerId?{id:ticket.customerId,...ticket.customerSnapshot}:null),[customerSearch,setCustomerSearch]=useState(''),[customers,setCustomers]=useState([])
 const customerId=customer?.id||customer?.customerId||''
 useEffect(()=>{if(customer||customerSearch.trim().length<2){setCustomers([]);return}let active=true;const timer=setTimeout(()=>requestJson('/api/tickets?view=customers&search='+encodeURIComponent(customerSearch)).then(data=>{if(active)setCustomers(data.items||[])}).catch(e=>{if(active)setError(e.message)}),300);return()=>{active=false;clearTimeout(timer)}},[customerSearch,customer])
 useEffect(()=>{if(info.confirmedAt){setMode('existing');setConfirmed(false)}},[info.confirmedAt])
 const command=useRef(null)
 useEffect(()=>{let active=true;if(customerId&&can('planning.commercial'))requestJson('/api/tickets?view=formServices&customerId='+encodeURIComponent(customerId)).then(data=>{if(active)setItems(data.items||[])}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[customerId,ticket.version])
 if(!can('tickets.linkService')||!can('planning.commercial')||!can('records.contact'))return null
 if(!ticket.customerId&&!can('tickets.classify'))return <p>Para procesar este formulario, una persona autorizada debe vincular primero la cuenta.</p>
 if(info.multiple)return <section className="tickets-feedback"><h3>Formulario de alta recibido</h3><p>El aviso contiene varias respuestas. Revisá cada respuesta por separado antes de asociarla a una instalación.</p></section>
 if(info.serviceId)return <section className="tickets-feedback"><h3>Formulario aplicado</h3><p>Correo del formulario: {info.email}. La confirmación quedó registrada en la conversación.</p></section>
 const selected=items.find(item=>item.id===serviceId), conflict=selected&&(selected.form==='Completo'||selected.formEmail&&selected.formEmail!==email)
 async function submit(event){event.preventDefault();if(busy)return;setBusy(true);setError('');try{
 const payload={action:'formReceipt',id:ticket.id,version:ticket.version,customerId,formEmail:email,serviceId:mode==='existing'?serviceId:'',replaceForm:replace,serviceSnapshot:selected?.snapshot,deferUntilScheduled:mode==='coordinate'}
 const fingerprint=JSON.stringify(payload);if(command.current?.fingerprint!==fingerprint)command.current={fingerprint,id:newCommandId()}
 const result=await requestJson('/api/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,commandId:command.current.id})})
 onSaved();if(mode==='coordinate')onCoordinateService?.(result.ticket)
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="tickets-management"><h3>Formulario de alta recibido</h3><form className="tickets-form" onSubmit={submit}>
 {customer?<div><p>Cuenta: {customer.account} · {customer.name}</p>{!ticket.customerId&&<button type="button" className="secondary" onClick={()=>{setCustomer(null);setItems([]);setServiceId('');setConfirmed(false)}}>Cambiar cuenta</button>}</div>:<div><label>Abonado o cliente<input type="search" placeholder="Buscar por PIG, CLI o nombre" value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} /></label>{customers.map(item=><button type="button" className="secondary" key={item.id} onClick={()=>{setCustomer(item);setConfirmed(false)}}>{item.account} · {item.name}</button>)}</div>}
 <label>Correo de «Ver respuesta»<input type="email" required disabled={busy||Boolean(info.email)||info.candidates?.length===1} value={email} onChange={e=>{setEmail(e.target.value);setConfirmed(false)}} /></label>
 <label>Tratamiento<select value={mode} disabled={busy} onChange={e=>{setMode(e.target.value);setConfirmed(false)}}><option value="existing">Aplicar a una instalación existente</option>{!info.confirmedAt&&<option value="pending">Confirmar recepción · pendiente de coordinación</option>}{!info.confirmedAt&&can('planning.create')&&can('weekly.view')&&onCoordinateService&&<option value="coordinate">Coordinar una instalación nueva</option>}</select></label>
 {mode==='existing'&&<><label>Buscar instalación<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nombre, fecha u horario" /></label><label>Instalación<select required value={serviceId} disabled={busy||!can('planning.commercial')} onChange={e=>{setServiceId(e.target.value);setReplace(false);setConfirmed(false)}}><option value="">Seleccionar instalación</option>{items.filter(item=>item.id===serviceId||item.label.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{!items.length&&<p>No hay instalaciones pendientes para esta cuenta. Podés coordinar una nueva visita.</p>}{conflict&&<label className="tickets-checkbox"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)} />Confirmo reemplazar el formulario existente ({selected.formEmail||'sin correo'}).</label>}</>}
 <p>{mode==='existing'?'Se marcará Formulario: Completo y se guardará este correo en la instalación.':mode==='coordinate'?'Se precargará Instalación de alarma y el formulario completo. El correo se enviará al guardar la visita.':'Se confirmará la recepción y se solicitará coordinar por WhatsApp al +54 9 3512 35-2959.'} El correo de contacto de la cuenta no se modifica.</p>
 <label className="tickets-checkbox"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />Verifiqué que el correo y la cuenta corresponden a esta respuesta.</label>
 {error&&<p role="alert" className="field-error">{error}</p>}
 <div className="tickets-form-footer"><button type="submit" className="primary" disabled={busy||!customerId||!confirmed||!email||mode==='existing'&&(!selected||conflict&&!replace)}>{busy?'Guardando…':mode==='coordinate'?'Continuar a la agenda':'Confirmar formulario'}</button></div>
 </form></section>
}
