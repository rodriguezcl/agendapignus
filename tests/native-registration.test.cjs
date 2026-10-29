const test=require('node:test'),assert=require('node:assert/strict')
const {DatabaseSync}=require('node:sqlite')
const native=require('../api/_lib/native-registration.cjs')
const {pgliteAdapter}=require('./helpers/pglite-adapter.cjs')
process.env.PIGNUS_REGISTRATION_ENCRYPTION_KEY='native-registration-test-key-only-32-characters'
const admin={id:'a',name:'Administración de prueba',roleCode:'administrator'}
const initial=()=>({services:[],employees:[],roles:[],customers:[{customerId:'c',account:'PIG-999',name:'Cliente prueba'}],history:[{id:'s1',sourceTaskId:'task1',customerId:'c',client:'Cliente prueba',service:'Instalación de alarma',installationZone:'docta',date:'2026-11-10',time:'10:00',status:'Pendiente',form:'Pendiente'}],agenda:{weekly:{'2026-11-10':{teams:[{tasks:[{taskId:'task1',historyId:'s1',form:'Pendiente'}]}]}}}})
const answer=()=>({name:'Cliente de prueba',document:'30123456',email:'cliente@example.com',phone:'3511234567',block:'15',lot:'12',side:'Lado Córdoba',propertyType:'Residencial',subscriberPassword:'palabra-abonado',operatorPassword:'palabra-operador',contact1:'Contacto Prueba · familiar',contactPhone1:'3517654321',guardAccepted:true,termsAccepted:true,declarationAccepted:true})
const cuit=prefix=>{const sum=prefix.split('').reduce((s,d,i)=>s+Number(d)*[5,4,3,2,7,6,5,4,3,2][i],0);let check=11-sum%11;if(check===11)check=0;if(check===10)check=9;return prefix+check}
const cbu=()=>{const check=(v,w)=>String((10-v.split('').reduce((s,d,i)=>s+Number(d)*w[i],0)%10)%10);let a='0720000',b='0000000000001';return a+check(a,[7,1,3,9,7,1,3])+b+check(b,[3,9,7,1,3,9,7,1,3,9,7,1,3])}
test('schema variants, CBU/CVU checksums, card brand/expiry and allowlisting',async()=>{
  const {validate,validCbu,validCuit}=await import('../shared/registration/validate.mjs')
  assert.equal(validCbu(cbu()),true);assert.equal(validCbu('000'+cbu().slice(3)),false);assert.equal(validCbu(cbu().slice(0,-1)+'9'),false)
  assert.equal(validCuit(cuit('2030123456')),true)
  assert.deepEqual(validate('docta',answer()).errors,{})
  assert.equal(validate('nobu-town',answer()).values.side,undefined)
  const residential={...answer(),document:cuit('2030123456'),address:'Calle de prueba 123',neighborhood:'Centro',city:'Córdoba',kit:'OTRO',paymentMethod:'Débito CBU',cbu:cbu(),bankHolder:'Otro titular',bankDocumentType:'DNI',bankDocument:'30123456',bank:'BANCO SANTANDER ARGENTINA S.A.',contact2:'Otro contacto',contactPhone2:'3519999999',cvv:'123',arbitrary:'not stored'}
  assert.deepEqual(validate('residencial',residential).errors,{})
  assert.equal(validate('residencial',residential).values.cvv,undefined)
  assert.equal(validate('residencial',{...residential,cbu:'0000000000000000000000'}).errors.cbu.includes('CVU'),true)
  const card={...residential,paymentMethod:'Visa crédito',cardNumber:'4111 1111 1111 1111',cardExpiry:'12/30',cardHolder:'Titular de prueba',cardDni:'30123456'}
  assert.deepEqual(validate('residencial',card,new Date('2026-10-28')).errors,{})
  assert.equal(validate('residencial',card).values.cbu,undefined)
  assert.ok(validate('residencial',{...card,paymentMethod:'Mastercard crédito'}).errors.cardNumber)
  assert.ok(validate('residencial',{...card,cardExpiry:'01/20'}).errors.cardExpiry)
  assert.ok(validate('docta',{...answer(),contact3:'Incompleto'}).errors.contactPhone3)
})
test('authenticated encryption binds response to form and revision',()=>{
  const encrypted=native.seal({secret:'private'},'a:1')
  assert.ok(!encrypted.includes('private'));assert.deepEqual(native.unseal(encrypted,'a:1'),{secret:'private'})
  assert.throws(()=>native.unseal(encrypted,'a:2'))
})
for(const engine of ['sqlite','postgres'])test(`${engine}: unique links, secure submission, corrections, scopes, cancellation and multi-day`,async()=>{
  let db,pg,connection,kind,q
  if(engine==='sqlite'){db=new DatabaseSync(':memory:');connection=db;kind='db';q=async(sql,args=[])=>/SELECT|RETURNING/i.test(sql)?db.prepare(sql).all(...args):(db.prepare(sql).run(...args),[])}
  else {const {PGlite}=await import('@electric-sql/pglite');pg=await PGlite.create();connection=pgliteAdapter(pg);kind='sql';q=async(sql,args=[])=>{let n=0;return(await pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args)).rows}}
  try {
    await q('CREATE TABLE fixture_state (id TEXT PRIMARY KEY,data TEXT NOT NULL)')
    await q('INSERT INTO fixture_state (id,data) VALUES (?,?)',['current',JSON.stringify(initial())])
    const load=async()=>JSON.parse((await q('SELECT data FROM fixture_state'))[0].data),save=state=>q('UPDATE fixture_state SET data=?',[JSON.stringify(state)])
    const formState={load,save:async(_tx,previous,next)=>{assert.deepEqual(require('../api/_lib/registration-confirmation.cjs').confirmations(previous,next),[]);await save(next)}}
    const call=(method,input={},query={},user=admin)=>native.handle({connection,kind,user,method,input,query,formState})
    const publicCall=input=>native.handle({connection,kind,publicRequest:true,method:'POST',input,ip:'fixture',formState})
    let item=(await call('POST',{action:'create',serviceId:'s1'})).items[0]
    const token=item.link.split('#')[1]
    assert.equal((await call('POST',{action:'create',serviceId:'s1'})).items[0].link,item.link)
    assert.deepEqual(await publicCall({action:'read',token}).then(x=>x.prefill),{})
    await assert.rejects(publicCall({action:'submit',token,version:0,termsVersion:'2026-10-28',values:{}}),e=>e.statusCode===400&&Boolean(e.fields.email))
    await assert.rejects(publicCall({action:'read',token:'invalid'}),e=>e.statusCode===404)
    const state=await load();state.history[0].date='2026-11-12';await save(state)
    assert.equal((await publicCall({action:'read',token})).appointment.date,'2026-11-12')
    const payload={action:'submit',token,version:0,termsVersion:'2026-10-28',values:answer()}
    assert.deepEqual(await publicCall(payload),{submitted:true});assert.deepEqual(await publicCall(payload),{submitted:true})
    assert.equal((await q('SELECT * FROM pignus_registration_responses')).length,1)
    assert.equal((await load()).history[0].formEmail,'cliente@example.com')
    assert.equal((await load()).agenda.weekly['2026-11-10'].teams[0].tasks[0].form,'Completo')
    assert.equal((await q('SELECT * FROM pignus_tickets')).length,0)
    assert.ok(!(await q('SELECT encrypted FROM pignus_registration_responses'))[0].encrypted.includes('palabra-abonado'))
    assert.ok(!JSON.stringify(await load()).includes('palabra-abonado'))
    item=(await call('GET',{}, {serviceId:'s1'})).items[0]
    assert.equal(item.revisions[0].values.subscriberPassword,'••••');assert.equal(item.link,'')
    assert.equal((await call('GET',{}, {notices:'1'})).items.length,1)
    const inbox=await call('GET',{}, {list:'1',search:'cliente',status:'submitted'})
    assert.equal(inbox.total,1);assert.equal(inbox.counts.submitted,1)
    assert.equal(inbox.items[0].revisions,undefined);assert.equal(inbox.items[0].link,undefined)
    assert.equal(inbox.items[0].serviceId,'s1')
    const reader={id:'reader',roleCode:'custom',permissions:{__catalogV2:true,'registration.read':true,'records.read':true,'records.contact':true,'accounts.view':true}}
    await assert.rejects(call('GET',{}, {list:'1'},reader),e=>e.statusCode===403)
    await assert.rejects(call('POST',{action:'reveal',id:item.id,updatedAt:item.updatedAt}, {},reader),e=>e.statusCode===403)
    await assert.rejects(call('GET',{}, {serviceId:'s1'},{id:'tech',roleCode:'technician'}),e=>e.statusCode===403)
    assert.equal((await call('POST',{action:'reveal',id:item.id,updatedAt:item.updatedAt,version:1})).values.subscriberPassword,'palabra-abonado')
    await assert.rejects(call('POST',{action:'review',id:item.id,updatedAt:'old',verified:true}),e=>e.statusCode===409)
    item=(await call('POST',{action:'review',id:item.id,updatedAt:item.updatedAt,verified:true})).items[0]
    assert.equal((await call('GET',{}, {list:'1',status:'reviewed'})).total,1)
    assert.equal((await call('GET',{}, {notices:'1'})).items.length,0)
    item=(await call('POST',{action:'correct',id:item.id,updatedAt:item.updatedAt,reason:'Corregir teléfono'})).items[0]
    const correctedToken=item.link.split('#')[1];assert.notEqual(correctedToken,token)
    await assert.rejects(publicCall({action:'read',token}),e=>e.statusCode===404)
    const reopened=await publicCall({action:'read',token:correctedToken})
    assert.equal(reopened.prefill.name,answer().name);assert.equal(reopened.prefill.subscriberPassword,undefined);assert.equal(reopened.prefill.termsAccepted,undefined)
    await publicCall({...payload,token:correctedToken,version:1,values:{...answer(),phone:'3512222222'}})
    item=(await call('GET',{}, {id:item.id})).items[0]
    assert.equal(item.revisions.length,2);assert.ok(item.revisions[1].changed.includes('phone'));assert.equal(item.reviewedVersion,1)
    assert.equal((await call('GET',{}, {customerId:'c'})).items.length,1)
    // Adding a second journey later must retain the original link and history.
    const before=await load(),journey=structuredClone(before);journey.history[0].serviceJourney={id:'journey-1'};journey.history.push({...journey.history[0],id:'s2',sourceTaskId:'task2',date:'2026-11-13'})
    await save(journey);await native.autoCreate(before,journey,connection,kind)
    assert.equal((await q('SELECT * FROM pignus_registration_forms')).length,1)
    assert.equal((await call('GET',{}, {serviceId:'s2'})).items[0].id,item.id)
    item=(await call('POST',{action:'correct',id:item.id,updatedAt:item.updatedAt,reason:'Revisar dirección'})).items[0]
    const cancelled=await load();cancelled.history.forEach(r=>r.status='Cancelado');await save(cancelled)
    assert.equal((await call('GET',{}, {list:'1',status:'cancelled'})).total,1)
    await assert.rejects(publicCall({action:'read',token:item.link.split('#')[1]}),e=>e.statusCode===410)
    assert.equal((await call('GET',{}, {notices:'1'})).items.length,0)
    if(pg)assert.equal((await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname='pignus_registration_responses'")).rows[0].relrowsecurity,true)
  } finally {if(db)db.close();if(pg)await pg.close()}
})
