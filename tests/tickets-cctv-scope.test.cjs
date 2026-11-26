const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')
for (const engine of ['sqlite', 'postgres']) test(engine + ': CCTV supervisor reads marked accounts regardless of assignee', async () => {
 let db, pg, store, query
 if (engine === 'sqlite') {
  db = new DatabaseSync(':memory:'); store = createTicketStore({ db })
  query = async (sql, args) => db.prepare(sql).run(...args)
 } else {
  const { PGlite } = await import('@electric-sql/pglite'); pg = await PGlite.create()
  store = createTicketStore({ sql: pgliteAdapter(pg) }); query = (sql,args) => pg.query(sqlParameters(sql),args)
 }
 try {
  await store.ensure()
  const state = { history: [], employees: [], customers: [{ customerId: 'cctv', cctvService: true }, { customerId: 'regular', cctvService: false }] }
  for (const [id, customerId, status, assigneeId] of [['assigned','cctv','Nuevo','other'], ['unassigned','cctv','Nuevo',''], ['closed','cctv','Resuelto','other'], ['outside','regular','Nuevo','other']]) {
   const item = { id, number: String(100000 + ['assigned','unassigned','closed','outside'].indexOf(id)), customerId, status, assigneeId, createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z', title: id, scope: 'customer', serviceIds: [], createdById: 'other' }
   await query('INSERT INTO pignus_tickets (id,number,customer_id,status,assignee_id,created_by_id,updated_at,search_text,data) VALUES (?,?,?,?,?,?,?,?,?)', [id,item.number,customerId,status,assigneeId,'other',item.updatedAt,id,JSON.stringify(item)])
  }
  const legacy = { id: 'supervisor', roleCode: 'supervisor' }
  const policy = require('../api/_lib/permission-catalog.cjs')
  for (const user of [legacy, {...legacy, permissions: policy.toGranularPermissions(legacy)}]) {
   const result = await store.query(user,state,{ status: 'pending', pageSize: 1 })
   assert.equal(result.total,2)
   assert.equal((await store.query(user,state,{status:'Resuelto'})).items[0].id,'closed')
   const accountTickets = await store.query(user, state, { mode: 'list', customerId: 'cctv' })
   assert.deepEqual(accountTickets.items.map(ticket => ticket.id), ['closed', 'unassigned', 'assigned'])
   assert.equal((await store.query(user, state, { mode: 'list', customerId: 'regular' })).total, 0)
   for (const id of ['assigned','unassigned','closed']) assert.equal((await store.query(user,state,{mode:'detail',id})).ticket.id,id)
   await assert.rejects(store.query(user,state,{mode:'detail',id:'outside'}), {statusCode:404})
   state.customers[0].cctvService=false
   assert.equal((await store.query(user,state,{})).total,0)
   await assert.rejects(store.query(user,state,{mode:'detail',id:'assigned'}), {statusCode:404})
   state.customers[0].cctvService=true
  }
  assert.equal((await store.query({id:'operator',roleCode:'operator'},state,{})).total,0)
  const newlyViewed = { customerId: 'another-cctv', cctvService: true, account: 'CLI-2', name: 'Cuenta Sur' }
  state.customers.push(newlyViewed)
  const command = {
   action: 'create', commandId: require('node:crypto').randomUUID(), automaticTitle: true, scope: 'customer',
   origin: 'phone', categoryId: 'cameras', description: 'Una cámara del ingreso dejó de funcionar.', customerId: newlyViewed.customerId
  }
  const { ticket } = await store.run(legacy, state, command)
  assert.equal(ticket.customerId, newlyViewed.customerId)
  assert.equal(ticket.customerSnapshot.name, newlyViewed.name)
  const listFor = customerId => store.query(legacy, state, { mode: 'list', customerId })
  assert.deepEqual((await listFor(newlyViewed.customerId)).items.map(row => row.id), [ticket.id])
  assert.ok((await listFor('cctv')).items.every(row => row.id !== ticket.id))
 } finally { if (db) db.close(); if (pg) await pg.close() }
})
