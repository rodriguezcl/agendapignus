const { emailAddress, classifyDeliveryError, safeMailError } = require('./ticket-mail.cjs')
const { message } = require('./installation-experience.cjs')
const { installationType } = require('./installation-communications.cjs')
const { ready: experienceReady } = require('./experience-whatsapp.cjs')
async function processExperienceMail({store,config,readState,smtpFactory=require('./ticket-mail-worker.cjs').createSmtpAdapter,now=Date.now,maxRunMs=10000}) {
  await store.ensure()
  await store.recover(new Date(now()).toISOString())
  await store.reconcile(await readState(),new Date(now()).toISOString())
  const counts={sent:0,failed:0,uncertain:0,retried:0,cancelled:0}
  if(!config.enabled || config.mode!=='live')return {...counts,paused:true}
  const deadline=now()+maxRunMs
  let smtp
  try {
    for(let i=0;i<5 && now()<deadline;i++) {
      const row=await store.claim(new Date(now()).toISOString());if(!row)break
      let status='sent',failure=null
      try {
        const state=await readState()
        const record=state.history.find(item=>String(item.id)===row.service_id)
        const registration=row.payload.kind==='registration',appointment=row.payload.kind==='appointment'
        if(appointment ? !require('./appointment-confirmation.cjs').eligible(record,row.payload,state,now()) : registration ? !require('./registration-confirmation.cjs').eligible(record,row.payload,state) : !experienceReady(record,state)) {
          await store.finish(row,'cancelled',null,new Date(now()).toISOString());counts.cancelled++;continue
        }
        if(!emailAddress(row.payload.recipient) || emailAddress(row.payload.recipient)===emailAddress(config.address)) throw Object.assign(new Error('Destinatario inválido.'),{code:'EENVELOPE'})
        smtp ||= smtpFactory({...config,senderName:'Equipo Pignus'})
        const result=await smtp.send({service_id:row.service_id,message_id:`<${appointment?'appointment':registration?'registration':'experience'}-${row.id}@${config.address.split('@')[1]}>`,payload:appointment?require('./appointment-confirmation.cjs').message(row.payload,record):registration?require('./registration-confirmation.cjs').message(row.payload,record):message({...row.payload,installationType:installationType(record)})})
        if(!(result?.accepted||[]).some(value=>emailAddress(typeof value==='string'?value:value.address)===row.payload.recipient)) {
          status=result?.rejected?.length?'failed':'uncertain';failure=safeMailError({code:status==='failed'?'MAIL_REJECTED':'MAIL_SEND_UNCERTAIN'})
        }
      } catch(error) {
        status=classifyDeliveryError(error)
        if(status==='retry' && row.attempts>=5)status='failed'
        failure=safeMailError(status==='uncertain'?{code:'MAIL_SEND_UNCERTAIN'}:error)
      }
      // If recording the SMTP result fails, leave sending for uncertain recovery; never resend blindly.
      await store.finish(row,status,failure,new Date(now()).toISOString(),config.address)
      counts[status==='retry'?'retried':status]++
    }
  }finally{smtp?.close?.()}
  return counts
}
module.exports={processExperienceMail}
