const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const forms=require('../api/_lib/ticket-registration-form.cjs')
const {createTicketStore}=require('../api/_lib/tickets-store.cjs')
const {ticketMailConfig}=require('../api/_lib/ticket-mail.cjs')
const {DatabaseSync}=require('node:sqlite')
const {pgliteAdapter}=require('./helpers/pglite-adapter.cjs')
const title='Hay respuestas nuevas de tu formulario Alta de Servicio - Docta Urbanización.'
const body='Formularios de Google. 1 respuesta nueva. Ver respuesta: cliente@example.com'
const user={id:'admin',name:'Soporte',roleCode:'administrator'}
test('detecta los tres formularios y sólo extrae correos de Ver respuesta',()=>{
 for(const [name,kind] of [['Docta Urbanización','docta'],['Nobu Town','nobu-town'],['Pignus Seguridad','residencial']]){
 const result=forms.detectRegistrationForm('Alta de Servicio - '+name,body+' soporte@google.com');assert.equal(result.kind,kind);assert.deepEqual(result.candidates,['cliente@example.com'])
 }
 assert.equal(forms.detectRegistrationForm('Otro asunto',body),null)
 assert.equal(forms.detectRegistrationForm(title,'2 respuestas nuevas. Ver respuesta: a@example.com Ver respuesta: b@example.com').multiple,true)
 assert.deepEqual(forms.detectRegistrationForm(title,'Ver respuesta: no-es-correo').candidates,[])
})
test('títulos identifican el formulario y al respondente, incluidos avisos antiguos',()=>{
 for(const [name,label] of [['Docta Urbanización','Docta Urbanización'],['Nobu Town','Nobu Town'],['Pignus Seguridad','Residencial']]) {
  const ticket={number:'100',title:'Alta de Servicio - '+name,description:body,requesterEmail:'forms@google.com'}
  assert.equal(forms.registrationFormTitle(ticket),'Formulario '+label+' completo: cliente@example.com')
  assert.equal(require('../api/_lib/tickets.cjs').present(ticket,user).title,forms.registrationFormTitle(ticket))
  assert.ok(require('../api/_lib/ticket-communications.cjs').notificationTitle(ticket,'Nuevo',{},true).includes('cliente@example.com'))
  assert.ok(!require('../api/_lib/ticket-communications.cjs').notificationTitle(ticket,'Nuevo').includes('@'))
  assert.equal(forms.registrationFormTitle({...ticket,description:'Sin correo'}),'Formulario '+label+' completo: Correo por identificar')
  assert.equal(forms.registrationFormTitle({...ticket,description:'2 respuestas nuevas. Ver respuesta: a@example.com Ver respuesta: b@example.com'}),'Formulario '+label+' completo: Correo por identificar')
  assert.equal(ticket.description,body)
 }
 assert.equal(forms.registrationFormTitle({title:'Otro caso',description:body}),'Otro caso')
 assert.equal(forms.registrationFormTitle({title,registrationForm:{kind:'docta',multiple:true,candidates:['a@example.com','b@example.com'],confirmedAt:'2026-10-23',email:'b@example.com'}}),'Formulario Docta Urbanización completo: b@example.com')
})
for(const engine of ['sqlite','postgres'])test(engine+': formulario, agenda y correo se confirman atómicamente sin notificar a Google',async()=>{
 const values={TICKETS_MAIL_ENABLED:'true',TICKETS_MAIL_MODE:'live',TICKETS_MAIL_ADDRESS:'support@example.com',TICKETS_MAIL_USER:'support@example.com',TICKETS_MAIL_PASSWORD:'fixture-only'},prior={}
 for(const [key,value] of Object.entries(values)){prior[key]=process.env[key];process.env[key]=value}
 let db,pg,store,q
 try{
 if(engine==='sqlite'){db=new DatabaseSync(':memory:');store=createTicketStore({db});q=async(sql,args=[])=>/SELECT|RETURNING/.test(sql)?db.prepare(sql).all(...args):(db.prepare(sql).run(...args),[])}
 else{const {PGlite}=await import('@electric-sql/pglite');pg=await PGlite.create();store=createTicketStore({sql:pgliteAdapter(pg)});q=async(sql,args=[])=>{let n=0;return(await pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args)).rows}}
 await store.ensure();await q('CREATE TABLE form_test_state (id TEXT PRIMARY KEY,data TEXT NOT NULL)')
 const record={id:'s1',customerId:'c1',date:'2026-10-27',time:'10:30',status:'Pendiente',service:'Instalación de alarma',form:'',formEmail:'',sourceTaskId:'task1'}
 const state={employees:[],customers:[{customerId:'c1',account:'PIG-1',name:'Cliente'}],history:[record],agenda:{weekly:{'2026-10-27':{teams:[{tasks:[{taskId:'task1',historyId:'s1',form:''}]}]}}}}
 await q('INSERT INTO form_test_state(id,data) VALUES (?,?)',['current',JSON.stringify(state)])
 const runtime=ticketMailConfig(process.env)
 const imported=await store.ingestMail({subject:title,text:body,sender:{email:'forms@google.com',name:'Formularios de Google'},messageId:'<form1@google.com>',mode:'live',mailboxKey:runtime.mailboxKey,attachments:[]})
 assert.equal((await q('SELECT * FROM pignus_ticket_mail_outbox')).length,0)
 const detail=(await store.query(user,state,{mode:'detail',id:imported.ticketId})).ticket
 assert.equal(detail.title,'Formulario Docta Urbanización completo: cliente@example.com')
 assert.equal(detail.messages[0].body,body)
 const list=await store.query(user,state,{mode:'list'})
 assert.equal(list.items.find(item=>item.id===detail.id).title,detail.title)
 const notifications=await store.query(user,state,{mode:'notifications'})
 assert.ok(notifications.notifications.some(item=>item.title.includes(detail.title)))
 const adapter={load:async()=>JSON.parse((await q('SELECT data FROM form_test_state'))[0].data),save:async(_tx,_old,next)=>q('UPDATE form_test_state SET data=?',[JSON.stringify(next)])}
 const payload={action:'formReceipt',id:detail.id,version:detail.version,commandId:crypto.randomUUID(),customerId:'c1',formEmail:'cliente@example.com',serviceId:'s1',serviceSnapshot:JSON.stringify({form:'',formEmail:'',date:record.date,time:record.time})}
 await assert.rejects(store.run(user,state,{...payload,commandId:crypto.randomUUID(),formEmail:'wrong@example.com'},adapter),/Ver respuesta/)
 await assert.rejects(store.run(user,state,{...payload,commandId:crypto.randomUUID(),serviceSnapshot:'stale'},adapter),/cambió/)
 const limited={id:'admin',name:'Soporte',roleCode:'custom',permissions:{__catalogV2:true,'tickets.view':true,'tickets.linkService':true,'records.contact':true}}
 await assert.rejects(store.run(limited,state,{...payload,commandId:crypto.randomUUID()},adapter),e=>e.statusCode===403)
 process.env.TICKETS_MAIL_ENABLED='false'
 await assert.rejects(store.run(user,state,payload,adapter),/operativo/)
 assert.equal(JSON.parse((await q('SELECT data FROM form_test_state'))[0].data).history[0].form,'')
 process.env.TICKETS_MAIL_ENABLED='true'
 const result=await store.run(user,state,payload,adapter)
 assert.equal(result.ticket.registrationForm.serviceId,'s1')
 const saved=JSON.parse((await q('SELECT data FROM form_test_state'))[0].data);assert.equal(saved.history[0].form,'Completo');assert.equal(saved.agenda.weekly['2026-10-27'].teams[0].tasks[0].formEmail,'cliente@example.com')
 let mails=await q('SELECT payload FROM pignus_ticket_mail_outbox');assert.equal(mails.length,1);let mail=JSON.parse(mails[0].payload);assert.equal(mail.to,'cliente@example.com');assert.match(mail.text,/10:30/)
 await store.run(user,saved,payload,adapter);assert.equal((await q('SELECT * FROM pignus_ticket_mail_outbox')).length,1)
 const choices=await store.query(user,state,{mode:'formServices',customerId:'c1'});assert.equal(choices.items[0].id,'s1')
 const third=await store.ingestMail({subject:title,text:body,sender:{email:'forms@google.com'},messageId:'<form3@google.com>',mode:'live',mailboxKey:runtime.mailboxKey,attachments:[]})
 let deferred=(await store.query(user,state,{mode:'detail',id:third.ticketId})).ticket
 deferred=(await store.run(user,state,{action:'formReceipt',commandId:crypto.randomUUID(),id:deferred.id,version:deferred.version,customerId:'c1',formEmail:'cliente@example.com',deferUntilScheduled:true},adapter)).ticket
 assert.equal((await q('SELECT * FROM pignus_ticket_mail_outbox')).length,1)
 const linked={...record,id:'s-new',sourceTicketId:deferred.id,ticketNumber:deferred.number,form:'Completo',formEmail:'cliente@example.com'}
 await store.syncServices({...state,history:[]},{...state,history:[linked]},{user})
 mails=await q('SELECT payload FROM pignus_ticket_mail_outbox');assert.equal(mails.length,2);assert.match(JSON.parse(mails.at(-1).payload).text,/10:30/)
 await store.syncServices({...state,history:[linked]},{...state,history:[linked]},{user});assert.equal((await q('SELECT * FROM pignus_ticket_mail_outbox')).length,2)
 const second=await store.ingestMail({subject:title,text:body,sender:{email:'forms@google.com'},messageId:'<form2@google.com>',mode:'live',mailboxKey:runtime.mailboxKey,attachments:[]})
 let pending=(await store.query(user,state,{mode:'detail',id:second.ticketId})).ticket
 pending=(await store.run(user,state,{action:'formReceipt',commandId:crypto.randomUUID(),id:pending.id,version:pending.version,customerId:'c1',formEmail:'cliente@example.com'},adapter)).ticket
 assert.equal(pending.status,'En espera');mails=await q('SELECT payload FROM pignus_ticket_mail_outbox');mail=JSON.parse(mails.at(-1).payload);assert.match(mail.text,/5493512352959/);assert.match(mail.html,/Continuar por WhatsApp/)
 }finally{if(db)db.close();if(pg)await pg.close();for(const key of Object.keys(values)){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key]}}
})
