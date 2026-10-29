const test=require('node:test'),assert=require('node:assert/strict')
const {DatabaseSync}=require('node:sqlite')
const native=require('../api/_lib/native-registration.cjs')
process.env.PIGNUS_REGISTRATION_ENCRYPTION_KEY='inbox-test-only-encryption-key-more-than-32'
test('inbox paginates summaries, filters status/type/search, enforces scope and never decrypts answers',async()=>{
  const db=new DatabaseSync(':memory:')
  try {
    const state={history:[],customers:[],employees:[],roles:[],agenda:{weekly:{}}}
    const store=native.createStore({db});await store.ensure()
    for(let i=0;i<23;i++) {
      const record={id:'s'+i,client:'Cliente '+i,service:'Instalación de alarma',date:'2026-11-10',time:'10:00',status:i===0?'Cancelado':'Pendiente',installationZone:i%2?'docta':'residencial'}
      state.history.push(record);await store.create(record,record.installationZone,{name:'Fixture'})
    }
    // Invalid encrypted payload proves the summary does not attempt decryption.
    await store.query("UPDATE pignus_registration_forms SET version=1,status='submitted' WHERE id='service:s1'")
    await store.query("INSERT INTO pignus_registration_responses (form_id,version,submitted_at,encrypted,terms_version,terms_hash,terms_text) VALUES ('service:s1',1,'2026-10-28','not-an-encrypted-answer','test','test','test')")
    const admin={id:'a',roleCode:'administrator'},call=(query,user=admin)=>native.handle({connection:db,kind:'db',user,method:'GET',query:{list:'1',...query},formState:{load:async()=>state}})
    const page1=await call({}),page2=await call({page:'2'})
    assert.equal(page1.total,23);assert.equal(page1.items.length,20);assert.equal(page2.items.length,3)
    assert.equal(new Set([...page1.items,...page2.items].map(r=>r.id)).size,23)
    assert.equal(page1.counts.submitted,1);assert.equal(page1.counts.cancelled,1)
    assert.ok(page1.items.every(row=>!('revisions' in row)&&!('link' in row)&&!('token_hash' in row)))
    assert.equal((await call({status:'submitted'})).total,1)
    assert.equal((await call({search:'cliente 22',kind:'residencial'})).total,1)
    assert.equal((await call({search:'cliente 22',kind:'docta'})).total,0)
    assert.equal((await call({page:'999'})).page,2)
    const limited={id:'unassigned',roleCode:'custom',permissions:{__catalogV2:true,'forms.view':true,'registration.read':true,'records.read':true,'records.contact':true,'accounts.view':true,'scope.services.read.assigned':true}}
    assert.equal((await call({},limited)).total,0)
    assert.deepEqual(Object.values((await call({},limited)).counts),[0,0,0,0,0])
    await assert.rejects(call({},{id:'tech',roleCode:'technician'}),e=>e.statusCode===403)
  }finally{db.close()}
})
