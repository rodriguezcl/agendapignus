const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { createFollowup } = require('../api/_lib/followups.cjs')
const permissions = require('../api/_lib/permission-catalog.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { sqlParameters } = require('../api/_lib/ticket-mail-store.cjs')

const admin = { id: 'admin', name: 'Soporte', roleCode: 'administrator' }
const technician = id => ({ id, name: id, roleCode: 'technician', roleId: 'technical-role', permissions: {
  __catalogV2: true, ...permissions.resolvePermissions({ roleCode: 'technician' }),
  'tickets.create': false, 'tickets.comment': true, 'tickets.resolve': true, 'tickets.internal': false, 'records.contact': false
} })
const mariano = technician('mariano'), santos = technician('santos')
const operator = { id: 'operator', name: 'Operador', roleCode: 'custom', permissions: {
  __catalogV2: true, 'tickets.view': true, 'tickets.create': true, 'tickets.comment': true
} }
const command = (action, input = {}) => ({ action, commandId: randomUUID(), ...input })
const file = { name: 'comprobante.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4\nDocumento de prueba').toString('base64') }
const reject = (operation, status) => assert.rejects(operation, error => error.statusCode === status)

async function fixture(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON')
    return { store: createTicketStore({ db }), close: () => db.close(), query: async (sql, args = []) => db.prepare(sql).all(...args) }
  }
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  return { store: createTicketStore({ sql: pgliteAdapter(pg) }), close: () => pg.close(), query: async (sql, args = []) => (await pg.query(sqlParameters(sql), args)).rows }
}

function context(key) {
  const customers = ['customer', 'other'].map(customerId => ({ customerId: `${key}-${customerId}`, account: `PIG-${key}-${customerId}`, name: `Cuenta ${customerId}`, address: 'Domicilio privado', phone: '3511234567', email: 'cliente@example.test' }))
  const history = customers.flatMap(customer => [mariano, santos].map(user => ({ id: `${customer.customerId}-${user.id}`, customerId: customer.customerId,
    client: `${customer.account} ${customer.name}`, clientAccount: customer.account, technicianIds: [user.id], status: 'Pendiente', date: '2026-10-23', time: '08:30', service: 'Servicio de alarma' })))
  const state = { customers, history, roles: [{ id: 'technical-role', code: 'technician', name: 'Técnico', permissions: santos.permissions }], employees: [admin, mariano, santos].map(user => ({ ...user, status: 'Activo' })) }
  const customerId = customers[0].customerId, serviceId = `${customerId}-${santos.id}`, authorServiceId = `${customerId}-${mariano.id}`
  const create = (fields = {}) => command('create', { title: 'Revisar activaciones', description: 'Se activa la zona de ingreso sin motivo.', customerId,
    origin: 'technical', serviceId: authorServiceId, categoryId: 'alarm', subcategoryId: 'repeated', eventType: 'Intrusión', zone: 'Zona 1 - Puerta', ...fields })
  return { state, customerId, serviceId, authorServiceId, create }
}

for (const engine of ['sqlite', 'postgres']) test(`Tickets ${engine}: excepción para evitar solicitudes duplicadas sin abrir la bandeja ajena`, async t => {
  const env = await fixture(engine), { store } = env
  try {
    await t.test('la búsqueda y vista previa muestran casos abiertos de la cuenta sin notas internas ni adjuntos', async () => {
      const c = context('preview')
      let ticket = (await store.run(mariano, c.state, c.create({ attachments: [file], requesterEmail: 'mariano@example.test' }))).ticket
      ticket = (await store.run(admin, c.state, command('comment', { id: ticket.id, version: ticket.version, note: 'Diagnóstico reservado de soporte', visibility: 'internal', attachments: [file] }))).ticket
      const publicAttachment = ticket.messages.find(message => message.visibility === 'public' && message.attachments?.length).attachments[0]
      const list = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: c.serviceId })
      assert.deepEqual(list.candidates.map(candidate => candidate.id), [ticket.id])
      const preview = (await store.query(santos, c.state, { mode: 'duplicateDetail', id: ticket.id, customerId: c.customerId, serviceId: c.serviceId })).ticket
      assert.equal(preview.description, ticket.description)
      assert.equal(preview.version, ticket.version)
      assert.equal(preview.zone, 'Zona 1 - Puerta')
      assert.ok(preview.messages.some(message => message.body === ticket.description))
      assert.ok(!JSON.stringify(preview).includes('Diagnóstico reservado'))
      for (const key of ['customerSnapshot', 'requesterEmail', 'participantIds', 'coRequesterIds', 'serviceIds', 'sla', 'events', 'externalParticipants']) assert.equal(preview[key], undefined, key)
      for (const message of preview.messages) for (const key of ['attachments', 'from', 'to', 'cc', 'messageId', 'sourceTicketId', 'context']) assert.equal(message[key], undefined, key)
      assert.ok(!JSON.stringify(list).includes('Diagnóstico reservado'))
      assert.equal((await store.query(santos, c.state, { customerId: c.customerId })).total, 0)
      await reject(() => store.query(santos, c.state, { mode: 'detail', id: ticket.id }), 404)
      await reject(() => store.run(santos, c.state, command('comment', { id: ticket.id, version: ticket.version, note: 'Comentario sin asociar solicitud' })), 404)
      await reject(() => store.run(santos, c.state, command('resolve', { id: ticket.id, version: ticket.version, note: 'Cierre no autorizado' })), 404)
      await reject(() => store.attachment(santos, c.state, { id: ticket.id, attachmentId: publicAttachment.id }), 404)
      assert.ok(!(await store.query(santos, c.state, { mode: 'notifications' })).notifications.some(notice => notice.target.ticketId === ticket.id))
    })

    await t.test('la excepción exige una cuenta autorizada y el servicio propio cuando sólo se permite informar desde servicios', async () => {
      const c = context('scope'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      await reject(() => store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId }), 403)
      await reject(() => store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: c.authorServiceId }), 403)
      await reject(() => store.query(santos, c.state, { mode: 'duplicates', customerId: `${c.customerId}-missing`, serviceId: c.serviceId }), 403)
      await reject(() => store.query(santos, c.state, { mode: 'duplicates', customerId: c.state.customers[1].customerId, serviceId: c.serviceId }), 403)
      await reject(() => store.query(santos, c.state, { mode: 'duplicateDetail', id: ticket.id, customerId: c.state.customers[1].customerId, serviceId: `${c.state.customers[1].customerId}-${santos.id}` }), 404)
      const viewOnly = { ...operator, permissions: { __catalogV2: true, 'tickets.view': true } }
      await reject(() => store.query(viewOnly, c.state, { mode: 'duplicates', customerId: c.customerId }), 403)
      const inaccessible = { ...c.state, history: c.state.history.filter(record => record.technicianIds.includes(mariano.id)) }
      await reject(() => store.query(santos, inaccessible, { mode: 'duplicates', customerId: c.customerId, serviceId: c.serviceId }), 403)
      assert.equal((await store.query(operator, c.state, { mode: 'duplicates', customerId: c.customerId })).candidates.length, 1)
    })

    await t.test('el aporte une solicitudes, preserva gestión y SLA, y habilita acceso como coautor de forma idempotente', async () => {
      const c = context('contribute')
      let ticket = (await store.run(mariano, c.state, c.create())).ticket
      ticket = (await store.run(admin, c.state, command('assign', { id: ticket.id, version: ticket.version, assigneeId: admin.id }))).ticket
      const before = structuredClone(ticket), input = command('contribute', { id: ticket.id, version: ticket.version, customerId: c.customerId, serviceId: c.serviceId,
        note: 'El abonado confirma que también ocurre de noche.', attachments: [file], context: { categoryId: 'alarm', subcategoryId: 'repeated', eventId: 'event-1', zone: 'Zona 2', occurredAt: '2026-10-23T01:00:00Z' } })
      const result = (await store.run(santos, c.state, input)).ticket
      assert.equal(result.id, ticket.id)
      assert.equal(result.number, ticket.number)
      assert.equal(result.version, before.version + 1)
      assert.equal(result.status, before.status)
      assert.equal(result.priority, before.priority)
      assert.equal(result.assigneeId, before.assigneeId)
      assert.deepEqual(result.sla, before.sla)
      assert.equal(result.sla.firstResponseAt, '')
      assert.ok(result.coRequesterIds.includes(santos.id))
      const entry = result.messages.find(message => message.body === input.note)
      assert.equal(entry.byId, santos.id)
      assert.equal(entry.sourceServiceId, c.serviceId)
      assert.equal(entry.visibility, 'public')
      assert.equal(entry.context.zone, 'Zona 2')
      assert.equal(entry.attachments.length, 1)
      assert.equal((await store.query(santos, c.state, { customerId: c.customerId })).items[0].id, ticket.id)
      assert.equal((await store.query(santos, c.state, { scope: 'mine', customerId: c.customerId })).total, 1)
      assert.equal((await store.query(santos, c.state, { mode: 'detail', id: ticket.id })).ticket.id, ticket.id)
      const retry = (await store.run(santos, c.state, input)).ticket
      assert.equal(retry.version, result.version)
      assert.equal(retry.messages.filter(message => message.body === input.note).length, 1)
      assert.equal((await store.query(admin, c.state, { customerId: c.customerId })).total, 1)
      const additional = (await store.run(santos, c.state, command('comment', { id: ticket.id, version: result.version, note: 'El abonado agrega otro dato del mismo caso.' }))).ticket
      assert.equal(additional.sla.firstResponseAt, '')
    })

    await t.test('rechaza aportes obsoletos, privados, sin servicio, con cuenta incorrecta o a casos cerrados sin conceder acceso', async () => {
      const c = context('invalid'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      const input = { id: ticket.id, version: ticket.version, customerId: c.customerId, serviceId: c.serviceId, note: 'Otro dato' }
      await reject(() => store.run(santos, c.state, command('contribute', { ...input, version: ticket.version + 1 })), 409)
      await reject(() => store.run(santos, c.state, command('contribute', { ...input, serviceId: undefined })), 403)
      await reject(() => store.run(santos, c.state, command('contribute', { ...input, visibility: 'internal' })), 403)
      await reject(() => store.run(santos, c.state, command('contribute', { ...input, customerId: c.state.customers[1].customerId, serviceId: `${c.state.customers[1].customerId}-${santos.id}` })), 404)
      assert.equal((await store.query(santos, c.state, { customerId: c.customerId })).total, 0)
      const closed = (await store.run(admin, c.state, command('resolve', { id: ticket.id, version: ticket.version, note: 'Incidente resuelto' }))).ticket
      await reject(() => store.run(santos, c.state, command('contribute', { ...input, version: closed.version })), 409)
      await reject(() => store.query(santos, c.state, { mode: 'duplicateDetail', ...input }), 409)
      assert.equal((await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: c.serviceId })).candidates.length, 0)
      assert.equal((await store.query(santos, c.state, { customerId: c.customerId })).total, 0)
    })

    await t.test('crear otro motivo exige confirmar coincidencias ajenas y vuelve a validar el token de dos sesiones', async () => {
      const c = context('tokens'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      const create = fields => c.create({ serviceId: c.serviceId, title: 'Segundo motivo independiente', ...fields })
      await reject(() => store.run(santos, c.state, create()), 409)
      await reject(() => store.run(santos, c.state, create({ allowDuplicate: true })), 409)
      const firstSession = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: c.serviceId })
      await store.run(mariano, c.state, command('comment', { id: ticket.id, version: ticket.version, note: 'Actualización posterior a la revisión' }))
      await reject(() => store.run(santos, c.state, create({ allowDuplicate: true, duplicateToken: firstSession.duplicateToken })), 409)
      const current = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: c.serviceId })
      const secondSessionToken = current.duplicateToken
      const created = (await store.run(santos, c.state, create({ allowDuplicate: true, duplicateToken: current.duplicateToken }))).ticket
      assert.notEqual(created.id, ticket.id)
      await reject(() => store.run(santos, c.state, create({ title: 'Carga simultánea de otra sesión', allowDuplicate: true, duplicateToken: secondSessionToken })), 409)
      assert.equal((await store.query(admin, c.state, { customerId: c.customerId })).total, 2)
      assert.equal((await store.query(santos, c.state, { customerId: c.customerId })).total, 1)
    })

    await t.test('el coautor conserva el caso al fusionarlo y recibe el aviso de cierre del principal', async () => {
      const c = context('merge'), original = (await store.run(mariano, c.state, c.create())).ticket
      const contributed = (await store.run(santos, c.state, command('contribute', { id: original.id, version: original.version, customerId: c.customerId, serviceId: c.serviceId, note: 'Mismo inconveniente reportado nuevamente' }))).ticket
      const found = await store.query(admin, c.state, { mode: 'duplicates', customerId: c.customerId })
      const target = (await store.run(admin, c.state, c.create({ origin: 'internal', serviceId: undefined, title: 'Caso principal', allowDuplicate: true, duplicateToken: found.duplicateToken }))).ticket
      const merged = (await store.run(admin, c.state, command('merge', { id: contributed.id, version: contributed.version, targetId: target.id, targetVersion: target.version, note: 'Mismo problema confirmado' }))).ticket
      assert.equal((await store.query(santos, c.state, { mode: 'detail', id: original.id })).ticket.id, merged.id)
      assert.ok((await store.query(santos, c.state, { scope: 'mine', customerId: c.customerId })).items.some(item => item.id === merged.id))
      await store.run(admin, c.state, command('resolve', { id: merged.id, version: merged.version, note: 'Se verificó el funcionamiento del sistema' }))
      const notices = (await store.query(santos, c.state, { mode: 'notifications' })).notifications
      assert.ok(notices.some(notice => notice.target.ticketId === merged.id && notice.title.includes('Caso resuelto')))
    })

    await t.test('una fusión posterior a la consulta exige revisar el principal antes de aportar desde la vista previa o el informe', async () => {
      const c = context('merge-review'), original = (await store.run(mariano, c.state, c.create())).ticket
      const preview = (await store.query(santos, c.state, { mode: 'duplicateDetail', id: original.id, customerId: c.customerId, serviceId: c.serviceId })).ticket
      assert.equal(preview.id, original.id)
      const record = c.state.history.find(item => item.id === c.serviceId)
      const followup = createFollowup(record, { type: 'Gestionar problema', description: 'Nuevo dato del caso que estaba abierto.', relatedTicketId: preview.id, relatedTicketVersion: preview.version, relation: 'same' }, santos, c.state, '2026-10-23T18:00:00Z')
      const found = await store.query(admin, c.state, { mode: 'duplicates', customerId: c.customerId })
      const target = (await store.run(admin, c.state, c.create({ serviceId: undefined, origin: 'internal', title: 'Caso principal revisado por soporte', allowDuplicate: true, duplicateToken: found.duplicateToken }))).ticket
      const merged = (await store.run(admin, c.state, command('merge', { id: original.id, version: original.version, targetId: target.id, targetVersion: target.version, note: 'Los casos corresponden al mismo motivo' }))).ticket

      await reject(() => store.query(santos, c.state, { mode: 'duplicateDetail', id: original.id, customerId: c.customerId, serviceId: c.serviceId }), 409)
      await reject(() => store.run(santos, c.state, command('contribute', { id: original.id, version: preview.version, customerId: c.customerId, serviceId: c.serviceId, note: 'Aporte a una referencia que cambió' })), 409)
      const next = { ...c.state, history: c.state.history.map(item => item.id === record.id ? { ...item, followup } : item) }
      await reject(() => store.syncLegacy(next), 409)
      assert.equal((await store.query(admin, next, { customerId: c.customerId })).total, 2)
      assert.equal((await store.query(santos, next, { customerId: c.customerId })).total, 0)
      const refreshed = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: c.serviceId })
      assert.deepEqual(refreshed.candidates.map(candidate => candidate.id), [merged.id])
      assert.equal((await store.query(santos, c.state, { mode: 'duplicateDetail', id: merged.id, customerId: c.customerId, serviceId: c.serviceId })).ticket.id, merged.id)
    })

    await t.test('un informe técnico del mismo caso agrega el aporte público sin duplicar y rechaza destinos cerrados', async () => {
      const c = context('report-same'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      const record = c.state.history.find(item => item.id === c.serviceId)
      const input = { type: 'Gestionar problema', description: 'Persiste la misma falla en la zona de ingreso.', relatedTicketId: ticket.id, relatedTicketVersion: ticket.version, relation: 'same' }
      const followup = createFollowup(record, input, santos, c.state, '2026-10-23T18:00:00Z')
      assert.equal(followup.duplicateReview, true)
      const next = { ...c.state, history: c.state.history.map(item => item.id === record.id ? { ...item, followup } : item) }
      await store.syncLegacy(next)
      await store.syncServices(c.state, next, { user: santos, reportRecordId: record.id, now: '2026-10-23T18:00:00.000Z' })
      const result = (await store.query(santos, next, { mode: 'detail', id: ticket.id })).ticket
      assert.equal((await store.query(admin, next, { customerId: c.customerId })).total, 1)
      assert.ok(result.coRequesterIds.includes(santos.id))
      assert.ok(result.messages.some(message => message.byId === santos.id && message.visibility === 'public' && message.body.includes(input.description)))
      assert.equal(result.sla.firstResponseAt, '')
      await store.syncLegacy(next)
      assert.equal((await store.query(santos, next, { mode: 'detail', id: ticket.id })).ticket.version, result.version)

      const closedContext = context('report-closed'), source = (await store.run(mariano, closedContext.state, closedContext.create())).ticket
      const closedRecord = closedContext.state.history.find(item => item.id === closedContext.serviceId)
      const pending = createFollowup(closedRecord, { ...input, relatedTicketId: source.id, relatedTicketVersion: source.version }, santos, closedContext.state, '2026-10-23T18:00:00Z')
      await store.run(admin, closedContext.state, command('resolve', { id: source.id, version: source.version, note: 'Caso terminado mientras se escribía el informe' }))
      const closedState = { ...closedContext.state, history: closedContext.state.history.map(item => item.id === closedRecord.id ? { ...item, followup: pending } : item) }
      await reject(() => store.syncLegacy(closedState), 409)
      assert.equal((await store.query(admin, closedState, { customerId: closedContext.customerId })).total, 1)
      assert.equal((await store.query(santos, closedState, { customerId: closedContext.customerId })).total, 0)
    })

    await t.test('un nuevo seguimiento de otro motivo requiere revisión vigente; los seguimientos históricos siguen migrando', async () => {
      const c = context('report-new'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      const record = c.state.history.find(item => item.id === c.serviceId)
      const found = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: record.id })
      const input = { type: 'Cotizar adicional', description: 'Solicita una cámara adicional, no relacionado con la falla.', relation: 'different', duplicateToken: found.duplicateToken }
      const followup = createFollowup(record, input, santos, c.state, '2026-10-23T18:00:00Z')
      assert.equal(followup.duplicateReview, true)
      assert.equal(followup.duplicateToken, found.duplicateToken)
      const withFollowup = value => ({ ...c.state, history: c.state.history.map(item => item.id === record.id ? { ...item, followup: value } : item) })
      await store.run(mariano, c.state, command('comment', { id: ticket.id, version: ticket.version, note: 'El caso cambió mientras se preparaba el informe' }))
      await reject(() => store.syncLegacy(withFollowup(followup)), 409)
      assert.equal((await store.query(admin, c.state, { customerId: c.customerId })).total, 1)
      const fresh = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: record.id })
      await store.syncLegacy(withFollowup({ ...followup, duplicateToken: fresh.duplicateToken }))
      assert.equal((await store.query(admin, c.state, { customerId: c.customerId })).total, 2)

      const legacyRecord = c.state.history.find(item => item.id === c.authorServiceId)
      const legacy = { id: 'legacy-unreviewed', type: 'Otra acción', description: 'Solicitud anterior al control de duplicados', status: 'Pendiente', createdById: mariano.id, createdByName: mariano.name, createdAt: '2026-10-20T14:00:00Z', events: [] }
      await store.syncLegacy({ ...c.state, history: [{ ...legacyRecord, followup: legacy }] })
      assert.equal((await store.query(admin, c.state, { customerId: c.customerId })).total, 3)
    })

    await t.test('dos informes que consultaron una cuenta sin casos no pueden crear el mismo reclamo sin revisar el primero', async () => {
      const c = context('report-empty-race')
      const authorRecord = c.state.history.find(item => item.id === c.authorServiceId)
      const secondRecord = c.state.history.find(item => item.id === c.serviceId)
      const authorSnapshot = await store.query(mariano, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: authorRecord.id })
      const secondSnapshot = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: secondRecord.id })
      assert.deepEqual(authorSnapshot.candidates, [])
      assert.deepEqual(secondSnapshot.candidates, [])
      assert.equal(authorSnapshot.duplicateToken, secondSnapshot.duplicateToken)
      const input = { type: 'Gestionar problema', description: 'La zona de ingreso registra activaciones sin motivo.' }
      const firstFollowup = createFollowup(authorRecord, { ...input, duplicateToken: authorSnapshot.duplicateToken }, mariano, c.state, '2026-10-23T18:00:00Z')
      const secondFollowup = createFollowup(secondRecord, { ...input, duplicateToken: secondSnapshot.duplicateToken }, santos, c.state, '2026-10-23T18:01:00Z')
      assert.equal(firstFollowup.relatedTicketId, '')
      assert.equal(secondFollowup.relatedTicketId, '')
      const firstState = { ...c.state, history: c.state.history.map(item => item.id === authorRecord.id ? { ...item, followup: firstFollowup } : item) }
      await store.syncLegacy(firstState)
      const secondState = { ...firstState, history: firstState.history.map(item => item.id === secondRecord.id ? { ...item, followup: secondFollowup } : item) }
      await reject(() => store.syncLegacy(secondState), 409)
      // Marcar "otro motivo" con la revisión vacía anterior tampoco evita la
      // comprobación transaccional del reclamo recién registrado.
      await reject(() => store.syncLegacy({ ...secondState, history: secondState.history.map(item => item.id === secondRecord.id ? { ...item, followup: { ...secondFollowup, relation: 'different' } } : item) }), 409)
      assert.equal((await store.query(admin, c.state, { customerId: c.customerId })).total, 1)
      assert.equal((await store.query(mariano, c.state, { customerId: c.customerId })).total, 1)
      assert.equal((await store.query(santos, c.state, { customerId: c.customerId })).total, 0)
      const fresh = await store.query(santos, c.state, { mode: 'duplicates', customerId: c.customerId, serviceId: secondRecord.id })
      assert.equal(fresh.candidates.length, 1)
      assert.notEqual(fresh.duplicateToken, secondSnapshot.duplicateToken)
    })

    await t.test('la coincidencia resuelve cuentas de servicios antiguos por código y permite informar servicios sin cuenta', async () => {
      const c = context('legacy-account'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      const legacyRecord = { ...c.state.history.find(item => item.id === c.serviceId) }
      delete legacyRecord.customerId
      const withoutAccount = { id: 'unlinked-technical-service', technicianIds: [santos.id], status: 'Pendiente', date: '2026-10-23', service: 'Revisar recurso interno' }
      const state = { ...c.state, history: [...c.state.history.map(item => item.id === legacyRecord.id ? legacyRecord : item), withoutAccount] }
      const found = await store.query(santos, state, { mode: 'duplicates', serviceId: legacyRecord.id })
      assert.equal(found.customerId, c.customerId)
      assert.deepEqual(found.candidates.map(candidate => candidate.id), [ticket.id])
      const preview = (await store.query(santos, state, { mode: 'duplicateDetail', id: ticket.id, serviceId: legacyRecord.id })).ticket
      assert.equal(preview.id, ticket.id)
      const followup = createFollowup(legacyRecord, { type: 'Gestionar problema', description: 'Aporte desde el servicio guardado sin identificador de cuenta.', relatedTicketId: ticket.id, relatedTicketVersion: preview.version }, santos, state, '2026-10-23T18:00:00Z')
      await store.syncLegacy({ ...state, history: state.history.map(item => item.id === legacyRecord.id ? { ...item, followup } : item) })
      assert.ok((await store.query(santos, state, { mode: 'detail', id: ticket.id })).ticket.coRequesterIds.includes(santos.id))
      assert.equal((await store.query(admin, state, { customerId: c.customerId })).total, 1)

      assert.deepEqual(await store.query(santos, state, { mode: 'duplicates', serviceId: withoutAccount.id }), { customerId: '', candidates: [], duplicateToken: '' })
      await reject(() => store.query(santos, state, { mode: 'duplicateDetail', id: ticket.id, serviceId: withoutAccount.id }), 400)
      await reject(() => store.run(santos, state, command('contribute', { id: ticket.id, version: preview.version, serviceId: withoutAccount.id, note: 'No se puede asociar sin cuenta' })), 400)
      const unlinkedFollowup = createFollowup(withoutAccount, { type: 'Otra acción', description: 'Revisar el recurso interno sin cuenta vinculada.' }, santos, state, '2026-10-23T18:01:00Z')
      await store.syncLegacy({ ...state, history: [{ ...withoutAccount, followup: unlinkedFollowup }] })
      const unlinked = (await store.query(santos, state)).items.find(item => item.legacyId === unlinkedFollowup.id)
      assert.ok(unlinked)
      assert.equal(unlinked.customerId, '')
    })

    await t.test('la versión leída del ticket es obligatoria y un cambio antes de guardar el informe exige revisarlo', async () => {
      const c = context('report-version'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      const record = c.state.history.find(item => item.id === c.serviceId)
      const input = { type: 'Gestionar problema', description: 'La falla ocurre en otra zona también.', relatedTicketId: ticket.id, relation: 'same' }
      for (const relatedTicketVersion of [undefined, 0, -1, 1.5]) assert.throws(() => createFollowup(record, { ...input, relatedTicketVersion }, santos, c.state, '2026-10-23T18:00:00Z'), error => error.statusCode === 409)
      const preview = (await store.query(santos, c.state, { mode: 'duplicateDetail', id: ticket.id, customerId: c.customerId, serviceId: record.id })).ticket
      const followup = createFollowup(record, { ...input, relatedTicketVersion: preview.version }, santos, c.state, '2026-10-23T18:00:00Z')
      assert.equal(followup.relatedTicketVersion, preview.version)
      const changed = (await store.run(mariano, c.state, command('comment', { id: ticket.id, version: ticket.version, note: 'Se agregó información mientras Santos preparaba el aporte' }))).ticket
      const withFollowup = value => ({ ...c.state, history: c.state.history.map(item => item.id === record.id ? { ...item, followup: value } : item) })
      await reject(() => store.syncLegacy(withFollowup(followup)), 409)
      assert.equal((await store.query(santos, c.state, { customerId: c.customerId })).total, 0)
      assert.equal((await store.query(admin, c.state, { customerId: c.customerId })).total, 1)
      const fresh = (await store.query(santos, c.state, { mode: 'duplicateDetail', id: ticket.id, customerId: c.customerId, serviceId: record.id })).ticket
      assert.equal(fresh.version, changed.version)
      await store.syncLegacy(withFollowup({ ...followup, relatedTicketVersion: fresh.version }))
      const saved = (await store.query(santos, c.state, { mode: 'detail', id: ticket.id })).ticket
      assert.equal(saved.version, changed.version + 1)
      assert.ok(saved.messages.some(message => message.byId === santos.id && message.body.includes(input.description)))
    })

    await t.test('un servicio agregado como contexto no anuncia la cancelación de una visita del reclamo', async () => {
      const c = context('report-context'), ticket = (await store.run(mariano, c.state, c.create())).ticket
      const record = c.state.history.find(item => item.id === c.serviceId)
      const followup = createFollowup(record, { type: 'Gestionar problema', description: 'El cliente informó la misma falla al cancelar otro trabajo.', relatedTicketId: ticket.id, relatedTicketVersion: ticket.version }, santos, c.state, '2026-10-23T18:00:00Z')
      const next = { ...c.state, history: c.state.history.map(item => item.id === record.id ? { ...item, status: 'Cancelado', technicalStatus: 'Cancelado', followup } : item) }
      await store.syncLegacy(next)
      await store.syncServices(c.state, next, { user: santos, reportRecordId: record.id, now: '2026-10-23T18:00:00.000Z' })
      const saved = (await store.query(santos, next, { mode: 'detail', id: ticket.id })).ticket
      assert.equal(saved.status, ticket.status)
      assert.equal(saved.sla.firstResponseAt, '')
      assert.ok(!saved.events.some(event => ['automatic-canceled', 'automatic-rescheduled', 'automatic-scheduled'].includes(event.action)))
      assert.ok(!saved.resolutionServiceIds.includes(record.id))
    })

    await t.test('un informe nuevo no usa el acceso personal al ticket para saltar una cuenta fuera del alcance permitido', async () => {
      const c = context('private-customer')
      const ticket = (await store.run(santos, c.state, c.create({ serviceId: c.serviceId }))).ticket
      const restricted = { ...santos, permissions: { ...santos.permissions, 'scope.customers.read.related': false, 'scope.customers.read.cctv': true } }
      const state = { ...c.state, roles: c.state.roles.map(role => ({ ...role, permissions: restricted.permissions })), employees: c.state.employees.map(employee => employee.id === restricted.id ? { ...employee, permissions: restricted.permissions } : employee) }
      const record = state.history.find(item => item.id === c.serviceId)
      // El caso propio sigue en su bandeja, pero el permiso de la cuenta es
      // independiente y debe cumplirse al asociar una solicitud nueva.
      assert.equal((await store.query(restricted, state, { mode: 'detail', id: ticket.id })).ticket.id, ticket.id)
      await reject(() => store.query(restricted, state, { mode: 'duplicates', serviceId: record.id }), 403)
      const input = { type: 'Otra acción', description: 'Solicitud nueva en una cuenta no autorizada.', relatedTicketId: ticket.id, relatedTicketVersion: ticket.version }
      const followup = createFollowup(record, input, restricted, state, '2026-10-23T18:00:00Z')
      await reject(() => store.syncLegacy({ ...state, history: state.history.map(item => item.id === record.id ? { ...item, followup } : item) }), 403)
      const unchanged = (await store.query(admin, state, { mode: 'detail', id: ticket.id })).ticket
      assert.equal(unchanged.version, ticket.version)
      assert.equal((await store.query(admin, state, { customerId: c.customerId })).total, 1)
    })
  } finally { await env.close() }
})
