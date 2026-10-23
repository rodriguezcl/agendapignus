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
function formServicePatch(state, record, email) {
 const next=structuredClone(state), after={...record,form:'Completo',formEmail:email}
 next.history=next.history.map(item=>String(item.id)===String(record.id)?after:item)
 next.agenda=require('./history-record-operation.cjs').synchronizeAgendaHistoryRecord(next.agenda||{},record,after)
 // Sincronizar también los campos comerciales de todas las copias vinculadas.
 function sync(value){if(!value||typeof value!=='object')return; if(String(value.historyId||'')===String(record.id)||record.sourceTaskId&&String(value.taskId||'')===String(record.sourceTaskId)){value.form='Completo';value.formEmail=email} Object.values(value).forEach(sync)}
 sync(next.agenda)
 return {next,after}
}
function installationSuggestion(state) { const found=(state.services||[]).filter(s=>s.status==='Activo'&&/^(instalacion de alarma|instalacion de alarmas)$/.test(normalize(s.name)));return found.length===1?String(found[0].id):'' }
module.exports={detectRegistrationForm,installation,formServicePatch,installationSuggestion}
