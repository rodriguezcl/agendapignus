const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const delivery = require('../api/_lib/appointment-delivery.cjs')
const notice = require('../api/_lib/appointment-notice.cjs')
const { createExperienceStore } = require('../api/_lib/installation-experience-store.cjs')
const whatsapp = require('../api/_lib/appointment-whatsapp.cjs')
const record = { id:'visit', customerId:'customer', client:'Prueba', service:'Instalación de alarma', status:'Pendiente', date:'2026-11-02', time:'09:00', address:'Dirección de prueba', phone:'+5493510000000', formEmail:'prueba@example.com', technicians:['Técnico'], awaitingConfirmation:false }
const state = (...history) => ({ history, customers:[] })
const created = '2026-10-30T15:00:00.000Z'
const due = '2026-11-01T12:00:00.000Z'
const later = '2026-11-01T12:02:00.000Z'
const env = { PIGNUS_SESSION_SECRET:'test-secret-'.repeat(8), PIGNUS_GHL_ENABLED:'true', PIGNUS_GHL_WEBHOOK_URL:'https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/test', PIGNUS_GHL_CAMERAS_ENABLED:'true', PIGNUS_GHL_CAMERAS_WEBHOOK_URL:'https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/cameras' }
const cancelledByTechnician = (visit, at) => ({...visit,status:'Cancelado',technicalStatus:'Cancelado',technicalReportedAt:at,technicalReportedById:'tech',technicalObservation:'Observación interna del técnico'})
async function fixture(channel) {
  const db = new DatabaseSync(':memory:')
  const store = channel === 'email' ? createExperienceStore({db}) : whatsapp.createStore({db,env})
  await store.ensure()
  return {db,store}
}
test('technician cancellation emails after the appointment, with or without a previous reminder, once per report', async()=>{
  const at='2026-11-02T12:30:00.000Z'
  for(const service of ['Instalación de alarma','Instalación de cámaras']) for(const reminded of [false,true]) {
    const {db,store}=await fixture('email'),visit={...record,service},cancelled=cancelledByTechnician(visit,at)
    try {
      if(reminded) {
        await store.enqueue(state(),state(visit),created)
        await store.finish(await store.claim(due),'sent',null,due)
      }
      await store.enqueue(state(visit),state(cancelled),at)
      let calls=0
      const run=()=>require('../api/_lib/installation-experience-worker.cjs').processExperienceMail({store,readState:async()=>state(cancelled),now:()=>Date.parse(at),config:{enabled:true,mode:'live',address:'soporte@example.com'},smtpFactory:()=>({send:async ({payload})=>{
        calls++
        assert.match(payload.text,/No fue posible realizar la visita/)
        assert.match(payload.text,/solicitar una nueva fecha/)
        assert.doesNotMatch(payload.text,/no concurrirá|Observación interna/)
        return {accepted:[payload.to]}
      },close(){}})})
      await run()
      await store.enqueue(state(visit),state(cancelled),at)
      await run()
      assert.equal(calls,1)
      assert.equal((await store.list()).filter(row=>row.payload.cancelledNotice).length,1)
    } finally {db.close()}
  }
})
test('technician cancellation before the visit supersedes reminder and does not duplicate cancellation mail',async()=>{
  const {db,store}=await fixture('email'),cancelled=cancelledByTechnician(record,later)
  try {
    await store.enqueue(state(),state(record),created)
    await store.finish(await store.claim(due),'sent',null,due)
    await store.enqueue(state(record),state(cancelled),later)
    assert.equal((await store.list()).filter(row=>row.payload.cancelledNotice).length,1)
    assert.equal((await store.claim(later)).payload.technicalCancellation,true)
  } finally {db.close()}
})
test('camera cancellation without email requires audited manual contact, not an email address',async()=>{
  const {db,store}=await fixture('email'),visit={...record,service:'Instalación de cámaras',formEmail:''},cancelled=cancelledByTechnician(visit,later)
  const {experienceRequest}=require('../api/_lib/installation-experience-http.cjs')
  const admin={id:'admin',roleCode:'administrator',name:'Administración'}
  const current={history:[cancelled],customers:[{customerId:'customer',account:'PIG-1',name:'Prueba'}]}
  const request=(user,method='GET',input={})=>experienceRequest({connection:db,kind:'db',state:current,user,method,input,query:{customerId:'customer',notices:'1'}})
  try {
    await store.enqueue(state(visit),current,later)
    const [row]=await store.list()
    assert.equal(row.status,'needs_action');assert.equal(row.payload.manualContact,true)
    assert.equal(await store.claim(later),null)
    const {items}=await request(admin)
    assert.equal(items.length,1);assert.equal(items[0].phone,visit.phone);assert.equal(items[0].manualContact,true)
    await assert.rejects(request({id:'op',roleCode:'operator'}),/acceso/)
    const input={id:row.id,updatedAt:row.updated_at,action:'confirm-contact',contactChannel:'whatsapp',verified:true}
    await assert.rejects(request(admin,'POST',{...input,verified:false}),/Confirmá/)
    await assert.rejects(request(admin,'POST',{...input,contactChannel:'email'}),/teléfono/)
    await request(admin,'POST',input)
    assert.equal((await request(admin)).items.length,0)
    const managed=await store.get(row.id)
    assert.equal(managed.status,'reviewed');assert.equal(managed.history.at(-1).byId,'admin')
    assert.equal(managed.history.at(-1).contactChannel,'whatsapp')
    await assert.rejects(request(admin,'POST',input),/cambió|Confirmá/)
    assert.equal(await store.claim(later),null)
  } finally {db.close()}
})

test('reprogramming removes the manual contact alert and rejects stale management',async()=>{
  const {db,store}=await fixture('email'),visit={...record,formEmail:''},cancelled=cancelledByTechnician(visit,later)
  try {
    await store.enqueue(state(visit),state(cancelled),later)
    const [row]=await store.list()
    await store.reconcile(state({...visit,date:'2026-11-05'}),later)
    assert.equal((await store.get(row.id)).status,'cancelled')
    await assert.rejects(store.confirmContact(row,{id:'admin'},'phone'),/cambió|actualiz/i)
  } finally {db.close()}
})

test('legacy missing email cancellations migrate to manual contact',async()=>{
  const visit={...record,formEmail:''},cancelled=cancelledByTechnician(visit,later)
  const [{payload}]=delivery.cancellations(state(visit),state(cancelled),[],later,'email')
  const changes=[]
  await delivery.reconcile({rows:[{id:payload.id,service_id:visit.id,status:'needs_email',payload:{...payload,manualContact:undefined},next_attempt_at:later}],state:state(cancelled),at:later,channel:'email',save:async(_,value)=>changes.push(value)})
  assert.equal(changes[0].status,'needs_action');assert.equal(changes[0].payload.manualContact,true)
})

test('technical cancellation without email does not duplicate the manual alert in WhatsApp',()=>{
  const visit={...record,formEmail:''},cancelled=cancelledByTechnician(visit,later)
  const item=notice.envelope(visit,state(visit))
  const rows=[{service_id:visit.id,status:'processed',payload:item}]
  assert.deepEqual(delivery.cancellations(state(visit),state(cancelled),rows,later,'whatsapp'),[])
  assert.equal(delivery.cancellations(state(visit),state(cancelled),[],later,'email').length,1)
})

test('technical cancellation is not backfilled, does not treat rescheduling as cancellation, and becomes stale after rescheduling',()=>{
  const cancelled=cancelledByTechnician(record,later)
  assert.deepEqual(delivery.cancellations(state(cancelled),state(cancelled),[],later,'email'),[])
  assert.deepEqual(delivery.cancellations(state(),state(cancelled),[],later,'email'),[])
  assert.deepEqual(delivery.cancellations(state(record),state({...cancelled,status:'Requiere revisión',technicalStatus:'Reprogramación solicitada'}),[],later,'email'),[])
  assert.deepEqual(delivery.cancellations(state(record),state(cancelled),[],later,'whatsapp'),[])
  const [{payload}]=delivery.cancellations(state(record),state(cancelled),[],later,'email')
  assert.equal(delivery.current({...record,date:'2026-11-05'},payload,state(record),'email',later),false)
  assert.equal(delivery.current(cancelledByTechnician(record,'2026-11-05T12:30:00.000Z'),payload,state(record),'email',later),false)
})
test('a cancelled journey visit invites coordination even when another day is still scheduled',()=>{
  const first={...record,serviceJourney:{id:'journey',index:1,total:2}}
  const second={...first,id:'day2',date:'2026-11-03',serviceJourney:{id:'journey',index:2,total:2}}
  const rows=delivery.cancellations(state(first,second),state(cancelledByTechnician(first,later),second),[],later,'email')
  assert.equal(rows.length,1);assert.equal(rows[0].payload.serviceId,first.id)
})
for (const channel of ['email','whatsapp']) {
  test(`${channel}: schedules alarms and cameras at 24 hours, delayed worker claims once`, async () => {
    for (const service of ['Instalación de alarma','Instalación de cámaras']) {
      const {db,store} = await fixture(channel), visit = {...record,service}
      try {
        await store.enqueue(state(),state(visit),created)
        const [row] = await store.list()
        assert.equal(row.status,'queued'); assert.equal(row.next_attempt_at,due)
        assert.equal(await store.claim('2026-11-01T11:59:59.999Z'),null)
        await store.reconcile(state(visit),later)
        assert.equal((await store.claim(later)).id,row.id)
        assert.equal(await store.claim(later),null)
      } finally {db.close()}
    }
  })
  test(`${channel}: less than 24 hours is omitted, including next-day bookings; exact boundary allowed`, async () => {
    for (const [at,status] of [[due,'queued'],['2026-11-01T12:00:00.001Z','skipped'],['2026-11-02T10:00:00.000Z','skipped']]) {
      const {db,store} = await fixture(channel)
      try {
        await store.enqueue(state({...record,awaitingConfirmation:true}),state(record),at)
        assert.equal((await store.list())[0].status,status)
        if(status==='skipped')assert.equal(await store.claim(at),null)
      } finally {db.close()}
    }
  })
  test(`${channel}: awaiting confirmation sends nothing; rescheduling replaces deadline; cancellation discards queue`, async () => {
    const {db,store} = await fixture(channel), moved={...record,date:'2026-11-04'}
    try {
      await store.enqueue(state(),state({...record,awaitingConfirmation:true}),created)
      assert.equal((await store.list()).length,0)
      await store.enqueue(state(),state(record),created)
      await store.enqueue(state(record),state(moved),'2026-10-31T15:00:00.000Z')
      const rows=await store.list()
      assert.equal(rows.find(r=>r.payload.date===record.date).status,'cancelled')
      assert.equal(rows.find(r=>r.payload.date===moved.date).next_attempt_at,'2026-11-03T12:00:00.000Z')
      assert.equal(await store.claim(due),null)
      await store.enqueue(state(moved),state({...moved,status:'Cancelado'}),due)
      assert.equal(await store.claim('2026-11-03T12:00:00.000Z'),null)
    } finally {db.close()}
  })
  test(`${channel}: communicated visit reschedules immediately, including a return to its original date`, async () => {
    const {db,store} = await fixture(channel), moved={...record,date:'2026-11-04'}
    try {
      await store.enqueue(state(),state(record),created)
      const first=await store.claim(due)
      await store.finish(first,channel==='email'?'sent':'processed',null,due)
      await store.enqueue(state(record),state(moved),later)
      const update=await store.claim(later)
      assert(update); assert.equal(update.payload.immediateUpdate,true)
      await store.finish(update,channel==='email'?'sent':'processed',null,later)
      const backAt='2026-11-01T12:04:00.000Z'
      await store.enqueue(state(moved),state(record),backAt)
      await store.reconcile(state(record),backAt)
      const back=await store.claim(backAt)
      assert(back);assert.notEqual(back.id,first.id);assert.equal(back.payload.id,back.id)
    } finally {db.close()}
  })
  test(`${channel}: cancellation after communication uses cancellation mail or manual WhatsApp, never confirmation template`, async () => {
    const {db,store} = await fixture(channel)
    try {
      await store.enqueue(state(),state(record),created)
      const first=await store.claim(due)
      await store.finish(first,channel==='email'?'sent':'processed',null,due)
      await store.enqueue(state(record),state({...record,status:'Cancelado'}),later)
      const cancellation=(await store.list()).find(r=>r.payload.cancelledNotice)
      assert(cancellation)
      assert.equal(cancellation.status,channel==='email'?'queued':'needs_action')
      if(channel==='whatsapp')assert.equal(await store.claim(later),null)
      else assert.match(require('../api/_lib/appointment-confirmation.cjs').message(cancellation.payload).text,/cancelad/i)
    } finally {db.close()}
  })
  test(`${channel}: first journey day only, no late confirmation after start`, async () => {
    const {db,store}=await fixture(channel)
    const first={...record,serviceJourney:{id:'journey',index:1,total:2}}
    const second={...first,id:'day2',date:'2026-11-03',serviceJourney:{id:'journey',index:2,total:2}}
    try {
      await store.enqueue(state(),state(first,second),created)
      assert.equal((await store.list()).length,1)
      await store.reconcile(state(first,second),'2026-11-02T12:00:00.000Z')
      assert.equal(await store.claim('2026-11-02T12:00:00.000Z'),null)
    } finally {db.close()}
  })
}
test('legacy queue migrates using original confirmation time and preserves retries and communicated receipts', async()=>{
  const item=notice.envelope(record,state(record))
  for(const [createdAt,status] of [[created,'queued'],[later,'skipped']]) {
    const row={id:item.id,payload:item,status:'queued',created_at:createdAt,next_attempt_at:createdAt,service_id:record.id,attempts:0}
    const changes=[]
    await delivery.reconcile({rows:[row],state:state(record),at:later,channel:'email',save:async(_,value)=>changes.push(value)})
    assert.equal(changes[0].status,status);assert.equal(changes[0].nextAt,due)
  }
  const planned=delivery.plan(item,[],created,'email')
  const row={id:item.id,payload:planned.payload,status:'retry',created_at:created,next_attempt_at:'2026-11-01T12:10:00.000Z',service_id:record.id,attempts:2}
  const changes=[]
  await delivery.reconcile({rows:[row],state:state(record),at:later,channel:'email',save:async(_,value)=>changes.push(value)})
  assert.equal(changes.length,0)
  await delivery.reconcile({rows:[{...row,status:'sent'}],state:state(),at:later,channel:'email',save:async()=>assert.fail('sent receipt must not change')})
  assert.deepEqual(delivery.cancellations(state(record),state(),[{...row,status:'sent'}],'2026-11-02T12:00:00.000Z','email'),[])
  assert.deepEqual(delivery.cancellations(state({...record,status:'Completado'}),state(),[{...row,status:'sent'}],later,'email'),[])
})

test('workers wait until the deadline and send one confirmation per channel', async()=>{
  for(const channel of ['email','whatsapp']) {
    const {db,store}=await fixture(channel)
    let time=Date.parse(created),calls=0
    const options={store,readState:async()=>state(record),now:()=>time}
    const run=channel==='email'
      ? ()=>require('../api/_lib/installation-experience-worker.cjs').processExperienceMail({...options,config:{enabled:true,mode:'live',address:'soporte@example.com'},smtpFactory:()=>({send:async item=>{calls++;return {accepted:[item.payload.to]}},close(){}})})
      : ()=>whatsapp.processWhatsApp({...options,env,fetchImpl:async()=>{calls++;return new Response('{}')}})
    try {
      await store.enqueue(state(),state(record),created)
      await run();assert.equal(calls,0)
      time=Date.parse(due)-1;await run();assert.equal(calls,0)
      time=Date.parse(later);await run();assert.equal(calls,1)
      await run();assert.equal(calls,1)
    } finally {db.close()}
  }
})

test('deleted communicated visits retain an authorized manual cancellation alert and audit', async()=>{
  const {db,store}=await fixture('whatsapp')
  const {experienceRequest}=require('../api/_lib/installation-experience-http.cjs')
  const admin={id:'admin',roleCode:'administrator',name:'Administración'}
  const deleted={history:[],customers:[{customerId:'customer',account:'PIG-1',name:'Prueba'}]}
  const request=(user,method='GET',input={})=>experienceRequest({connection:db,kind:'db',state:deleted,user,method,input,query:{customerId:'customer',notices:'1'}})
  try {
    await store.enqueue(state(),state(record),created)
    await store.finish(await store.claim(due),'processed',null,due)
    await store.enqueue(state(record),deleted,later)
    const {items}=await request(admin)
    assert.equal(items.length,1);assert.equal(items[0].status,'needs_action')
    await assert.rejects(request({id:'op',roleCode:'operator'}),/acceso/)
    await assert.rejects(request(admin,'POST',{id:items[0].id,updatedAt:items[0].updatedAt,action:'review-whatsapp',verified:false}),/Comprobá/)
    await request(admin,'POST',{id:items[0].id,updatedAt:items[0].updatedAt,action:'review-whatsapp',verified:true})
    assert.equal((await request(admin)).items.length,0)
    const row=(await store.list()).find(item=>item.payload.cancelledNotice)
    assert.equal(row.history.at(-1).action,'cancellation_contacted_manually')
    assert.equal(await store.claim(later),null)
  } finally {db.close()}
})
