const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')

const admin = { id:'admin', name:'Administración', roleCode:'administrator' }
const stateFixture = () => ({
  roles:[{id:'admin-role',code:'administrator',permissions:{}}],
  employees:[{id:'admin',name:'Administración',roleId:'admin-role',status:'Activo'}],
  customers:[], history:[]
})
function record(id) {
  return {id,followup:{id:`followup:${id}`,type:'Cotizar adicional',description:'Cotizar sensores',status:'Pendiente',createdAt:'2026-10-26T12:00:00.000Z',createdById:'admin',createdByName:'Administración',events:[]}}
}
async function fixture(engine) {
  const statements=[]
  if(engine==='sqlite') {
    const db=new DatabaseSync(':memory:')
    const connection={exec:sql=>db.exec(sql),prepare:sql=>{statements.push(sql);return db.prepare(sql)}}
    return {store:createTicketStore({db:connection}),statements,close:()=>db.close(),
      q:async(sql,args=[])=>db.prepare(sql).all(...args),exec:sql=>db.exec(sql)}
  }
  const {PGlite}=await import('@electric-sql/pglite')
  const db=await PGlite.create()
  return {store:createTicketStore({sql:pgliteAdapter(db,statements)}),statements,close:()=>db.close(),
    q:async(sql,args=[])=>(await db.query(sqlParameters(sql),args)).rows,exec:sql=>db.exec(sql)}
}
for(const engine of ['sqlite','postgres']) test(`Tickets ${engine}: lecturas agrupadas sin escrituras repetidas ni permisos desactualizados`,async()=>{
  const env=await fixture(engine),state=stateFixture()
  try {
    state.history=[record('first'),record('second')]
    await env.store.syncLegacy(state)
    const items=(await env.store.query(admin,state,{})).items
    assert.equal(items.length,2)
    await env.exec('CREATE TABLE recipient_updates (value INTEGER)')
    if(engine==='sqlite')await env.exec("CREATE TRIGGER count_recipient_updates AFTER UPDATE ON pignus_ticket_settings WHEN NEW.id='escalation-recipients' BEGIN INSERT INTO recipient_updates VALUES (1); END")
    else await env.exec("CREATE FUNCTION count_recipient_updates() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='escalation-recipients' THEN INSERT INTO recipient_updates VALUES (1); END IF; RETURN NEW; END $$; CREATE TRIGGER count_recipient_updates AFTER UPDATE ON pignus_ticket_settings FOR EACH ROW EXECUTE FUNCTION count_recipient_updates()")
    await env.store.query(admin,state,{})
    await env.store.query(admin,state,{})
    assert.equal((await env.q('SELECT * FROM recipient_updates')).length,0)
    state.employees[0].status='Inactivo'
    await env.store.query(admin,state,{})
    assert.equal((await env.q('SELECT * FROM recipient_updates')).length,1)
    assert.deepEqual(JSON.parse((await env.q("SELECT data FROM pignus_ticket_settings WHERE id='escalation-recipients'"))[0].data).recipientIds,[])
    state.employees[0].status='Activo'
    await env.store.query(admin,state,{})
    assert.equal((await env.q('SELECT * FROM recipient_updates')).length,2)
    assert.deepEqual(JSON.parse((await env.q("SELECT data FROM pignus_ticket_settings WHERE id='escalation-recipients'"))[0].data).recipientIds,['admin'])

    await env.exec('DELETE FROM pignus_ticket_notifications')
    for(let i=0;i<50;i++) {
      const item=items[i%2],notice={id:`notice-${i}`,title:'Nuevo',eventLabel:'Nuevo',target:{type:'ticket',ticketId:item.id}}
      await env.q('INSERT INTO pignus_ticket_notifications (id,ticket_id,recipient_id,created_at,data) VALUES (?,?,?,?,?)',[notice.id,item.id,'reader','2026-11-03T12:00:00.000Z',JSON.stringify(notice)])
    }
    const reader={id:'reader',roleCode:'custom',permissions:{__catalogV2:true,'tickets.view':true,'tickets.scope.all':true,'notifications.tickets':true}}
    env.statements.length=0
    const notices=(await env.store.query(reader,state,{mode:'notifications'})).notifications
    assert.equal(notices.length,50)
    assert.equal(env.statements.filter(sql=>sql.startsWith('SELECT data FROM pignus_tickets WHERE id IN')).length,1)
    assert.equal(env.statements.filter(sql=>sql.startsWith('SELECT data FROM pignus_tickets WHERE id=')).length,0)
    reader.permissions['tickets.scope.all']=false
    assert.deepEqual((await env.store.query(reader,state,{mode:'notifications'})).notifications,[])

    state.history.push(record('third'))
    env.statements.length=0
    await env.store.syncLegacy(state)
    assert.equal(env.statements.filter(sql=>sql.startsWith('SELECT id FROM pignus_tickets WHERE legacy_id=')).length,1)
    assert.equal((await env.q('SELECT id FROM pignus_tickets')).length,3)
    env.statements.length=0
    await env.store.syncLegacy(state)
    assert.equal(env.statements.length,1)
    assert.equal((await env.q('SELECT id FROM pignus_tickets')).length,3)
  } finally {await env.close()}
})
