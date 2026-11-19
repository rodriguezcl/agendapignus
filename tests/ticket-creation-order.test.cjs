const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')
for (const engine of ['sqlite', 'postgres']) test(engine + ': creation order precedes priority and activity across pages', async () => {
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
  for (const [id, number, createdAt, priority, updatedAt] of [
   ['old', '100001', '2026-11-17T10:00:00Z', 'Crítica', '2026-11-20T10:00:00Z'],
   ['new', '100002', '2026-11-19T10:00:00Z', 'Baja', '2026-11-19T10:00:00Z'],
   ['tie', '100003', '2026-11-19T10:00:00Z', 'Media', '2026-11-19T10:00:00Z']]) {
   const item = { id, number, createdAt, updatedAt, priority, status: 'Nuevo', scope: 'internal', title: id, serviceIds: [] }
   await query('INSERT INTO pignus_tickets (id,number,status,updated_at,search_text,data) VALUES (?,?,?,?,?,?)', [id,number,item.status,updatedAt,id,JSON.stringify(item)])
  }
  const user = { id: 'admin', roleCode: 'administrator' }, state = { history: [], employees: [], customers: [] }
  const first = await store.query(user,state,{ status: 'pending', page: 1, pageSize: 2 })
  const second = await store.query(user,state,{ status: 'pending', page: 2, pageSize: 2 })
  assert.deepEqual(first.items.map(t=>t.id), ['tie','new'])
  assert.deepEqual(second.items.map(t=>t.id), ['old'])
  assert.equal(first.total,3)
 } finally { if (db) db.close(); if (pg) await pg.close() }
})
