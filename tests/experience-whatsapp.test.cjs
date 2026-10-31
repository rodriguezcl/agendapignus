const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const domain = require('../api/_lib/experience-whatsapp.cjs')
const whatsapp = require('../api/_lib/appointment-whatsapp.cjs')
const { REVIEW_URL } = require('../api/_lib/installation-experience.cjs')
const env = { PIGNUS_SESSION_SECRET: 'test-secret-'.repeat(8), PIGNUS_GHL_ENABLED: 'true', PIGNUS_GHL_WEBHOOK_URL: 'https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/00000000-0000-0000-0000-000000000000', PIGNUS_GHL_EXPERIENCE_ENABLED: 'true', PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL: 'https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/11111111-1111-1111-1111-111111111111' }
const at = '2026-11-02T16:00:00.000Z', instant = Date.parse(at)
const confirmationAt = '2026-11-01T12:00:00.000Z'
const record = { id: 'visit', customerId: 'customer', client: 'Ana Prueba', clientAccount: 'PIG-1', service: 'Instalación de alarma', status: 'Pendiente', date: '2026-11-02', time: '09:00', address: 'Calle de prueba 123', phone: '+5493510000000', technicians: ['Técnico Uno', 'Técnico Dos'], awaitingConfirmation: false }
const state = r => ({ history: r ? [r] : [], customers: [{ customerId: 'customer', account: 'PIG-1', name: 'Ana Prueba' }] })
const before = state(record), after = state({ ...record, status: 'Completado' })
async function fixture(next = after) {
  const db = new DatabaseSync(':memory:'), store = whatsapp.createStore({ db, env })
  await store.ensure(); await store.enqueue(before, next, at)
  return { db, store, options: { store, env, readState: async () => next, now: () => instant } }
}

test('post-sale configuration is independent and cannot use the confirmation workflow', () => {
  assert.equal(whatsapp.configuration(env, 'experience').enabled, true)
  assert.equal(whatsapp.configuration({ ...env, PIGNUS_GHL_ENABLED: 'false' }, 'experience').enabled, true)
  assert.equal(whatsapp.anyEnabled({ ...env, PIGNUS_GHL_ENABLED: 'false' }), true)
  for (const patch of [{ PIGNUS_GHL_EXPERIENCE_ENABLED: 'false' }, { PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL: '' }, { PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL: env.PIGNUS_GHL_WEBHOOK_URL }, { PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL: 'https://evil.example/hook' }]) assert.equal(whatsapp.configuration({ ...env, ...patch }, 'experience').enabled, false)
})

test('only a new installation completion qualifies, even without email; no backfill or ordinary edits', () => {
  assert.equal(domain.changes(before, after).length, 1)
  assert.equal(domain.changes(after, after).length, 0)
  assert.equal(domain.changes(state(null), after).length, 0)
  for (const patch of [{ status: 'Cancelado' }, { status: 'Avance registrado' }, { service: 'Service de alarma' }, { technicalStatus: 'Cancelado' }, { vehicleControl: true }]) assert.equal(domain.changes(before, state({ ...after.history[0], ...patch })).length, 0)
  const payload = whatsapp.signedPayload(domain.envelope(after.history[0], after), env)
  assert.equal(payload.event, 'installation.completed.experience')
  assert.equal(payload.reviewUrl, REVIEW_URL)
  assert.equal(payload.technicians, 'Técnico Uno / Técnico Dos')
  assert.equal(payload.email, '')
  assert.deepEqual(Object.keys(payload).sort(), ['event','eventId','isTest','serviceId','firstName','lastName','customerName','email','phone','technicians','reviewUrl','serviceType','installationDescription','receiptToken'].sort())
})

test('multi-day completion uses one identity and includes all participating technicians', () => {
  const visit = (id,index,status,technicians) => ({ ...record,id,status,technicians,serviceJourney:{id:'journey',index,total:3} })
  const previous = { ...before,history:[visit('j1',1,'Avance registrado',['Uno']),visit('j2',2,'Pendiente',['Dos']),visit('j3',3,'Cancelado',['No participó'])] }
  const next = { ...previous,history:previous.history.map(r=>r.id==='j2'?{...r,status:'Completado'}:r) }
  const [item] = domain.changes(previous,next)
  assert.deepEqual(item.technicians,['Uno','Dos'])
  assert.equal(item.id,domain.envelope({...next.history[1],id:'replacement'},next).id)
  assert.equal(domain.changes(previous,{...next,history:next.history.map(r=>r.id==='j3'?{...r,status:'Pendiente'}:r)}).length,0)
})

test('transactional queue, signed callback and re-closing never resend an accepted post-sale message', async () => {
  const { db,store,options } = await fixture(); let calls=0
  try {
    db.exec('BEGIN'); await store.enqueue(state({...record,id:'rollback'}),state({...after.history[0],id:'rollback'}),at); db.exec('ROLLBACK')
    await store.enqueue(before,after,at); assert.equal((await store.list()).length,1)
    const fetchImpl=async (url,init)=>{ calls++; assert.equal(url,env.PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL); const payload=JSON.parse(init.body); assert.equal(payload.phone,record.phone); await whatsapp.receiveReceipt({store,env,input:{customData:payload},at});return new Response('{}') }
    assert.equal((await whatsapp.processWhatsApp({...options,fetchImpl})).accepted,1)
    assert.equal((await store.list())[0].status,'processed')
    await store.enqueue(before,after,at); await whatsapp.processWhatsApp({...options,fetchImpl}); assert.equal(calls,1)
    assert.equal(whatsapp.present((await store.list())[0]).kind,'experience')
  } finally {db.close()}
})

test('missing phone can be corrected after completion; queued data uses current contact and names', async () => {
  const missing=state({...after.history[0],phone:''}),{db,store,options}=await fixture(missing)
  try {
    assert.equal((await store.list())[0].status,'needs_phone')
    assert.equal((await whatsapp.processWhatsApp({...options,fetchImpl:()=>{throw Error('must not send')}})).accepted,0)
    const corrected=state({...after.history[0],technicians:['Nombre corregido']})
    let calls=0
    await whatsapp.processWhatsApp({...options,readState:async()=>corrected,fetchImpl:async(url,init)=>{calls++;assert.equal(JSON.parse(init.body).technicians,'Nombre corregido');return new Response('{}')}})
    assert.equal(calls,1)
  } finally {db.close()}
})

test('cancelled, reopened, reclassified or reassigned installations discard queued post-sale', async () => {
  for(const patch of [{status:'Cancelado'},{status:'Pendiente'},{service:'Service de cámaras'},{customerId:'different',clientAccount:'PIG-2'},{serviceJourney:{id:'different',index:1,total:1}}]) {
    const {db,store,options}=await fixture()
    try {assert.equal((await whatsapp.processWhatsApp({...options,readState:async()=>state({...after.history[0],...patch}),fetchImpl:()=>{throw Error('must not send')}})).cancelled,1)} finally {db.close()}
  }
})

test('disabling post-sale prevents enqueue and dispatch without blocking confirmation messages', async () => {
  const {db,store,options}=await fixture(),paused={...env,PIGNUS_GHL_EXPERIENCE_ENABLED:'false'}
  try {
    await whatsapp.createStore({db,env:paused}).enqueue(before,{...after,history:[...after.history,{...after.history[0],id:'old-completed'}]},at)
    assert.equal((await store.list()).length,1)
    await store.enqueue(after,{...after,history:[...after.history,{...record,id:'other',date:'2026-11-03',time:'13:00',phone:'+5493511111111'}]},at)
    assert.equal((await store.claim(at,['appointment'])).service_id,'other')
    assert.equal(await store.claim(at,['appointment']),null)
    assert.equal((await store.list()).find(r=>r.service_id==='visit').status,'queued')
    assert.equal((await whatsapp.processWhatsApp({...options,env:{},fetchImpl:()=>{throw Error('must not send')}})).paused,true)
  } finally {db.close()}
})

test('confirmation and post-sale share the contact lock until the prior workflow callback', async () => {
  const db=new DatabaseSync(':memory:'),store=whatsapp.createStore({db,env})
  try {
    await store.enqueue(state(null),before,confirmationAt)
    const confirmation=await store.claim(confirmationAt,['appointment']);await store.finish(confirmation,'accepted',null,confirmationAt)
    await store.enqueue(before,after,at)
    assert.equal(await store.claim(at,['experience']),null)
    await whatsapp.receiveReceipt({store,env,input:whatsapp.signedPayload(confirmation.payload,env),at})
    assert.equal((await store.claim(at,['experience'])).payload.kind,'experience')
  } finally {db.close()}
})

test('PostgreSQL supports kind filtering, rollback and shared contact serialization', async () => {
  const {PGlite}=require('@electric-sql/pglite'),pg=new PGlite(),sql={unsafe:async(text,params=[])=>(await pg.query(text,params)).rows}
  const store=whatsapp.createStore({sql,env})
  try {
    await store.ensure();await pg.exec('BEGIN');await store.enqueue(before,after,at);await pg.exec('ROLLBACK');assert.equal((await store.list()).length,0)
    await store.enqueue(state(null),before,confirmationAt)
    const appointment=await store.claim(confirmationAt,['appointment']);assert.equal(appointment.payload.kind,'appointment')
    await store.enqueue(before,after,at)
    assert.equal(await store.claim(at,['experience']),null)
    await store.acknowledge(appointment.id,at)
    const postSale=await store.claim(at,['experience']);assert.equal(postSale.payload.kind,'experience')
    await store.finish(postSale,'accepted',null,at);await store.enqueue(before,after,at)
    assert.equal(await store.claim(at,['experience']),null)
  } finally {await pg.close()}
})

test('account notifications distinguish channel activation and preserve access restrictions', async () => {
  const {db,store}=await fixture(), saved=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]))
  try {
    Object.assign(process.env,env)
    const {experienceRequest}=require('../api/_lib/installation-experience-http.cjs')
    const request=(user={roleCode:'administrator'})=>experienceRequest({connection:db,kind:'db',state:after,user,method:'GET',query:{notices:'1'}})
    assert.equal((await request()).items.length,0)
    process.env.PIGNUS_GHL_EXPERIENCE_ENABLED='false'
    const paused=await request()
    assert.equal(paused.whatsappActive,true)
    assert.equal(paused.whatsappExperienceActive,false)
    assert.equal(paused.items[0].kind,'experience')
    assert.equal(paused.items[0].channel,'whatsapp')
    assert.equal(paused.items[0].recipient,record.phone)
    assert(!JSON.stringify(paused).includes('receiptToken'))
    assert(!JSON.stringify(paused).includes('leadconnectorhq'))
    await assert.rejects(request({roleCode:'operator'}),{statusCode:403})
    const reader={roleCode:'custom',permissions:{__catalogV2:true,'accounts.view':true,'records.read':true,'records.contact':true,'notifications.experience':false}}
    assert.deepEqual((await request(reader)).items,[])
    const claim=await store.claim(at,['experience']);await store.finish(claim,'accepted',null,at)
    assert.equal((await request()).items.length,0)
  } finally {
    for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value
    db.close()
  }
})

test('the existing service-save hook queues email and WhatsApp together and rolls both back', async () => {
  const db=new DatabaseSync(':memory:'),saved=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]))
  try {
    Object.assign(process.env,env)
    const mail=require('../api/_lib/installation-experience-store.cjs').createExperienceStore({db}),wa=whatsapp.createStore({db})
    await mail.ensure();await wa.ensure()
    db.exec('BEGIN');await mail.enqueue(before,after,at);db.exec('ROLLBACK')
    assert.equal((await mail.list()).length,0);assert.equal((await wa.list()).length,0)
    await mail.enqueue(before,after,at)
    assert.equal((await mail.list())[0].status,'needs_email')
    assert.equal((await wa.list())[0].status,'queued')
  } finally {
    for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value
    db.close()
  }
})
