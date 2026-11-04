const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const whatsapp = require('../api/_lib/appointment-whatsapp.cjs')
const notice = require('../api/_lib/appointment-notice.cjs')
const experience = require('../api/_lib/experience-whatsapp.cjs')

const created = '2026-10-30T15:00:00.000Z'
const corrected = '2026-11-01T13:00:00.000Z'
const due = '2026-11-01T12:00:00.000Z'
const phone = '+5493510000000'
const env = { PIGNUS_SESSION_SECRET:'test-secret-'.repeat(8), PIGNUS_GHL_CAMERAS_ENABLED:'true',
  PIGNUS_GHL_CAMERAS_WEBHOOK_URL:'https://services.leadconnectorhq.com/hooks/TEST/webhook-trigger/cameras' }
const first = { id:'first', customerId:'customer', client:'Cliente de prueba', service:'Instalación de cámaras',
  status:'Pendiente', date:'2026-11-02', time:'09:00', address:'Dirección de prueba', phone:'Sin registrar',
  technicians:['Técnico de prueba'], serviceJourney:{id:'journey',index:1,total:3} }
const visits = [first, {...first,id:'second',date:'2026-11-03',serviceJourney:{id:'journey',index:2,total:3}},
  {...first,id:'third',date:'2026-11-04',serviceJourney:{id:'journey',index:3,total:3}}]
const state = (contact='', history=visits) => ({ history, customers:[{customerId:'customer',account:'CLI-TEST',name:'Cliente de prueba',phone:contact}] })
async function fixture(t, at=created) {
  const db = new DatabaseSync(':memory:')
  t.after(()=>db.close())
  const store = whatsapp.createStore({db,env})
  await store.enqueue(state('',[]),state(),at)
  return {db,store}
}

test('updating only the account repairs the first journey reminder and preserves its original deadline',async t=>{
  const {store}=await fixture(t)
  const [before]=await store.list()
  assert.equal(before.status,'needs_phone')
  await store.enqueue(state(),state(phone),corrected)
  const rows=await store.list()
  assert.equal(rows.length,1)
  assert.equal(rows[0].service_id,'first')
  assert.equal(rows[0].status,'queued')
  assert.equal(rows[0].payload.phone,phone)
  assert.equal(rows[0].payload.confirmedAt,created)
  assert.equal(rows[0].next_attempt_at,due)
  // All snapshots are still stale: sending must use the corrected account.
  let sent=0
  await whatsapp.processWhatsApp({store,env,now:()=>Date.parse(corrected),readState:async()=>state(phone),
    fetchImpl:async(_,options)=>{sent++;assert.equal(JSON.parse(options.body).phone,phone);return new Response('{"status":"Success"}',{status:200})}})
  assert.equal(sent,1)
})

test('legacy missing-phone notices recover during reconciliation without saving the service again',async t=>{
  const {store}=await fixture(t)
  await store.reconcile(state(phone),corrected)
  const [row]=await store.list()
  assert.equal(row.status,'queued')
  assert.equal(row.payload.phone,phone)
  assert.equal(row.next_attempt_at,due)
  assert.equal(row.payload.confirmedAt,created)
})

test('an expired, started or completed first journey cannot produce a reminder for later days',async t=>{
  for(const patch of [{},{startedAt:'2026-11-02T12:00:00.000Z',status:'En proceso'},
    {completedAt:'2026-11-02T14:00:00.000Z',status:'Completado'}]) {
    const {store}=await fixture(t)
    const history=[{...first,...patch},...visits.slice(1)]
    await store.enqueue(state('',history),state(phone,history),'2026-11-04T15:30:00.000Z')
    const rows=await store.list()
    assert.equal(rows.length,1)
    assert.equal(rows[0].status,'cancelled')
    assert.equal(await store.claim('2026-11-04T15:30:00.000Z'),null)
  }
})

test('correction never bypasses the less-than-24-hours omission rule',async t=>{
  const {store}=await fixture(t,corrected)
  await store.enqueue(state(),state(phone),'2026-11-01T14:00:00.000Z')
  const [row]=await store.list()
  assert.equal(row.status,'skipped')
  assert.equal(row.payload.phone,phone)
  assert.equal(await store.claim('2026-11-01T14:00:00.000Z'),null)
})

test('account corrections do not resend successful or ambiguous deliveries',async t=>{
  for(const status of ['processed','accepted','uncertain']) {
    const {db,store}=await fixture(t)
    await store.enqueue(state(),state(phone),corrected)
    db.prepare('UPDATE pignus_appointment_whatsapp SET status=?,attempts=1').run(status)
    const before=await store.list()
    await store.enqueue(state(phone),state('+5493510000001'),'2026-11-01T14:00:00.000Z')
    assert.deepEqual(await store.list(),before)
  }
})

test('account phone is authoritative for reminders and post-sale; legacy fallback remains',()=>{
  const snapshot={...first,phone:'+5493510000001'}
  for(const envelope of [notice.envelope,experience.envelope]) {
    assert.equal(envelope(snapshot,state(phone)).phone,phone)
    assert.equal(envelope(snapshot,state('')).phone,'')
    assert.equal(envelope(snapshot,{history:[],customers:[]}).phone,snapshot.phone)
  }
})

test('a missing-phone recovery cannot change the customer or visit date silently',async t=>{
  for(const patch of [{customerId:'other'},{date:'2026-11-05'}]) {
    const {store}=await fixture(t)
    await store.reconcile(state(phone,[{...first,...patch},...visits.slice(1)]),corrected)
    assert.equal((await store.list())[0].status,'cancelled')
  }
})
