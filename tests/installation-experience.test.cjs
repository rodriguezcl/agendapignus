const test=require('node:test'),assert=require('node:assert/strict')
const {DatabaseSync}=require('node:sqlite')
const domain=require('../api/_lib/installation-experience.cjs')
const {createExperienceStore}=require('../api/_lib/installation-experience-store.cjs')
const {processExperienceMail}=require('../api/_lib/installation-experience-worker.cjs')
const {experienceRequest}=require('../api/_lib/installation-experience-http.cjs')
const before={history:[{id:'s',customerId:'c',client:'PIG-1 Cliente',service:'Instalación de alarma',status:'Pendiente',date:'2026-10-26',technicianIds:['t1','t2'],technicians:['Pascual Gonzalez','Mariano Díaz']}],customers:[{customerId:'c',account:'PIG-1',name:'Ana <Ejemplo>',email:'ana@example.com'}],employees:[],roles:[],agenda:{weekly:{},teams:[]}}
const after={...before,history:[{...before.history[0],status:'Completado'}]}
const config={enabled:true,mode:'live',address:'soporte@example.com'}
const admin={id:'a',name:'Administración',roleCode:'administrator'}
const instant=Date.parse('2026-10-26T16:00:00Z')
async function fixture(state=after) {
  const db=new DatabaseSync(':memory:'),store=createExperienceStore({db});await store.ensure();await store.enqueue(before,state,new Date(instant).toISOString())
  return {db,store,state}
}
test('sólo se genera al pasar a completado; no hace envíos retroactivos ni de avances, cancelaciones u otros servicios',()=>{
  assert.equal(domain.completionInvitations(before,after).length,1)
  assert.equal(domain.completionInvitations(after,after).length,0)
  assert.equal(domain.completionInvitations({history:[]},after).length,0)
  for(const status of ['Cancelado','Avance registrado','Pendiente'])assert.equal(domain.completionInvitations(before,{...after,history:[{...after.history[0],status}]}).length,0)
  assert.equal(domain.completionInvitations(before,{...after,history:[{...after.history[0],service:'Service de alarma'}]}).length,0)
})
test('varias jornadas: una invitación al cierre final con técnicos participantes sin duplicar',()=>{
  const visit=(id,index,status,names,ids)=>({...before.history[0],id,serviceJourney:{id:'root',index,total:3},status,technicians:names,technicianIds:ids})
  const previous={...before,history:[visit('root',1,'Avance registrado',['Pascual Gonzalez'],['t1']),visit('j2',2,'Pendiente',['Pascual Gonzalez','Leonardo Rivero'],['t1','t3']),visit('j3',3,'Cancelado',['No participó'],['t4'])]}
  const next={...previous,history:previous.history.map(r=>r.id==='j2'?{...r,status:'Completado'}:r)}
  const [item]=domain.completionInvitations(previous,next)
  assert.deepEqual(item.technicians,['Pascual Gonzalez','Leonardo Rivero'])
  assert.equal(item.id,domain.envelope({...next.history[1],id:'another'},next).id)
  assert.equal(domain.completionInvitations(previous,{...next,history:next.history.map(r=>r.id==='j3'?{...r,status:'Pendiente'}:r)}).length,0)
})
test('plantilla: nombre, técnicos, enlace exacto y contenido HTML escapado, sin datos técnicos internos',()=>{
  const item=domain.completionInvitations(before,after)[0],mail=domain.message(item)
  assert.match(mail.text,/Pascual Gonzalez y Mariano Díaz/);assert(mail.text.includes(domain.REVIEW_URL))
  assert(mail.html.includes('Ana &lt;Ejemplo&gt;'));assert(!mail.html.includes('Ana <Ejemplo>'))
  const sanitized=require('../api/_lib/ticket-mail-signature.cjs').sanitizeSignatureHtml(mail.html)
  assert(sanitized.includes(domain.REVIEW_URL));assert(sanitized.includes('background-color:#956600'))
  assert.equal(item.recipient,'ana@example.com')
  assert.equal(domain.envelope({...before.history[0],formEmail:'cliente@ejemplo.com'},before).recipient,'cliente@ejemplo.com')
  assert.equal(domain.envelope(before.history[0],{...before,customers:[{...before.customers[0],email:'invalid'}]}).recipient,'')
})
test('la cola es idempotente y participa de la transacción del cierre',async()=>{
  const {db,store}=await fixture()
  try{
    await store.enqueue(before,after);assert.equal((await store.list()).length,1)
    db.exec('BEGIN');await store.enqueue({...before,history:[{...before.history[0],id:'rollback'}]},{...after,history:[{...after.history[0],id:'rollback'}]});db.exec('ROLLBACK')
    assert.equal((await store.list()).length,1)
    const claims=await Promise.all([store.claim(new Date(instant).toISOString()),store.claim(new Date(instant).toISOString())]);assert.equal(claims.filter(Boolean).length,1)
  }finally{db.close()}
})
test('envío exitoso registra resultado; ejecuciones posteriores no repiten el correo',async()=>{
  const {db,store}=await fixture();let calls=0
  try{
    const options={store,config,readState:async()=>after,now:()=>instant,smtpFactory:c=>({send:async row=>{calls++;assert.equal(c.senderName,'Equipo Pignus');assert.match(row.message_id,/experience-/);return {accepted:[row.payload.to]}},close(){}})}
    assert.equal((await processExperienceMail(options)).sent,1);assert.equal((await processExperienceMail(options)).sent,0);assert.equal(calls,1)
    const [row]=await store.list();assert.equal(row.status,'sent');assert.equal(row.sender,config.address);assert.equal(row.history.at(-1).action,'sent')
  }finally{db.close()}
})
test('buzón desactivado o de prueba no envía; una instalación cancelada después del cierre tampoco',async()=>{
  const {db,store}=await fixture();let calls=0
  try{
    const options={store,config,readState:async()=>({...after,history:[{...after.history[0],status:'Cancelado'}]}),now:()=>instant,smtpFactory:()=>{calls++;throw Error('No enviar')}}
    await processExperienceMail({...options,config:{...config,enabled:false}})
    await processExperienceMail({...options,config:{...config,mode:'test'}})
    assert.equal((await store.list())[0].status,'queued')
    assert.equal((await processExperienceMail(options)).cancelled,1);assert.equal(calls,0)
  }finally{db.close()}
})
test('fallo temporal antes de DATA reintenta; entrega incierta y recuperación de proceso interrumpido no se repiten',async()=>{
  const {db,store}=await fixture();let time=instant,calls=0
  try{
    const options={store,config,readState:async()=>after,now:()=>time,smtpFactory:()=>({send:async()=>{calls++;throw {code:'ETIMEDOUT',command:calls===1?'CONN':'DATA'}},close(){}})}
    assert.equal((await processExperienceMail(options)).retried,1)
    time+=120000;assert.equal((await processExperienceMail(options)).uncertain,1)
    time+=3600000;await processExperienceMail(options);assert.equal(calls,2)
    db.prepare("UPDATE pignus_installation_experience_mail SET status='sending',started_at=?").run(new Date(instant).toISOString())
    await processExperienceMail(options);assert.equal((await store.list())[0].status,'uncertain');assert.equal(calls,2)
  }finally{db.close()}
})
test('falta de email: visible en la cuenta, aviso con permisos y corrección auditada sin permitir reenviar un enviado',async()=>{
  const state={...after,customers:[{...after.customers[0],email:''}]}, {db,store}=await fixture(state)
  try{
    const request=(user,method='GET',query={},input={})=>experienceRequest({connection:db,kind:'db',state,user,method,query,input})
    const data=await request(admin,'GET',{notices:'1'});assert.equal(data.items[0].status,'needs_email')
    const reader={id:'r',roleCode:'custom',permissions:{__catalogV2:true,'accounts.view':true,'records.read':true,'records.contact':true,'notifications.experience':false}}
    assert.equal((await request(reader,'GET',{notices:'1'})).items.length,0)
    assert.equal((await request(reader,'GET',{customerId:'c'})).items.length,1)
    const row=data.items[0],input={id:row.id,updatedAt:row.updatedAt,email:'nuevo@example.com'}
    await assert.rejects(request(reader,'POST',{},input),/permiso/)
    await assert.rejects(request({...reader,permissions:{...reader.permissions,'records.contact':false}}),/acceso/)
    await assert.rejects(request(admin,'POST',{},{...input,updatedAt:'stale'}),/cambió/)
    const result=await request(admin,'POST',{},input);assert.equal(result.item.status,'queued');assert.equal(result.item.history.at(-1).byId,'a')
    await assert.rejects(request(admin,'POST',{},{...input,updatedAt:result.item.updatedAt}),/reenviarse/)
    await store.claim();const claimed=(await store.list())[0];await store.finish(claimed,'sent')
    await assert.rejects(request(admin,'POST',{},{...input,updatedAt:(await store.get(row.id)).updated_at}),/reenviarse/)
  }finally{db.close()}
})
test('PostgreSQL: cola atómica, RLS, deduplicación y resultado persistido',async()=>{
  const {PGlite}=require('@electric-sql/pglite'),pg=new PGlite()
  const sql={unsafe:async(text,params=[])=> (await pg.query(text,params)).rows}
  try {
    const store=createExperienceStore({sql});await store.ensure()
    await pg.exec('BEGIN');await store.enqueue(before,after);await pg.exec('ROLLBACK');assert.equal((await store.list()).length,0)
    await store.enqueue(before,after);await store.enqueue(before,after);assert.equal((await store.list()).length,1)
    const row=await store.claim();assert(row);assert.equal(await store.claim(),null)
    await store.finish(row,'sent',null,new Date().toISOString(),config.address)
    assert.equal((await store.list())[0].status,'sent')
    assert.equal((await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname='pignus_installation_experience_mail'")).rows[0].relrowsecurity,true)
  }finally{await pg.close()}
})
test('una entrega incierta se puede confirmar manualmente con trazabilidad, sin reenviarla',async()=>{
  const {db,store}=await fixture()
  try {
    const row=await store.claim(new Date(instant).toISOString());await store.finish(row,'uncertain')
    const input={id:row.id,updatedAt:(await store.get(row.id)).updated_at,action:'confirm-sent',verified:true}
    const request=value=>experienceRequest({connection:db,kind:'db',state:after,user:admin,method:'POST',input:value})
    await assert.rejects(request({...input,verified:false}),/Verificá/)
    assert.equal((await request(input)).item.status,'verified')
    assert.equal((await store.get(row.id)).history.at(-1).byName,admin.name)
    assert.equal(await store.claim(),null)
  }finally{db.close()}
})
