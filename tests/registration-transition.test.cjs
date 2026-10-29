const test=require('node:test'),assert=require('node:assert/strict')
const {DatabaseSync}=require('node:sqlite')
const {legacyItems,legacyNotices}=require('../api/_lib/registration-inbox.cjs')
const native=require('../api/_lib/native-registration.cjs')
const {storeFor}=require('../api/_lib/tickets-http.cjs')
const {pgliteAdapter}=require('./helpers/pglite-adapter.cjs')
const admin={id:'a',roleCode:'administrator'}
const record=(id,extra={})=>({id,service:'Instalación de alarma',client:'Cliente '+id,form:'Completo',formEmail:'cliente@example.com',installationZone:'docta',subscriberReservation:true,date:'2026-11-03',time:'09:00',status:'Pendiente',...extra})
const ticket=(id,extra={})=>({id,number:id,status:'Nuevo',form:{kind:'docta',candidates:['cliente@example.com'],multiple:false},...extra})

test('transition reconciles only unambiguous matches, preserves journeys, cancellation and native sources',()=>{
  const visits=[record('s1',{serviceJourney:{id:'j1'}}),record('s2',{serviceJourney:{id:'j1'},date:'2026-11-04'})]
  const state={history:visits,customers:[]}
  const before=JSON.stringify(state)
  const items=legacyItems(state,admin,[ticket('t1'),ticket('t2')])
  assert.equal(items.length,1);assert.equal(items[0].match,'email');assert.equal(items[0].tickets.length,2)
  assert.deepEqual(legacyNotices(items)[0].recordIds,['s1','s2']);assert.equal(JSON.stringify(state),before)
  const ambiguous=legacyItems({...state,history:[...visits,record('other')]},admin,[ticket('t1')])
  assert.equal(ambiguous.length,3);assert.equal(ambiguous.find(r=>r.tickets.length).serviceId,'')
  const linked=legacyItems({...state,history:[...visits,record('other')]},admin,[ticket('t1',{form:{kind:'docta',serviceId:'s2',email:'cliente@example.com'}})])
  assert.equal(linked.find(r=>r.tickets.length).serviceId,'s1')
  const cancelled=legacyItems({history:visits.map(r=>({...r,status:'Cancelado'}))},admin,[ticket('t1')])
  assert.equal(cancelled[0].status,'cancelled');assert.equal(legacyNotices(cancelled).length,0)
  const nativeOnly=legacyItems(state,admin,[],[{id:'journey:j1',service_id:'s1'}]);assert.equal(nativeOnly.length,0)
  // Authorized Google tickets must not silently disappear when a native link exists.
  assert.equal(legacyItems(state,admin,[ticket('t1',{form:{kind:'docta',serviceId:'s1'}})],[{id:'journey:j1',service_id:'s1'}]).length,1)
  assert.equal(legacyItems(state,{id:'a',roleCode:'technician'},[ticket('t1')]).length,0)
})

test('same reconciliation suppresses only covered notices for bell and push',async()=>{
  const {combineRegistrationNotifications}=await import('../shared/registration/notifications.mjs')
  const forms=legacyNotices(legacyItems({history:[record('s1')]},admin,[ticket('t1')]))
  const op=[{id:'reservation:s1',target:{type:'reservation',recordId:'s1'}},{id:'reservation:other',target:{recordId:'other'}},{id:'collection:s1',target:{recordId:'s1'}}]
  const tickets=[{id:'ticket-event:1',target:{ticketId:'t1'}},{id:'ticket:t2',target:{ticketId:'t2'}}]
  assert.equal(combineRegistrationNotifications(op,tickets,forms).length,4)
  assert.equal(combineRegistrationNotifications(op,tickets,[]).length,5)
})

for(const engine of ['sqlite','postgres'])test(engine+': unified inbox, scoped Google detail, pending PIG and no customer mutations',async()=>{
  let db,pg,connection,kind
  if(engine==='sqlite'){db=new DatabaseSync(':memory:');connection=db;kind='db'}
  else{const {PGlite}=await import('@electric-sql/pglite');pg=await PGlite.create();connection=pgliteAdapter(pg);kind='sql'}
  try{
    const tickets=storeFor(connection,kind);await tickets.ensure()
    const query=async(sql,args=[])=>kind==='sql'?connection.unsafe(require('../api/_lib/ticket-mail-store.cjs').sqlParameters(sql),args):/SELECT/.test(sql)?db.prepare(sql).all(...args):(db.prepare(sql).run(...args),[])
    const raw={id:'t1',number:'1001',status:'Nuevo',createdById:'someone',serviceIds:[],title:'Alta de Servicio - Docta Urbanización',description:'1 respuesta nueva. Ver respuesta: cliente@example.com',version:1,updatedAt:'2026-10-29T10:00:00Z'}
    await query('INSERT INTO pignus_tickets(id,number,status,updated_at,search_text,data) VALUES (?,?,?,?,?,?)',[raw.id,raw.number,raw.status,raw.updatedAt,'fixture',JSON.stringify(raw)])
    const state={history:[record('s1')],customers:[],employees:[],roles:[]},before=JSON.stringify(state)
    const call=(query,user=admin)=>native.handle({connection,kind,user,method:'GET',query,formState:{load:async()=>state,save:async()=>{throw new Error('Read must not save customer data')}}})
    const list=await call({list:'1'});assert.equal(list.total,1);assert.equal(list.items[0].tickets[0].id,'t1')
    const detail=await call({legacyId:list.items[0].id});assert.equal(detail.item.email,'cliente@example.com')
    const notices=(await call({notices:'1'})).items;assert.equal(notices.length,1);assert.deepEqual(notices[0].ticketIds,['t1'])
    assert.equal((await native.notices(connection,kind,state,admin)).length,1)
    assert.equal((await call({list:'1',search:'1001'})).total,1)
    const limited={id:'limited',roleCode:'custom',permissions:{__catalogV2:true,'forms.view':true,'accounts.view':true,'registration.read':true,'records.contact':true,'records.read':true,'scope.services.read.assigned':true,'tickets.view':true,'planning.commercial':true}}
    assert.equal((await call({list:'1'},limited)).total,0)
    await assert.rejects(call({legacyId:list.items[0].id},limited),e=>e.statusCode===404)
    const noTickets={...admin,roleCode:'custom',permissions:{__catalogV2:true,'forms.view':true,'accounts.view':true,'registration.read':true,'records.contact':true,'records.read':true,'scope.services.read.all':true}}
    assert.ok((await call({list:'1'},noTickets)).items.every(r=>r.tickets.length===0))
    assert.equal(JSON.stringify(state),before)
    raw.status='Resuelto';raw.registrationForm={kind:'docta',email:'cliente@example.com',serviceId:'s1',confirmedAt:'2026-10-29'}
    await query('UPDATE pignus_tickets SET status=?,data=? WHERE id=?',[raw.status,JSON.stringify(raw),raw.id])
    assert.equal((await call({notices:'1'})).items.length,1,'remains until PIG linkage')
    state.history[0].subscriberReservation=false
    assert.equal((await call({notices:'1'})).items.length,0);assert.equal((await call({list:'1'})).items[0].status,'reviewed')
    state.history[0].status='Cancelado';assert.equal((await call({list:'1'})).items[0].status,'cancelled')
    assert.equal((await query('SELECT * FROM pignus_ticket_mail_outbox')).length,0)
    const own=record('native')
    state.history.push(own)
    const forms=native.createStore({[kind]:connection,env:{PIGNUS_REGISTRATION_ENCRYPTION_KEY:'test-only-registration-secret-more-than-32'}})
    await forms.create(own,'docta',admin,state)
    await query("UPDATE pignus_registration_forms SET version=1,reviewed_version=1,status='submitted' WHERE service_id=?",['native'])
    const pending=(await call({notices:'1'})).items
    assert.equal(pending.length,1);assert.match(pending[0].title,/vincular PIG/)
    assert.equal((await call({list:'1',status:'submitted'})).total,1)
    own.subscriberReservation=false
    assert.equal((await call({notices:'1'})).items.length,0)
    assert.equal((await call({list:'1',status:'reviewed'})).items[0].source,'native')
  }finally{db?.close();await pg?.close()}
})
