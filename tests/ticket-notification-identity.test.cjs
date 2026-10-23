const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { notificationTitle } = require('../api/_lib/ticket-communications.cjs')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

test('notificaciones identifican cuenta, solicitante y remitente sin exponer contactos', () => {
  const ticket = { number: '1000001', customerId: 'c1', customerSnapshot: { account: 'PIG-7059', name: 'PIG-7059 ALEJANDRO VIOLA' }, requesterName: 'Mariano', createdByName: 'Soporte' }
  assert.equal(notificationTitle(ticket, 'Nuevo'), 'PIG-7059 · ALEJANDRO VIOLA · Ticket#1000001 · Nuevo')
  assert.equal(notificationTitle(ticket, 'Caso resuelto', { customers: [{ customerId: 'c1', account: 'CLI-0173', name: 'Nombre vigente' }] }), 'CLI-0173 · Nombre vigente · Ticket#1000001 · Caso resuelto')
  const unlinked = { number: '1000002', requesterName: 'Mariano', createdByName: 'Operador' }
  assert.equal(notificationTitle(unlinked, 'Nuevo'), 'Solicitante: Mariano · Ticket#1000002 · Nuevo')
  assert.match(notificationTitle({ ...unlinked, requesterName: '' }, 'Nuevo'), /^Creado por: Operador/)
  assert.match(notificationTitle({ ...unlinked, origin: 'email', requesterName: 'Formularios de Google' }, 'Nuevo'), /^Remitente: Formularios de Google/)
  assert.equal(notificationTitle({ number: '1', origin: 'email', requesterName: 'cliente@example.test', createdByName: 'cliente@example.test' }, 'Nuevo'), 'Solicitud por correo · Ticket#1 · Nuevo')
  assert.equal(notificationTitle({ number: '2' }, 'Nuevo'), 'Solicitud sin cuenta · Ticket#2 · Nuevo')
  const long = notificationTitle({ number: '3', requesterName: 'A'.repeat(300) + '\n' }, 'Nuevo')
  assert.ok(long.includes('Ticket#3 · Nuevo'))
  assert.ok(long.length < 130)
})

for (const engine of ['sqlite', 'postgres']) test(`Identidad de avisos ${engine}: pendientes y avisos anteriores se actualizan sin marcar lectura`, async () => {
  let db, pg, sql
  if (engine === 'sqlite') db = new DatabaseSync(':memory:')
  else { const { PGlite } = await import('@electric-sql/pglite'); pg = await PGlite.create(); sql = pgliteAdapter(pg) }
  const store = createTicketStore({ db, sql })
  const q = async (query, args = []) => {
    if (pg) { let i = 0; return (await pg.query(query.replace(/\?/g, () => `$${++i}`), args)).rows }
    return db.prepare(query).all(...args)
  }
  const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
  const state = { employees: [], roles: [], history: [], customers: [{ customerId: 'c1', account: 'PIG-7059', name: 'ALEJANDRO VIOLA' }] }
  const command = (action, values) => ({ action, commandId: crypto.randomUUID(), ...values })
  try {
    let ticket = (await store.run(admin, state, command('create', { categoryId: 'internal', subcategoryId: 'printing', title: 'Revisar equipo', description: 'Sin conexión', origin: 'internal' }))).ticket
    let notices = (await store.query(admin, state, { mode: 'notifications' })).notifications
    assert.match(notices.find(n => n.target.ticketId === ticket.id).title, /^Solicitante: Administración/)
    ticket = (await store.run(admin, state, command('linkCustomer', { id: ticket.id, version: ticket.version, customerId: 'c1', note: 'Cuenta identificada durante la gestión.' }))).ticket
    notices = (await store.query(admin, state, { mode: 'notifications' })).notifications
    assert.match(notices.find(n => n.target.ticketId === ticket.id).title, /^PIG-7059 · ALEJANDRO VIOLA/)
    const old = { id: 'legacy-notice', notificationId: 'legacy-notice', title: `Ticket#${ticket.number} · Visita reprogramada`, detail: 'Detalle original', tone: 'info', target: { type: 'ticket', ticketId: ticket.id, notificationId: 'legacy-notice' } }
    await q('INSERT INTO pignus_ticket_notifications (id,ticket_id,recipient_id,created_at,read_at,data) VALUES (?,?,?,?,NULL,?) RETURNING id', [old.id, ticket.id, admin.id, new Date().toISOString(), JSON.stringify(old)])
    state.customers[0] = { customerId: 'c1', account: 'CLI-0123', name: 'Nombre actualizado' }
    notices = (await store.query(admin, state, { mode: 'notifications' })).notifications
    const enriched = notices.find(n => n.id === old.id)
    assert.equal(enriched.title, `CLI-0123 · Nombre actualizado · Ticket#${ticket.number} · Visita reprogramada`)
    assert.equal(enriched.detail, old.detail)
    assert.deepEqual(enriched.target, old.target)
    const saved = (await q('SELECT read_at,data FROM pignus_ticket_notifications WHERE id=?', [old.id]))[0]
    assert.equal(saved.read_at, null)
    assert.equal(JSON.parse(saved.data).title, old.title)
    const denied = { id: 'other', roleCode: 'custom', permissions: { __catalogV2: true, 'tickets.view': true, 'notifications.tickets': true } }
    assert.equal((await store.query(denied, state, { mode: 'notifications' })).notifications.length, 0)
  } finally { if (pg) await pg.close(); else db.close() }
})
