const {can}=require('./permission-catalog.cjs')
const access=require('./granular-read-policy.cjs')
const {emailAddress}=require('./ticket-mail.cjs')
const fail=(message,statusCode=403)=>{throw Object.assign(new Error(message),{statusCode})}
const recordForNotice=(row,state)=>state.history.find(item=>String(item.id)===row.service_id) || (row.payload.cancelledNotice ? {id:row.service_id,customerId:row.customer_id} : null)
function visible(row,state,user) {
  if(!can(user,'accounts.view') || !can(user,'records.contact'))return false
  const record=recordForNotice(row,state)
  const customer=record && access.customerForRecord(record,state)
  return Boolean(record && customer && access.customerReadable(customer,user,state) && access.serviceInReadScope(record,user,state))
}
const present=row=>({kind:row.payload.kind||'experience',id:row.id,recordId:row.service_id,customerId:row.customer_id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,sentAt:row.sent_at,sender:row.sender,attempts:row.attempts,error:row.last_error?.message||'',client:row.payload.client,account:row.payload.account,recipient:row.payload.recipient,phone:row.payload.phone,manualContact:row.payload.manualContact===true,technicians:row.payload.technicians,serviceType:row.payload.serviceType || (row.payload.kind==='registration'?'':'Instalación de alarma'),scheduledAt:row.payload.scheduledAt,omissionReason:row.payload.omissionReason,cancelledNotice:row.payload.cancelledNotice===true,history:row.history})
async function experienceRequest({connection,kind,state,user,method,input={},query={}}) {
  if(!can(user,'accounts.view') || !can(user,'records.contact'))fail('No tenés acceso a los correos de esta cuenta.')
  await require('./tickets-http.cjs').storeFor(connection,kind).ensure()
  const store=require('./installation-experience-store.cjs').createExperienceStore({[kind]:connection});await store.ensure()
  const channel=require('./ticket-mail-channel.cjs').createMailChannelStore({[kind]:connection})
  const configured=await channel.get()
  let active=false
  try {const runtime=await channel.runtime();active=runtime.enabled===true&&runtime.mode==='live'}catch{/* Report the paused channel without exposing credential errors. */}
  if(method==='POST') {
    if(!can(user,'customers.experience.manage'))fail('No tenés permiso para gestionar estos correos.')
    if(String(input.id||'').startsWith('whatsapp:')) {
      const whatsapp=require('./appointment-whatsapp.cjs'), whatsappStore=whatsapp.createStore({[kind]:connection})
      await whatsappStore.ensure()
      const row=(await whatsappStore.list()).find(item=>`whatsapp:${item.id}`===input.id)
      if(!row || !visible(row,state,user))fail('No se encontró el aviso autorizado.',404)
      if(input.action!=='review-whatsapp' || input.verified!==true)fail('Comprobá que el flujo terminó en GoHighLevel antes de finalizar la revisión.',409)
      await whatsappStore.review(row.id,input.updatedAt,user,new Date().toISOString())
      return {ok:true}
    }
    const row=await store.get(String(input.id||''))
    if(!row || !visible(row,state,user))fail('No se encontró el envío autorizado.',404)
    if(input.updatedAt!==row.updated_at)fail('El envío cambió. Actualizá la ficha.',409)
    if(input.action==='confirm-contact') {
      if(!row.payload.manualContact || row.status!=='needs_action' || input.verified!==true)fail('Confirmá que contactaste al cliente antes de registrar la gestión.',409)
      if(!require('./appointment-delivery.cjs').current(recordForNotice(row,state),row.payload,state,'email',Date.now()))fail('La visita cambió. Actualizá la ficha antes de gestionar el aviso.',409)
      return {item:present(await store.confirmContact(row,user,input.contactChannel)),active}
    }
    if(input.action==='confirm-sent') {
      if(row.status!=='uncertain'||input.verified!==true)fail('Verificá en el buzón que el correo fue enviado antes de confirmarlo.',409)
      return {item:present(await store.confirmSent(row,user)),active}
    }
    if(!['needs_email','failed'].includes(row.status))fail('Este envío no admite reenviarse. Revisá su estado.',409)
    const email=emailAddress(input.email)
    if(!email || email===emailAddress(configured.settings?.address))fail('Ingresá un correo válido del cliente, distinto al remitente.',400)
    return {item:present(await store.recipient(row,email,user)),active}
  }
  if(method!=='GET')fail('Método no permitido.',405)
  const whatsapp=require('./appointment-whatsapp.cjs')
  const whatsappStore=whatsapp.createStore({[kind]:connection});await whatsappStore.ensure()
  const whatsappActive=whatsapp.configuration().enabled
  const whatsappExperienceActive=whatsapp.configuration(process.env,'experience').enabled
  const rowActive=row=>row.channel==='whatsapp'?whatsapp.configuration(process.env,row.payload.kind,row.payload.installationType).enabled:active
  let rows=[...(await store.list()).map(row=>({...row,channel:'email'})),...(await whatsappStore.list()).map(row=>({...row,id:`whatsapp:${row.id}`,channel:'whatsapp'}))].filter(row=>visible(row,state,user))
  if(query.customerId)rows=rows.filter(row=>String(access.customerForRecord(recordForNotice(row,state),state)?.customerId)===String(query.customerId))
  if(query.id)rows=rows.filter(row=>row.id===query.id)
  if(query.notices==='1') {
    if(!can(user,'notifications.experience'))return {items:[],active}
    rows=rows.filter(row=>['needs_email','needs_phone','failed','uncertain','draft','needs_action'].includes(row.status) || !rowActive(row) && ['queued','retry'].includes(row.status))
  }
  return {items:rows.map(row=>({...(row.channel==='whatsapp'?whatsapp.present({...row,id:row.id.slice('whatsapp:'.length)}):present(row)),active:rowActive(row)})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),active,whatsappActive,whatsappExperienceActive}
}
module.exports={visible,present,experienceRequest}
