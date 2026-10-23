const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

const actor = { id: 'support', name: 'Soporte', roleCode: 'administrator' }
const command = (action, values = {}) => ({ action, commandId: crypto.randomUUID(), ...values })
const state = () => ({ roles: [{ id: 'admin', code: 'administrator' }], employees: [{ ...actor, roleId: 'admin', status: 'Activo' }], customers: [], history: [] })
const newCase = (store, current) => store.run(actor, current, command('create', { title: 'Impresora sin conexión', description: 'No se puede imprimir.', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal' })).then(result => result.ticket)
async function fixture(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON')
    return { store: createTicketStore({ db }), close: () => db.close() }
  }
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  return { store: createTicketStore({ sql: pgliteAdapter(pg) }), close: () => pg.close() }
}

for (const engine of ['sqlite', 'postgres']) test(`Resolución ${engine}: atención remota sin visita y medio verificable`, async t => {
  const { store, close } = await fixture(engine), current = state()
  try {
    await t.test('llamada, chat y correo cierran sin servicios y conservan autor, resultado e historial', async () => {
      for (const [method, label] of [['phone', 'Llamada'], ['chat', 'Chat'], ['email', 'Correo']]) {
        const ticket = await newCase(store, current)
        const input = command('resolve', { id: ticket.id, version: ticket.version, note: 'Se restableció la conexión y el solicitante verificó la impresión.', resolutionMethod: method })
        const resolved = (await store.run(actor, current, input)).ticket
        assert.equal(resolved.status, 'Resuelto')
        assert.equal(resolved.resolutionMethod, method)
        assert.equal(resolved.resolvedById, actor.id)
        assert.equal(resolved.assigneeId, actor.id)
        assert.deepEqual(resolved.serviceIds, [])
        assert.equal(current.history.length, 0)
        const event = resolved.events.find(item => item.action === 'Resolvió el ticket')
        assert.equal(event.resolutionMethod, method)
        assert.equal(event.byId, actor.id)
        assert.ok(event.body.includes(`Medio: ${label}`))
        assert.ok(event.body.includes(input.note))
        const retry = (await store.run(actor, current, input)).ticket
        assert.equal(retry.version, resolved.version)
        assert.equal(retry.events.length, resolved.events.length)
        const reopened = (await store.run(actor, current, command('reopen', { id: resolved.id, version: resolved.version, note: 'La falla volvió a presentarse.' }))).ticket
        assert.equal(reopened.status, 'En gestión')
        assert.equal(reopened.resolutionMethod, undefined)
        assert.ok(reopened.events.some(item => item.resolutionMethod === method))
      }
    })
    await t.test('rechaza medios inválidos sin cerrar ni asignar el caso; las API anteriores no inventan un medio', async () => {
      const ticket = await newCase(store, current)
      for (const method of ['', null, 'invalid', '__proto__', { phone: true }]) {
        await assert.rejects(store.run(actor, current, command('resolve', { id: ticket.id, version: ticket.version, note: 'Solución verificada.', resolutionMethod: method })), error => error.statusCode === 400)
      }
      const unchanged = (await store.query(actor, current, { mode: 'detail', id: ticket.id })).ticket
      assert.equal(unchanged.status, 'Nuevo')
      assert.equal(unchanged.version, ticket.version)
      assert.equal(unchanged.assigneeId, '')
      const legacy = (await store.run(actor, current, command('resolve', { id: ticket.id, version: ticket.version, note: 'Solución verificada.' }))).ticket
      assert.equal(legacy.status, 'Resuelto')
      assert.equal(legacy.resolutionMethod, '')
      assert.ok(!legacy.events.find(item => item.action === 'Resolvió el ticket').body.includes('Medio:'))
    })
    await t.test('resolver a distancia no cancela ni modifica una visita ya coordinada', async () => {
      let ticket = await newCase(store, current)
      const record = { id: 'scheduled-visit', service: 'Service de cámaras', date: '2026-10-30', time: '10:00', status: 'Pendiente', technicianIds: [actor.id], sourceTicketId: ticket.id, ticketNumber: ticket.number }
      const scheduled = { ...current, history: [record] }, snapshot = structuredClone(scheduled)
      await store.syncServices(current, scheduled, { user: actor, now: '2026-10-23T15:00:00.000Z' })
      ticket = (await store.query(actor, scheduled, { mode: 'detail', id: ticket.id })).ticket
      const resolved = (await store.run(actor, scheduled, command('resolve', { id: ticket.id, version: ticket.version, note: 'Se restableció el acceso durante la llamada.', resolutionMethod: 'phone' }))).ticket
      assert.equal(resolved.status, 'Resuelto')
      assert.equal(resolved.resolutionMethod, 'phone')
      assert.deepEqual(scheduled, snapshot)
      assert.equal(resolved.serviceSchedule[0].status, 'Pendiente')
      assert.ok(!resolved.events.some(item => item.action === 'automatic-canceled'))
    })
    await t.test('una nueva respuesta por correo reabre y retira el medio anterior sin borrar su historia', async () => {
      const mail = { messageId: `<resolution-${engine}@example.test>`, sender: { email: 'customer@example.test', name: 'Cliente' }, subject: 'Sin imagen', text: 'No veo las cámaras.', references: [], headerTicketNumbers: [], mode: 'live', mailboxKey: 'support-live' }
      const received = await store.ingestMail(mail)
      let ticket = (await store.query(actor, current, { mode: 'detail', id: received.ticketId })).ticket
      ticket = (await store.run(actor, current, command('resolve', { id: ticket.id, version: ticket.version, note: 'El cliente verificó el acceso por chat.', resolutionMethod: 'chat' }))).ticket
      assert.equal(ticket.sla.firstResponseAt, ticket.resolvedAt)
      const reply = await store.ingestMail({ ...mail, messageId: `<resolution-reply-${engine}@example.test>`, references: [mail.messageId], headerTicketNumbers: [ticket.number], text: 'Volvió a fallar.' })
      assert.equal(reply.ticketId, ticket.id)
      ticket = (await store.query(actor, current, { mode: 'detail', id: ticket.id })).ticket
      assert.equal(ticket.status, 'En gestión')
      assert.equal(ticket.resolutionMethod, undefined)
      assert.ok(ticket.events.some(item => item.resolutionMethod === 'chat'))
    })
  } finally { await close() }
})
