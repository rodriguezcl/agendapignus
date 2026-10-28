const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const domain = require('../api/_lib/registration-confirmation.cjs')
const { createExperienceStore } = require('../api/_lib/installation-experience-store.cjs')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { processExperienceMail } = require('../api/_lib/installation-experience-worker.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const user = {id:'admin',name:'Administrador',roleCode:'administrator'}
const customer = {customerId:'c1',account:'PIG-1234',name:'Ana <Prueba>',email:'otro@example.com'}
const reservation = {id:'s1',customerId:'',subscriberReservation:true,client:'Ana',date:'2026-11-04',time:'10:30',service:'Instalación de alarma',status:'Pendiente',form:'Completo',formEmail:'ana@example.com'}
const linked = {...reservation,customerId:'c1',clientAccount:'PIG-1234',subscriberReservation:false,reservationLinkedAt:'2026-10-28T14:00:00Z'}
const before = {customers:[customer],history:[reservation]}
const after = {...before,history:[linked]}
const instant = Date.parse('2026-10-28T14:00:00Z')

test('sólo guardar la vinculación PIG dispara el aviso, no confirmar el formulario, importar ni editar', () => {
  assert.equal(domain.confirmations(before,after).length,1)
  assert.equal(domain.confirmations(before,before).length,0)
  assert.equal(domain.confirmations(after,after).length,0)
  assert.equal(domain.confirmations({history:[]},after).length,0)
  for (const change of [{status:'Cancelado'},{technicalStatus:'Cancelado'},{service:'Service de alarma'},{form:''},{customerId:''},{subscriberReservation:true}]) {
    assert.equal(domain.confirmations(before,{...after,history:[{...linked,...change}]}).length,0)
  }
  const cli={...linked,clientAccount:'CLI-1'}
  const cliState={customers:[{...customer,account:'CLI-1'}],history:[cli]}
  assert.equal(domain.confirmations(cliState,{...after,history:[cli]}).length,0,'importar el padrón sin vincular el servicio no envía')
  assert.equal(domain.confirmations(cliState,after).length,1)
})

test('varias jornadas generan una confirmación con la primera jornada vigente y sólo el email del formulario', () => {
  const visit=(record,id,index)=>({...record,id,date:`2026-11-0${index+3}`,serviceJourney:{id:'journey',index,total:3}})
  const previous={...before,history:[visit(reservation,'s1',1),visit(reservation,'s2',2),visit(reservation,'s3',3)]}
  const next={...after,history:[visit(linked,'s1',1),visit(linked,'s2',2),visit(linked,'s3',3)]}
  const items=domain.confirmations(previous,next)
  assert.equal(items.length,1);assert.equal(items[0].serviceId,'s1');assert.equal(items[0].recipient,'ana@example.com')
  assert.equal(domain.confirmations(before,{...after,history:[{...linked,formEmail:''} ]})[0].recipient,'')
  const mail=domain.message(items[0])
  assert.match(mail.text,/PIG-1234/);assert.match(mail.text,/10:30/);assert.match(mail.text,/4 de noviembre/)
  assert.match(mail.html,/Ana &lt;Prueba&gt;/);assert.doesNotMatch(mail.html,/Ana <Prueba>/)
})

for (const engine of ['sqlite','postgres']) test(`${engine}: vínculo y aviso son atómicos, idempotentes y conservan envíos anteriores`, async () => {
  let db,pg,options,sql
  if(engine==='sqlite'){db=new DatabaseSync(':memory:');options={db};sql=async(text,params=[])=>/SELECT|RETURNING/.test(text)?db.prepare(text).all(...params):(db.prepare(text).run(...params),[])}
  else{const {PGlite}=require('@electric-sql/pglite');pg=new PGlite();options={sql:pgliteAdapter(pg)};sql=async(text,params=[])=>{let n=0;return(await pg.query(text.replace(/\?/g,()=>'$'+(++n)),params)).rows}}
  try {
    const ticketStore=createTicketStore(options);await ticketStore.ensure()
    const store=createExperienceStore(options);await store.ensure()
    await sql('BEGIN');await require('../api/_lib/service-completion-effects.cjs').syncServiceEffects(ticketStore,before,after,{connection:db||options.sql,user},db?'db':'sql');await sql('ROLLBACK')
    assert.equal((await store.list()).length,0)
    await store.enqueue(before,after);await store.enqueue(before,after);await store.enqueue(after,after)
    let rows=await store.list();assert.equal(rows.length,1);assert.equal(rows[0].payload.kind,'registration')
    const claimed=await store.claim();assert(claimed);assert.equal(await store.claim(),null)
    await store.finish(claimed,'sent');await store.enqueue(before,after);assert.equal((await store.list())[0].status,'sent')
    const legacy={id:'legacy',number:'100',customerId:'c1',status:'Resuelto',registrationForm:{receiptSentAt:'2026-10-20',serviceId:'legacy-service',email:'legacy@example.com'},serviceIds:['legacy-service']}
    await sql('INSERT INTO pignus_tickets(id,number,status,updated_at,search_text,data) VALUES (?,?,?,?,?,?)',['legacy','100','Resuelto','2026-10-20','legacy',JSON.stringify(legacy)])
    await store.enqueue({...before,history:[{...reservation,id:'legacy-service'}]},{...after,history:[{...linked,id:'legacy-service'}]})
    assert.equal((await store.list()).length,1,'no repite el acuse ya generado por el ticket')
    await store.enqueue({...before,history:[{...reservation,id:'no-email',formEmail:''}]},{...after,history:[{...linked,id:'no-email',formEmail:''}]})
    rows=await store.list();assert.equal(rows.find(row=>row.service_id==='no-email').status,'needs_email')
    // A closed intake ticket linked to a CLI must not prevent the later PIG link.
    const cliCustomer={customerId:'cli',account:'CLI-1',name:'Ana'}
    const cliRecord={...reservation,id:'ticket-service',customerId:'cli',clientAccount:'CLI-1',subscriberReservation:false,form:'',formEmail:''}
    const cliState={customers:[cliCustomer,customer],history:[cliRecord],agenda:{}}
    const imported=await ticketStore.ingestMail({subject:'Alta de Servicio - Docta Urbanización',text:'Ver respuesta: ana@example.com',sender:{email:'forms@google.com'},messageId:'<registration-link@example.com>',mode:'test',mailboxKey:'fixture',attachments:[]})
    const ticket=(await ticketStore.query(user,cliState,{mode:'detail',id:imported.ticketId})).ticket
    let applied
    await ticketStore.run(user,cliState,{action:'formReceipt',id:ticket.id,version:ticket.version,commandId:require('node:crypto').randomUUID(),customerId:'cli',formEmail:'ana@example.com',serviceId:cliRecord.id,serviceSnapshot:require('../api/_lib/ticket-registration-form.cjs').serviceSnapshot(cliState,cliRecord)},{load:async()=>cliState,save:async(_q,_old,next)=>{applied=next}})
    const stored=JSON.parse((await sql('SELECT data FROM pignus_tickets WHERE id=?',[ticket.id]))[0].data)
    stored.status='Resuelto'
    await sql('UPDATE pignus_tickets SET status=?,data=? WHERE id=?',['Resuelto',JSON.stringify(stored),ticket.id])
    const pigState={...applied,history:[{...linked,id:cliRecord.id}]}
    await require('../api/_lib/service-completion-effects.cjs').syncServiceEffects(ticketStore,applied,pigState,{connection:db||options.sql,user},db?'db':'sql')
    assert.equal(JSON.parse((await sql('SELECT data FROM pignus_tickets WHERE id=?',[ticket.id]))[0].data).customerId,'c1')
    assert.equal((await sql('SELECT * FROM pignus_ticket_mail_outbox')).length,0)
    assert.equal((await store.list()).filter(row=>row.service_id===cliRecord.id).length,1)
  } finally {db?.close();await pg?.close()}
})

test('el worker espera el canal operativo, usa la fecha vigente y no duplica; cancela si se anuló la visita',async()=>{
  const db=new DatabaseSync(':memory:');const store=createExperienceStore({db});await createTicketStore({db}).ensure();await store.enqueue(before,after,new Date(instant).toISOString())
  let sends=0,clock=instant,current={...after,history:[{...linked,date:'2026-11-06',time:'11:45'}]}
  const options={store,config:{enabled:true,mode:'live',address:'support@example.com'},readState:async()=>current,now:()=>clock,smtpFactory:()=>({send:async row=>{sends++;assert.match(row.payload.text,/6 de noviembre/);assert.match(row.payload.text,/11:45/);assert.match(row.message_id,/registration-/);return {accepted:[row.payload.to]}},close(){}})}
  try{
    await processExperienceMail({...options,config:{...options.config,enabled:false}});assert.equal(sends,0)
    await processExperienceMail(options);await processExperienceMail(options);assert.equal(sends,1)
    const next={...after,history:[{...linked,id:'cancel'}]};await store.enqueue({...before,history:[{...reservation,id:'cancel'}]},next,new Date(clock).toISOString())
    current={...next,history:[{...next.history[0],status:'Cancelado'}]};assert.equal((await processExperienceMail(options)).cancelled,1);assert.equal(sends,1)
  }finally{db.close()}
})

test('cerrar o confirmar un ticket de formulario no envía mensajes automáticos de alta o resolución',()=>{
  const {canAutomaticallyEmail}=require('../api/_lib/ticket-communications.cjs')
  const runtime={enabled:true,mode:'live',address:'support@example.com',mailboxKey:'box'}
  const ticket={origin:'email',mailMode:'live',mailboxKey:'box',requesterEmail:'ana@example.com',registrationForm:{confirmedAt:'2026-10-28'}}
  for(const type of ['received','form-received','scheduled','waiting','resolved'])assert.equal(canAutomaticallyEmail(ticket,runtime,type),false)
  assert.equal(canAutomaticallyEmail({...ticket,registrationForm:null},runtime,'resolved'),true,'los tickets comunes conservan su correo')
})
