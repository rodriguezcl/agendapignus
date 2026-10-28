const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const forms = require('../api/_lib/ticket-registration-form.cjs')
const user = { id:'admin', name:'Administración', roleCode:'administrator' }

for (const engine of ['sqlite', 'postgres']) test(`${engine}: vinculación directa de reserva, cierre del aviso y posterior PIG`, async () => {
  let db, pg, options, q
  if (engine === 'sqlite') {
    db = new DatabaseSync(':memory:'); options = {db}
    q = async (sql,args=[]) => /SELECT|RETURNING/.test(sql) ? db.prepare(sql).all(...args) : (db.prepare(sql).run(...args), [])
  } else {
    const {PGlite} = require('@electric-sql/pglite'); pg = new PGlite(); options = {sql:pgliteAdapter(pg)}
    q = async (sql,args=[]) => { let n=0; return (await pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args)).rows }
  }
  try {
    const store = createTicketStore(options); await store.ensure()
    const visit = (id,index) => ({id,client:'Tomás Otero',customerId:'',subscriberReservation:true,date:`2026-11-0${index}`,time:'10:30',status:'Pendiente',service:'Instalación de alarma',sourceTaskId:'task-'+id,serviceJourney:{id:'journey',index,total:2}})
    const state = {customers:[{customerId:'pig',account:'PIG-7068',name:'Tomás Otero'}],history:[visit('s1',1),visit('s2',2)],agenda:{weekly:{'2026-11-01':{teams:[{tasks:[{historyId:'s1',taskId:'task-s1'},{historyId:'s2',taskId:'task-s2'}]}]}}}}
    await q('CREATE TABLE link_test_state (id TEXT PRIMARY KEY,data TEXT NOT NULL)')
    await q('INSERT INTO link_test_state VALUES (?,?)',['current',JSON.stringify(state)])
    const adapter = {load:async()=>JSON.parse((await q('SELECT data FROM link_test_state'))[0].data),save:async(_tx,_old,next)=>q('UPDATE link_test_state SET data=?',[JSON.stringify(next)])}
    const ingest = async name => {
      const imported = await store.ingestMail({subject:'Alta de Servicio - Pignus Seguridad',text:'1 respuesta nueva. Ver respuesta: tomas@example.com',sender:{email:'forms@google.com'},messageId:`<${name}@google.com>`,mode:'test',mailboxKey:'fixture',attachments:[]})
      return (await store.query(user,state,{mode:'detail',id:imported.ticketId})).ticket
    }
    const ticket = await ingest('first')
    const choices = await store.query(user,state,{mode:'formServices',search:'tomas'})
    assert.equal(choices.total,1,'agrupa las jornadas y encuentra nombres sin exigir email ni PIG')
    assert.equal(choices.items[0].reservation,true)
    assert.equal(choices.items[0].customerId,'')
    const payload = {action:'formReceipt',id:ticket.id,version:ticket.version,commandId:crypto.randomUUID(),formEmail:'tomas@example.com',serviceId:'s1',serviceSnapshot:choices.items[0].snapshot}
    const restricted = {...user,roleCode:'custom',permissions:{...require('../api/_lib/permission-catalog.cjs').resolvePermissions(user),__catalogV2:true,'scope.services.write.assigned':true}}
    const partiallyAssigned = structuredClone(state); partiallyAssigned.history[0].technicianIds=[user.id]
    assert.equal((await store.query(restricted,partiallyAssigned,{mode:'formServices',search:'tomas'})).total,0,'no ofrece jornadas que no puede modificar')
    await assert.rejects(store.run(restricted,partiallyAssigned,payload,{...adapter,load:async()=>partiallyAssigned}),e=>e.statusCode===403)
    const notificationsBefore = await store.query(user,state,{mode:'notifications'})
    assert.ok(notificationsBefore.notifications.some(n=>n.target.ticketId===ticket.id))
    await q('INSERT INTO pignus_ticket_notifications VALUES (?,?,?,?,NULL,?)',['test-notice',ticket.id,user.id,new Date().toISOString(),JSON.stringify({id:'test-notice',target:{type:'ticket',ticketId:ticket.id},title:'Aviso'})])
    // Changes on another visit invalidate the entire selection.
    const changed = structuredClone(state); changed.history[1].formEmail='otro@example.com'
    await assert.rejects(store.run(user,state,payload,{...adapter,load:async()=>changed}),/otro correo/)
    await assert.rejects(store.run(user,state,{...payload,replaceForm:true},{...adapter,load:async()=>changed}),/cambió/)
    const canceled = structuredClone(state); canceled.history[0].status='Cancelado'
    await assert.rejects(store.run(user,state,payload,{...adapter,load:async()=>canceled}),e=>e.statusCode===403)
    const wrongType = structuredClone(state); wrongType.history[0].service='Service de cámaras'
    await assert.rejects(store.run(user,state,payload,{...adapter,load:async()=>wrongType}),e=>e.statusCode===403)
    // A failed persistence rolls the ticket and notifications back as well.
    await assert.rejects(store.run(user,state,payload,{...adapter,save:async(...args)=>{await adapter.save(...args);throw Error('fixture failure')}}),/fixture failure/)
    assert.deepEqual(await adapter.load(),state)
    assert.equal((await q('SELECT read_at FROM pignus_ticket_notifications WHERE id=?',['test-notice']))[0].read_at,null)
    const result = await store.run(user,state,payload,adapter)
    assert.equal(result.ticket.status,'Resuelto')
    assert.equal(result.ticket.registrationForm.confirmedByName,user.name)
    assert.equal(result.ticket.customerId,'')
    const saved = await adapter.load()
    for (const record of saved.history) {assert.equal(record.form,'Completo');assert.equal(record.formEmail,'tomas@example.com');assert.equal(record.status,'Pendiente')}
    for (const task of saved.agenda.weekly['2026-11-01'].teams[0].tasks) assert.equal(task.formEmail,'tomas@example.com')
    assert.ok((await q('SELECT read_at FROM pignus_ticket_notifications WHERE id=?',['test-notice']))[0].read_at)
    assert.equal((await store.query(user,saved,{mode:'notifications'})).notifications.some(n=>n.target.ticketId===ticket.id),false)
    const stored = JSON.parse((await q('SELECT data FROM pignus_tickets WHERE id=?',[ticket.id]))[0].data)
    assert.ok(stored.sla.firstResponseAt,'la acción humana queda registrada para SLA')
    assert.equal((await q('SELECT * FROM pignus_ticket_mail_outbox')).length,0)
    const entriesBefore = (await q('SELECT * FROM pignus_ticket_entries WHERE ticket_id=?',[ticket.id])).length
    await store.run(user,saved,payload,adapter)
    assert.equal((await q('SELECT * FROM pignus_ticket_entries WHERE ticket_id=?',[ticket.id])).length,entriesBefore,'reintentar no duplica gestiones')
    const detail = (await store.query(user,saved,{mode:'detail',id:ticket.id})).ticket
    assert.ok(detail.messages.some(m=>m.body.includes('Ver respuesta: tomas@example.com')),'conserva correo original')
    // Existing matching form data can be reconciled without a replacement checkbox.
    const repeated = await ingest('second')
    await store.run(user,saved,{...payload,id:repeated.id,version:repeated.version,commandId:crypto.randomUUID(),serviceSnapshot:forms.serviceSnapshot(saved,saved.history[0])},adapter)
    const pigState = structuredClone(saved)
    pigState.history = pigState.history.map(r=>({...r,customerId:'pig',clientAccount:'PIG-7068',subscriberReservation:false}))
    await require('../api/_lib/service-completion-effects.cjs').syncServiceEffects(store,saved,pigState,{connection:db||options.sql,user},db?'db':'sql')
    const finalTicket = JSON.parse((await q('SELECT data FROM pignus_tickets WHERE id=?',[ticket.id]))[0].data)
    assert.equal(finalTicket.customerId,'pig');assert.equal(finalTicket.scope,'customer');assert.equal(finalTicket.status,'Resuelto')
    assert.equal((await q('SELECT * FROM pignus_installation_experience_mail')).length,1,'sólo el vínculo PIG genera una confirmación por instalación')
    assert.equal((await q('SELECT * FROM pignus_ticket_mail_outbox')).length,0)
  } finally {db?.close();await pg?.close()}
})
