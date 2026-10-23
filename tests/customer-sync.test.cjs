const test = require('node:test')
const assert = require('node:assert/strict')
const { request, worker, publicStatus, handle } = require('../api/_lib/customer-sync.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

test('solicitudes repetidas comparten trabajo y solo una consulta lo toma', () => {
  const state = {}, now = Date.now()
  const first = request(state, now, 'operator')
  assert.equal(request(state, now + 1, 'other').id, first.id)
  assert.equal(worker(state, { action: 'poll' }, now + 2).job.id, first.id)
  assert.equal(worker(state, { action: 'poll' }, now + 3).job, null)
  assert.equal(request(state, now + 4, 'other').id, first.id)
  assert.throws(() => worker(state, { action: 'finish', jobId: 'wrong', status: 'imported' }, now + 5), { statusCode: 409 })
  worker(state, { action: 'finish', jobId: first.id, status: 'imported', count: 1064 }, now + 6)
  assert.equal(state.lastSuccess.count, 1064)
  assert.equal(worker(state, { action: 'poll' }, now + 7).job, null)
  assert.ok(worker(state, { action: 'poll' }, now + 3600003).job)
})
test('un equipo ausente y una ejecución interrumpida no simulan éxito', () => {
  const state = {}, now = Date.now()
  const { job } = worker(state, { action: 'poll' }, now)
  assert.equal(publicStatus(state, true, now + 180001).online, false)
  assert.equal(worker(state, { action: 'poll' }, now + 21 * 60000).job, null)
  assert.equal(state.job.status, 'error')
  assert.equal(state.job.code, 'WORKER_TIMEOUT')
  assert.throws(() => worker(state, { action: 'finish', jobId: job.id, status: 'imported' }, now + 22 * 60000), { statusCode: 409 })
  assert.equal(state.lastSuccess, undefined)
})
test('persistencia SQL, clave limitada, rotación y resultados', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec('create role anon; create role authenticated;')
    const sql = pgliteAdapter(pg)
    const user = { id: 'admin', roleCode: 'administrator' }
    await assert.rejects(handle({ sql, mode: 'token', user: { id: 'other', roleCode: 'technician' } }), { statusCode: 403 })
    const { token } = await handle({ sql, mode: 'token', user })
    const [stored] = await sql`select token_hash from pignus_customer_sync`
    assert.notEqual(stored.token_hash, token)
    await assert.rejects(handle({ sql, mode: 'worker', bearer: '0'.repeat(64), body: { action: 'poll' } }), { statusCode: 401 })
    const first = await handle({ sql, mode: 'request', user })
    const again = await handle({ sql, mode: 'request', user })
    assert.equal(first.job.id, again.job.id)
    const claimed = await handle({ sql, mode: 'worker', bearer: token, body: { action: 'poll' } })
    assert.equal(claimed.job.id, first.job.id)
    await assert.rejects(handle({ sql, mode: 'token', user }), { statusCode: 409 })
    await handle({ sql, mode: 'worker', bearer: token, body: { action: 'finish', jobId: claimed.job.id, status: 'unchanged', count: 1064 } })
    const status = await handle({ sql, mode: 'status', user })
    assert.equal(status.lastSuccess.count, 1064)
    assert.equal(status.job.status, 'completed')
    assert.equal(JSON.stringify(status).includes(token), false)
    await handle({ sql, mode: 'token', user })
    await assert.rejects(handle({ sql, mode: 'worker', bearer: token, body: { action: 'poll' } }), { statusCode: 401 })
  } finally { await pg.close() }
})

test('reportes completos se reconcilian una vez, con rollback y reinicio tras fallos', async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),pg=await PGlite.create()
 try {
  await pg.exec('create role anon; create role authenticated; create table presence_test (id int primary key, data jsonb);')
  const sql=pgliteAdapter(pg),user={id:'admin',roleCode:'administrator'}
  const {token}=await handle({sql,mode:'token',user})
  const report={version:1,accounts:['PIG-6000']}
  let calls=0
  const reconcileReport=async(tx,report,previous)=>{calls++;await tx`insert into presence_test values (1, ${tx.json({report,previous})}) on conflict(id) do update set data=excluded.data`}
  const run=async(body,callback=reconcileReport)=>handle({sql,mode:'worker',bearer:token,body,reconcileReport:callback})
  const {job}=await run({action:'poll'})
  const finish={action:'finish',jobId:job.id,status:'imported',count:1,report}
  await assert.rejects(run(finish,async(tx,...args)=>{await reconcileReport(tx,...args);throw Error('rollback')}),/rollback/)
  assert.equal((await sql`select * from presence_test`).length,0)
  assert.equal((await handle({sql,mode:'status',user})).job.status,'running')
  await run(finish);assert.equal(calls,2)
  await assert.rejects(run(finish),{statusCode:409});assert.equal(calls,2)
  assert.equal((await handle({sql,mode:'status',user})).presenceEnabled,true)
  await handle({sql,mode:'request',user});const second=await run({action:'poll'})
  await run({action:'finish',jobId:second.job.id,status:'error',code:'DOWNLOAD_TIMEOUT'})
  const [row]=await sql`select state from pignus_customer_sync`
  assert.equal(row.state.lastReport,undefined)
 } finally {await pg.close()}
})
