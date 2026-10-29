const { emailAddress } = require('./ticket-mail.cjs')
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim()
function detectRegistrationForm(subject, body) {
 const source=normalize(subject+' '+body)
 const kind=source.includes('alta de servicio - docta urbanizacion')?'docta':source.includes('alta de servicio - nobu town')?'nobu-town':source.includes('alta de servicio - pignus seguridad')?'residencial':''
 if(!kind) return null
 const candidates=[...new Set([...String(body||'').matchAll(/Ver respuesta\s*:\s*([^\s<>]+@[^\s<>]+)/gi)].map(match=>emailAddress(match[1])).filter(Boolean))]
 const count=source.match(/(\d+) respuestas? nuevas?/)?.[1]
 return { kind, candidates, multiple: candidates.length>1 || Number(count)>1 }
}
function installation(record, state) {
 const values=[record.service,record.serviceType,...(record.serviceTypes||[]).map(x=>x.name),...(state.services||[]).filter(s=>String(s.id)===String(record.serviceId)).map(s=>s.name)]
 return values.some(value=>/instalacion de alarmas?/.test(normalize(value))) && !['Cancelado','Completado','Avance registrado'].includes(record.status)
}
function formServicePatch(state, record, email, form = 'Completo') {
 const next=structuredClone(state), records=relatedServices(state,record), ids=new Set(records.map(item=>String(item.id)))
 next.history=next.history.map(item=>ids.has(String(item.id))?{...item,form,formEmail:email}:item)
 for(const before of records) next.agenda=require('./history-record-operation.cjs').synchronizeAgendaHistoryRecord(next.agenda||{},before,next.history.find(item=>String(item.id)===String(before.id)))
 const after=next.history.find(item=>String(item.id)===String(record.id))
 // Sincronizar también los campos comerciales de todas las copias vinculadas.
 const tasks=new Set(records.map(item=>String(item.sourceTaskId||'')).filter(Boolean))
 function sync(value){if(!value||typeof value!=='object')return; if(ids.has(String(value.historyId||''))||tasks.has(String(value.taskId||''))){value.form=form;value.formEmail=email} Object.values(value).forEach(sync)}
 sync(next.agenda)
 return {next,after}
}
function relatedServices(state,record) {return (record.serviceJourney ? (state.history||[]).filter(item=>item.serviceJourney?.id===record.serviceJourney.id) : [record]).sort((a,b)=>String(a.id).localeCompare(String(b.id)))}
function serviceSnapshot(state,record) {return JSON.stringify(relatedServices(state,record).map(item=>({id:String(item.id),customerId:item.customerId||'',subscriberReservation:Boolean(item.subscriberReservation),status:item.status||'',service:item.service||'',serviceTypes:item.serviceTypes||[],form:item.form||'',formEmail:item.formEmail||'',date:item.date||'',time:item.time||'',journey:item.serviceJourney||null})))}
function applied(ticket) {return Boolean(ticket.registrationForm?.serviceId && ticket.status==='Resuelto')}
function installationSuggestion(state) { const found=(state.services||[]).filter(s=>s.status==='Activo'&&/^(instalacion de alarma|instalacion de alarmas)$/.test(normalize(s.name)));return found.length===1?String(found[0].id):'' }
function registrationFormTitle(ticket, showEmail = true) {
 const form = ticket.registrationForm || detectRegistrationForm(ticket.title, ticket.description)
 const name = {docta:'Docta Urbanización','nobu-town':'Nobu Town',residencial:'Residencial'}[form?.kind]
 if (!name) return ticket.title
 const address = emailAddress(form.confirmedAt && form.email) || (!form.multiple && form.candidates?.length === 1 ? emailAddress(form.candidates[0]) : '')
 return `Formulario ${name} completo${showEmail ? `: ${address || 'Correo por identificar'}` : ''}`
}
module.exports={detectRegistrationForm,installation,formServicePatch,installationSuggestion,registrationFormTitle,relatedServices,serviceSnapshot,applied}
