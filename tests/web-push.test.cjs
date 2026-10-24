const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const push = require('../api/_lib/web-push.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { userForEmployee } = require('../api/_lib/core.cjs')
const subscription = (suffix='one') => { const key = crypto.createECDH('prime256v1'); key.generateKeys(); return {endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,keys:{p256dh:key.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}} }
test('push validates providers and keys, separates worker authorization and hides private lock-screen details', () => {
  const input = subscription()
  assert.deepEqual(push.validateSubscription(input),input)
  for (const endpoint of ['http://fcm.googleapis.com/a','https://localhost/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://user:pass@fcm.googleapis.com/a','https://fcm.googleapis.com:444/a']) assert.throws(()=>push.validateSubscription({...input,endpoint}))
  assert.throws(()=>push.validateSubscription({...input,keys:{...input.keys,auth:'bad'}}))
  const env={PIGNUS_SESSION_SECRET:'s'.repeat(64)}
  assert(push.workerAuthorized({headers:{authorization:`Bearer ${push.workerSecret(env)}`}},env))
  assert(!push.workerAuthorized({headers:{authorization:'Bearer incorrect'}},env))
  assert(!push.workerAuthorized({headers:{}},{}))
  const payload=push.payloadFor([{id:'collection:1',title:'private name',detail:'$ 1234 / private address'}],'u')
  assert(!JSON.stringify(payload).includes('private')); assert.equal(payload.noticeId,'collection:1')
})
test('push detects grouped additions and new ticket messages without re-alerting the fallback after reading',()=>{
  const notice={id:'group',soundKeys:['a','b']},seen=push.snapshotKeys([notice])
  assert.equal(push.newNotices([{...notice,soundKeys:['b','c']}],seen).length,1)
  assert.equal(push.newNotices([{...notice,soundKeys:['b']}],seen).length,0)
  const message={id:'ticket-notice:1',target:{type:'ticket',ticketId:'t'}}
  const ticketSeen=push.snapshotKeys([message])
  assert.equal(push.newNotices([{id:'ticket:t',target:message.target}],ticketSeen).length,0)
  assert.equal(push.newNotices([{...message,id:'ticket-notice:2'}],ticketSeen).length,1)
})
test('PostgreSQL subscriptions: silent enrollment, due dates, ownership, retries, expiry, revocation and inactive users',async()=>{
  const {PGlite}=await import('@electric-sql/pglite'),pg=await PGlite.create(),sql=pgliteAdapter(pg)
  try{
    await pg.exec('create role anon; create role authenticated; create table pignus_preferences(key text primary key,value text);')
    await pg.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261024_web_push.sql'),'utf8'))
    await pg.exec("insert into pignus_push_config values(true,'public','private','https://example.test')")
    const roles=[{id:'r',name:'Cobranzas',code:'collections',permissions:{__catalogV2:true,'collections.view':true,'records.read':true,'records.financial':true}}]
    const employee={id:'u',name:'QA',status:'Activo',roleId:'r',role:'Cobranzas'}
    const state={roles,employees:[employee],history:[],customers:[],services:[],vehicles:[],reviews:[],preferences:{},agenda:{teams:[],weekly:{}}}
    const user=userForEmployee(employee,roles),readState=async()=>state,input=subscription()
    const call=(method,body,actor=user)=>push.request({sql,user:actor,sessionHash:'session',method,input:body,readState})
    assert.deepEqual(await call('GET'),{available:true,publicKey:'public'})
    await call('POST',{action:'subscribe',subscription:input})
    assert.equal((await call('POST',{action:'status',endpoint:input.endpoint})).enabled,true)
    await call('DELETE',{endpoint:input.endpoint},{id:'other'})
    assert.equal((await call('POST',{action:'status',endpoint:input.endpoint})).enabled,true)
    assert.equal((await call('POST',{action:'status',endpoint:input.endpoint},{id:'other'})).enabled,false)
    const record={id:'service',date:'2026-10-15',status:'Pendiente',client:'QA',amount:'100',paymentMethod:'Efectivo'}
    state.history=[record,{...record,id:'future',date:'2099-01-01'},{...record,id:'canceled',status:'Cancelado'}]
    const notices=await push.notificationsFor(sql,state,user,new Date('2026-10-24T12:00:00Z'))
    assert.deepEqual(notices.filter(n=>n.target.type==='collection').map(n=>n.id),['collection:service'])
    const denied={...user,permissions:{__catalogV2:true}}
    assert.deepEqual(await push.notificationsFor(sql,state,denied),[])
    let messages=[],available=[{id:'new',target:{type:'collection'}}]
    const run=(send=async(c,s,p)=>{messages.push(p)})=>push.processPush({sql,readState,select:async()=>available,send})
    const due=()=>pg.exec("update pignus_push_subscriptions set next_attempt_at=now()-interval '1 minute'")
    assert.equal((await run()).sent,1); await due(); assert.equal((await run()).sent,0)
    available=[{id:'later'}]; await due(); assert.equal((await run(async()=>{throw Object.assign(new Error('network'),{statusCode:503})})).failed,1)
    await due(); assert.equal((await run()).sent,1); await due(); assert.equal((await run()).sent,0)
    available=[]; await due(); await run(); available=[{id:'later'}]; await due(); assert.equal((await run()).sent,1)
    available=[{id:'expired'}]; await due(); assert.equal((await run(async()=>{throw Object.assign(new Error('gone'),{statusCode:410})})).removed,1)
    assert.equal((await call('POST',{action:'status',endpoint:input.endpoint})).enabled,false)
    await call('POST',{action:'subscribe',subscription:input}); await push.revokeSession(sql,'session')
    assert.equal((await call('POST',{action:'status',endpoint:input.endpoint})).enabled,false)
    await call('POST',{action:'subscribe',subscription:input})
    await push.request({sql,user,sessionHash:'renewed',method:'POST',input:{action:'status',endpoint:input.endpoint},readState})
    await push.revokeSession(sql,'session')
    assert.equal((await pg.query('select count(*)::int as count from pignus_push_subscriptions')).rows[0].count,1)
    await push.revokeSession(sql,'renewed')
    assert.equal((await call('POST',{action:'status',endpoint:input.endpoint})).enabled,false)
    await call('POST',{action:'subscribe',subscription:input}); employee.status='Inactivo'; assert.equal((await run()).removed,1)
    assert.equal((await pg.query('select count(*)::int as count from pignus_push_subscriptions')).rows[0].count,0)
    assert.equal((await pg.query("select has_table_privilege('anon','pignus_push_config','select') as allowed")).rows[0].allowed,false)
  }finally{await pg.close()}
})
test('service worker always shows a notification, opens only this origin and preserves active forms',async()=>{
  const vm=require('node:vm'),handlers={},shown=[],opened=[],messaged=[]
  const client={url:'https://example.test/',postMessage:data=>messaged.push(data),focus:async()=>{}}
  let clients=[]
  const self={location:{origin:'https://example.test'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url)}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/push-sw.js'),'utf8'),{self,URL})
  let work;handlers.push({data:{json:()=>({body:'QA',noticeId:'n',userId:'u',url:'https://evil.test'})},waitUntil:p=>work=p});await work;assert.equal(shown.length,1)
  const event={notification:{close(){},data:shown[0][1].data},waitUntil:p=>work=p}
  handlers.notificationclick(event);await work;assert.equal(new URL(opened[0]).origin,'https://example.test')
  clients=[client];handlers.notificationclick(event);await work;assert.equal(opened.length,1);assert.equal(messaged[0].noticeId,'n')
})
