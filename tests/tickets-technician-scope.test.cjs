const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const permissions = require('../api/_lib/permission-catalog.cjs')
const domain = require('../api/_lib/tickets.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')
const admin = { id: 'admin', roleCode: 'administrator', name: 'Administración' }
const tech = id => ({ id, name: id, roleCode: 'technician', roleId: 'tech-role', permissions: { __catalogV2: true, ...permissions.resolvePermissions({ roleCode: 'technician' }), 'tickets.scope.all': true, 'tickets.scope.area': true } })
const command = (action, fields) => ({ action, commandId: randomUUID(), ...fields })
const legacyService = (id, author) => ({ id, customerId: 'customer', client: 'PIG-1 Cuenta compartida', technicianIds: ['mariano', 'santos'], status: 'Completado', followup: { id: `followup:${id}`, type: 'Otra acción', description: `Solicitud privada de ${author}`, createdById: author, createdByName: author, createdAt: '2026-10-22T16:00:00.000Z', status: 'Pendiente', events: [] } })
async function fixture(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:')
    return { store: createTicketStore({ db }), restart: () => createTicketStore({ db }), close: () => db.close(), query: async (sql, values = []) => db.prepare(sql).all(...values) }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  return { store: createTicketStore({ sql: pgliteAdapter(pg) }), restart: () => createTicketStore({ sql: pgliteAdapter(pg) }), close: () => pg.close(), query: async (sql, values = []) => (await pg.query(sqlParameters(sql), values)).rows }
}
const denied = operation => assert.rejects(operation, error => error.statusCode === 404)

for (const engine of ['sqlite', 'postgres']) test(`Tickets ${engine}: el técnico no hereda solicitudes de un compañero`, async t => {
  const env = await fixture(engine), { store } = env
  const mariano = tech('mariano'), santos = tech('santos')
  const state = {
    roles: [{ id: 'tech-role', code: 'technician', permissions: santos.permissions }],
    employees: [mariano, santos].map(user => ({ ...user, status: 'Activo' })),
    customers: [{ customerId: 'customer', account: 'PIG-1', name: 'Cuenta compartida' }],
    history: [legacyService('visit-mariano', 'mariano'), legacyService('visit-santos', 'santos')]
  }
  try {
    await store.syncLegacy(state)
    const all = (await store.query(admin, state)).items
    let mine = all.find(ticket => ticket.createdById === mariano.id)
    const other = all.find(ticket => ticket.createdById === santos.id)
    assert.equal(all.length, 2)
    await t.test('listado y contadores son personales; al cargar se advierte de ambos casos abiertos', async () => {
      const metadata = await store.query(admin, state, { mode: 'metadata' })
      metadata.config.areas.find(area => area.id === 'technical').memberIds = [mariano.id, santos.id]
      await store.run(admin, state, command('configure', { config: metadata.config, version: metadata.configVersion }))
      for (const user of [mariano, santos]) {
        const list = await store.query(user, state)
        assert.equal(list.total, 1)
        assert.equal(list.items[0].createdById, user.id)
        assert.equal(list.counts.Nuevo, 1)
        assert.equal((await store.query(user, state, { mode: 'duplicates', customerId: 'customer' })).candidates.length, 2)
      }
      assert.equal((await store.query(santos, state, { search: mine.number })).total, 0)
      assert.equal((await store.query(santos, state, { serviceId: 'visit-mariano' })).total, 0)
      assert.equal((await store.query(santos, state, { assigneeId: 'me' })).total, 0)
    })
    await t.test('detalle, aportes y adjuntos ajenos se rechazan por ID o número', async () => {
      const file = { name: 'nota.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4\nDetalle privado').toString('base64') }
      mine = (await store.run(admin, state, command('comment', { id: mine.id, version: mine.version, note: 'Dato de la solicitud', attachments: [file] }))).ticket
      const attachmentId = mine.messages.find(entry => entry.attachments?.length).attachments[0].id
      for (const id of [mine.id, mine.number, `Ticket#${mine.number}`]) await denied(() => store.query(santos, state, { mode: 'detail', id }))
      await denied(() => store.run(santos, state, command('comment', { id: mine.id, version: mine.version, note: 'Intento ajeno' })))
      await denied(() => store.attachment(santos, state, { id: mine.id, attachmentId }))
      assert.equal((await store.attachment(mariano, state, { id: mine.id, attachmentId })).data.toString('base64'), file.data)
    })
    await t.test('los avisos antiguos y los generados desde el listado respetan la misma privacidad', async () => {
      const notice = { id: 'old-notice', title: 'Solicitud ajena', detail: 'Dato privado', target: { type: 'ticket', ticketId: mine.id } }
      await env.query('INSERT INTO pignus_ticket_notifications (id,ticket_id,recipient_id,created_at,data) VALUES (?,?,?,?,?)', [notice.id, mine.id, santos.id, new Date().toISOString(), JSON.stringify(notice)])
      const notices = (await store.query(santos, state, { mode: 'notifications' })).notifications
      assert.ok(notices.length)
      assert.ok(notices.every(notice => notice.target.ticketId === other.id))
    })
    await t.test('una asignación explícita permite trabajar el caso; quitarla revoca acceso aunque haya comentado', async () => {
      mine = (await store.run(admin, state, command('assign', { id: mine.id, version: mine.version, assigneeId: santos.id }))).ticket
      assert.equal((await store.query(santos, state, { mode: 'detail', id: mine.id })).ticket.id, mine.id)
      mine = (await store.run(santos, state, command('comment', { id: mine.id, version: mine.version, note: 'Gestión autorizada' }))).ticket
      mine = (await store.run(admin, state, command('assign', { id: mine.id, version: mine.version, assigneeId: '' }))).ticket
      assert.ok(mine.participantIds.includes(santos.id))
      await denied(() => store.query(santos, state, { mode: 'detail', id: mine.id }))
      assert.equal((await store.query(santos, state)).total, 1)
    })
    await t.test('una visita agendada desde un reclamo sí corresponde al técnico asignado', async () => {
      const scheduled = { id: 'scheduled', technicianIds: [santos.id], status: 'Pendiente', sourceTicketId: mine.id }
      const withVisit = { ...state, history: [...state.history, scheduled] }
      assert.equal((await store.query(santos, withVisit)).total, 2)
      assert.equal((await store.query(santos, withVisit, { mode: 'detail', id: mine.id })).ticket.id, mine.id)
      assert.equal(domain.visible(mine, santos, { ...withVisit, history: [...state.history, { ...scheduled, technicianIds: [mariano.id] }] }, domain.defaultConfig()), false)
      await denied(() => store.query(santos, state, { mode: 'detail', id: mine.id }))
    })
    await t.test('fusionar conserva a los solicitantes originales, no a antiguos comentaristas', async () => {
      const duplicates = await store.query(admin, state, { mode: 'duplicates', customerId: 'customer' })
      const target = (await store.run(admin, state, command('create', { origin: 'internal', title: 'Caso principal', description: 'Mismo asunto', categoryId: 'internal', subcategoryId: 'other', customerId: 'customer', allowDuplicate: true, duplicateToken: duplicates.duplicateToken }))).ticket
      const merged = (await store.run(admin, state, command('merge', { id: mine.id, version: mine.version, targetId: target.id, targetVersion: target.version, note: 'Es el mismo caso' }))).ticket
      assert.equal((await store.query(mariano, state, { mode: 'detail', id: mine.number })).ticket.id, merged.id)
      assert.ok((await store.query(mariano, state)).items.some(ticket => ticket.id === merged.id))
      assert.ok((await store.query(mariano, state, { scope: 'mine' })).items.some(ticket => ticket.id === merged.id))
      await denied(() => store.query(santos, state, { mode: 'detail', id: mine.id }))
      await denied(() => store.query(santos, state, { mode: 'detail', id: target.id }))
      const withVisit = { ...state, history: [...state.history, { id: 'scheduled-alias', technicianIds: [santos.id], status: 'Pendiente', sourceTicketId: mine.id }] }
      assert.equal((await store.query(santos, withVisit, { mode: 'detail', id: mine.number })).ticket.id, merged.id)
      assert.ok((await store.query(santos, withVisit)).items.some(ticket => ticket.id === merged.id))
      assert.ok((await store.query(santos, withVisit, { mode: 'notifications' })).notifications.some(notice => notice.target.ticketId === merged.id))
      assert.equal((await store.query(santos, state)).total, 1)
      assert.equal((await store.query(admin, state)).total, 3)
      // Simula una fusión anterior al ajuste para verificar la migración real
      // al iniciar el almacén, además de las fusiones creadas desde ahora.
      const old = JSON.parse((await env.query('SELECT data FROM pignus_tickets WHERE id=?', [merged.id]))[0].data)
      delete old.mergedRequesterIds
      delete old.mergedTicketIds
      await env.query('UPDATE pignus_tickets SET data=? WHERE id=?', [JSON.stringify(old), old.id])
      await env.query('DELETE FROM pignus_ticket_settings WHERE id=?', ['ticket-requesters-v1'])
      const restarted = env.restart()
      const restored = (await restarted.query(mariano, state, { mode: 'detail', id: mine.id })).ticket
      assert.equal(restored.id, merged.id)
      assert.equal(restored.version, old.version)
      assert.equal(restored.updatedAt, old.updatedAt)
      assert.ok((await restarted.query(santos, withVisit)).items.some(ticket => ticket.id === merged.id))
      await denied(() => restarted.query(santos, state, { mode: 'detail', id: merged.id }))
    })
  } finally { await env.close() }
})
