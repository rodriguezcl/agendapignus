const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const domain = require('../api/_lib/tickets.cjs')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

const command = (action, fields = {}) => ({ action, commandId: crypto.randomUUID(), ...fields })
const administrator = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const user = (id, permissions = []) => ({ id, name: id, roleCode: 'custom', permissions: { __catalogV2: true, 'tickets.view': true, 'tickets.create': true, 'tickets.comment': true, ...Object.fromEntries(permissions.map(key => [key, true])) } })
function stateFixture() {
  return {
    roles: [{ id: 'admin-role', code: 'administrator', name: 'Administrador', permissions: {} }],
    employees: [{ id: 'admin', name: 'Administración', roleId: 'admin-role', status: 'Activo' }],
    customers: [1, 2].map(n => ({ customerId: `customer-${n}`, account: `PIG-${n}`, name: `Cliente ${n}`, address: `Calle ${n}`, phone: `351123456${n}`, monthlyFee: 50000, email: `customer${n}@example.test` })),
    history: []
  }
}
const createInput = (fields = {}) => command('create', { title: 'Revisar equipo', description: 'La alarma presenta activaciones reiteradas.', categoryId: 'alarm', subcategoryId: 'repeated', customerId: 'customer-1', origin: 'phone', ...fields })
async function fixture(engine) {
  if (engine === 'sqlite') {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys=ON')
    const store = createTicketStore({ db })
    await store.ensure()
    return { store, close: () => db.close(), query: (sql, args = []) => db.prepare(sql).all(...args), db }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  const store = createTicketStore({ sql: pgliteAdapter(pg) })
  await store.ensure()
  return { store, close: () => pg.close(), query: async (sql, args = []) => (await pg.query(sql, args)).rows, pg }
}
async function rejectsStatus(fn, statusCode, pattern) {
  await assert.rejects(fn, error => error.statusCode === statusCode && (!pattern || pattern.test(error.message)))
}

for (const engine of ['sqlite', 'postgres']) {
  test(`Tickets ${engine}: totales por estado y filtros coinciden con la bandeja`, async () => {
    const env = await fixture(engine), state = stateFixture()
    try {
      await env.store.run(administrator, state, createInput({ title: 'Sensor entrada', customerId: 'customer-1' }))
      const item = (await env.store.run(administrator, state, createInput({ title: 'Sensor patio', customerId: 'customer-2' }))).ticket
      await env.store.run(administrator, state, command('resolve', { id: item.id, version: item.version, note: 'Sensor reparado' }))
      for (const [params, total] of [[{}, 2], [{ status: 'open' }, 1], [{ status: 'Resuelto' }, 1], [{ status: 'Nuevo', search: 'patio' }, 0], [{ search: 'sensor' }, 2], [{ search: 'patio' }, 1]]) {
        const result = await env.store.query(administrator, state, params)
        assert.equal(result.total, total)
        assert.equal(result.items.length, total)
      }
      const lean = await env.store.query(administrator, state, { mode: 'metadata', includeMailStatus: 'false' })
      assert.ok(lean.config.categories.length)
      assert.ok(lean.assignees.length)
      assert.equal(lean.config.mail.error, undefined)
    } finally { await env.close() }
  })
  test(`Tickets ${engine}: Supervisor busca cuentas fuera de CCTV sólo para cargar y comparar solicitudes`, async () => {
    const env = await fixture(engine), state = stateFixture()
    const policy = require('../api/_lib/permission-catalog.cjs')
    const read = require('../api/_lib/granular-read-policy.cjs')
    const supervisor = { id: 'supervisor', role: 'Supervisor', roleCode: 'supervisor', permissions: {} }
    state.customers[0].name = 'MARTIN FRENCH'
    state.customers[0].cctvService = false
    state.customers[1].cctvService = true
    state.customers.push({ customerId: 'inactive', account: 'PIG-9', name: 'FRENCH INACTIVO', softguardPresence: { status: 'inactive' } })
    state.history = [{ id: 'private-visit', customerId: 'customer-1', status: 'Pendiente' }]
    try {
      const operators = [supervisor, { ...supervisor, permissions: policy.toGranularPermissions(supervisor) }]
      const existing = (await env.store.run(administrator, state, createInput())).ticket
      const withPrivateNote = (await env.store.run(administrator, state, command('comment', { id: existing.id, version: existing.version, note: 'Nota privada de administración', visibility: 'internal' }))).ticket
      for (const actor of operators) {
        const result = await env.store.query(actor, state, { mode: 'customers', search: 'martin french' })
        assert.deepEqual(result.items.map(c => c.account), ['PIG-1'])
        assert.deepEqual((await env.store.query(actor, state, { mode: 'customers', search: 'PIG-1' })).items, result.items)
        assert.equal((await env.store.query(actor, state, { mode: 'customers', search: 'FRENCH' })).items.length, 1)
        assert.equal(result.items[0].monthlyFee, undefined)
        assert.equal(read.customerReadable(state.customers[0], actor, state), false)
        assert.equal(read.customerReadable(state.customers[1], actor, state), true)
        assert.equal(read.serviceReadable(state.history[0], actor, state), false)
        assert.throws(() => domain.customerFor({ customerId: 'customer-1' }, actor, state), e => e.statusCode === 403)
        await rejectsStatus(() => env.store.query(actor, state, { mode: 'detail', id: existing.id }), 404)
        const review = await env.store.query(actor, state, { mode: 'duplicateDetail', id: existing.id, customerId: 'customer-1' })
        assert.ok(!JSON.stringify(review).includes('Nota privada'))
        assert.equal(review.ticket.customerSnapshot, undefined)
        await rejectsStatus(() => env.store.run(actor, state, createInput()), 409)
        await rejectsStatus(() => env.store.run(actor, state, createInput({ serviceId: 'private-visit' })), 403)
      }
      const found = await env.store.query(supervisor, state, { mode: 'duplicates', customerId: 'customer-1' })
      assert.deepEqual(found.candidates.map(c => c.id), [withPrivateNote.id])
      const created = (await env.store.run(supervisor, state, createInput({ allowDuplicate: true, duplicateToken: found.duplicateToken }))).ticket
      assert.equal(created.customerId, 'customer-1')
      assert.equal((await env.store.query(supervisor, state, { mode: 'detail', id: created.id })).ticket.id, created.id)
      assert.equal((await env.store.query(supervisor, state, {})).total, 1)
      const restricted = { ...supervisor, permissions: { ...policy.toGranularPermissions(supervisor), 'tickets.customers.all': false } }
      assert.deepEqual((await env.store.query(restricted, state, { mode: 'customers', search: 'french' })).items, [])
      await rejectsStatus(() => env.store.run(restricted, state, createInput()), 403)
      await rejectsStatus(() => env.store.query(restricted, state, { mode: 'duplicates', customerId: 'customer-1' }), 403)
      const noCreate = { ...supervisor, permissions: { ...policy.toGranularPermissions(supervisor), 'tickets.create': false } }
      assert.equal(policy.can(noCreate, 'tickets.customers.all'), false)
      await rejectsStatus(() => env.store.query(noCreate, state, { mode: 'customers', search: 'french' }), 403)
    } finally { await env.close() }
  })
}

for (const engine of ['sqlite', 'postgres']) {
  test(`Tickets ${engine}: persistencia, permisos, duplicados y trazabilidad`, async t => {
    const env = await fixture(engine), { store } = env, state = stateFixture()
    try {
      await t.test('crear es idempotente y el número no se consume al reintentar ni al rechazar', async () => {
        const input = createInput()
        const first = (await store.run(administrator, state, input)).ticket
        assert.equal(first.displayNumber, 'Ticket#1000001')
        assert.equal(first.priority, 'Media')
        assert.equal(first.customerSnapshot.account, 'PIG-1')
        assert.equal(first.messages.length, 1)
        const retry = (await store.run(administrator, state, input)).ticket
        assert.equal(retry.id, first.id)
        await rejectsStatus(() => store.run(administrator, state, { ...input, title: 'Otra operación' }), 409)
        await rejectsStatus(() => store.run(administrator, state, createInput()), 409)
        const internal = (await store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal' }))).ticket
        assert.equal(internal.number, '1000002')
      })

      await t.test('confirmar un caso distinto exige el token vigente, incluso tras otra observación', async () => {
        const candidate = (await store.query(administrator, state, { mode: 'duplicates', customerId: 'customer-1' }))
        assert.equal(candidate.candidates.length, 1)
        const original = candidate.candidates[0]
        await store.run(administrator, state, command('comment', { id: original.id, version: original.version, note: 'El abonado agrega información.' }))
        await rejectsStatus(() => store.run(administrator, state, createInput({ allowDuplicate: true, duplicateToken: candidate.duplicateToken })), 409)
        const fresh = await store.query(administrator, state, { mode: 'duplicates', customerId: 'customer-1' })
        const second = (await store.run(administrator, state, createInput({ allowDuplicate: true, duplicateToken: fresh.duplicateToken, title: 'Otro problema' }))).ticket
        assert.equal(second.number, '1000003')
      })

      await t.test('alcance propio conserva privacidad y permite revisar coincidencias al cargar', async () => {
        const outsider = user('outsider')
        assert.equal((await store.query(outsider, state, {})).total, 0)
        const duplicates = await store.query(outsider, state, { mode: 'duplicates', customerId: 'customer-1' })
        assert.equal(duplicates.candidates.length, 2)
        assert.ok(duplicates.candidates.every(item => !item.customerSnapshot && !item.requesterEmail))
        const own = (await store.run(outsider, state, createInput({ allowDuplicate: true, duplicateToken: duplicates.duplicateToken }))).ticket
        assert.equal(own.customerSnapshot.address, undefined)
        assert.equal(own.customerSnapshot.phone, undefined)
        assert.equal(own.customerSnapshot.monthlyFee, undefined)
        const privateUpdate = (await store.run(administrator, state, command('comment', { id: own.id, version: own.version, note: 'Nota reservada de administración', visibility: 'internal' }))).ticket
        const publicDetail = (await store.query(outsider, state, { mode: 'detail', id: own.id })).ticket
        assert.equal(publicDetail.messages.length, 1)
        assert.ok(!JSON.stringify(publicDetail).includes('Nota reservada'))
        assert.equal(privateUpdate.messages.length, 2)
        await rejectsStatus(() => store.run(outsider, state, command('comment', { id: own.id, version: privateUpdate.version, note: 'No permitido', visibility: 'internal' })), 403)
        await rejectsStatus(() => store.query(user('different'), state, { mode: 'detail', id: own.id }), 404)
      })

      await t.test('optimismo rechaza versiones antiguas sin perder aportes', async () => {
        const item = (await store.run(administrator, state, createInput({ customerId: 'customer-2' }))).ticket
        const first = (await store.run(administrator, state, command('comment', { id: item.id, version: item.version, note: 'Primer aporte' }))).ticket
        await rejectsStatus(() => store.run(administrator, state, command('comment', { id: item.id, version: item.version, note: 'Segundo aporte con versión vieja' })), 409)
        const result = (await store.query(administrator, state, { mode: 'detail', id: item.id })).ticket
        assert.equal(result.version, first.version)
        assert.equal(result.messages.length, 2)
      })

      await t.test('resolver un caso sin responsable lo asigna al actor, exige resultado y admite reapertura explícita', async () => {
        let item = (await store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'other', origin: 'internal' }))).ticket
        await rejectsStatus(() => store.run(administrator, state, command('resolve', { id: item.id, version: item.version, note: '' })), 400)
        const unchanged = (await store.query(administrator, state, { mode: 'detail', id: item.id })).ticket
        assert.equal(unchanged.assigneeId, '')
        assert.equal(unchanged.version, item.version)
        const input = command('resolve', { id: item.id, version: item.version, note: 'Reparada la impresora', assigneeId: 'fake-assignee', assigneeName: 'Falso', resolvedById: 'fake-actor', resolvedByName: 'Falso' })
        item = (await store.run(administrator, state, input)).ticket
        assert.equal(item.status, 'Resuelto')
        assert.equal(item.assigneeId, administrator.id)
        assert.equal(item.assigneeName, administrator.name)
        assert.equal(item.resolvedById, administrator.id)
        assert.equal(item.resolvedByName, administrator.name)
        const assignment = item.events.find(event => event.action === 'automatic-assignment')
        assert.ok(assignment)
        assert.equal(assignment.byId, administrator.id)
        assert.equal(assignment.byName, administrator.name)
        const retry = (await store.run(administrator, state, input)).ticket
        assert.equal(retry.version, item.version)
        assert.equal(retry.resolvedAt, item.resolvedAt)
        assert.equal(retry.events.length, item.events.length)
        assert.equal(retry.events.filter(event => event.action === 'automatic-assignment').length, 1)
        await rejectsStatus(() => store.run(administrator, state, command('comment', { id: item.id, version: item.version, note: 'Otra observación' })), 409)
        item = (await store.run(administrator, state, command('reopen', { id: item.id, version: item.version, note: 'La falla reapareció' }))).ticket
        assert.equal(item.status, 'En gestión')
        assert.ok(!item.resolvedById && !item.resolvedByName)
        assert.ok(item.events.some(event => event.action === 'Resolvió el ticket' && event.byId === administrator.id))
        assert.ok(item.events.some(event => event.action === 'Reabrió el ticket'))
        for (const action of ['automatic-received', 'automatic-reopened', 'automatic-resolved']) assert.ok(item.events.some(event => event.action === action))
      })

      await t.test('el permiso de resolver permite autoasignarse sin permiso adicional de asignación', async () => {
        const resolver = { ...user('resolver-no-assign', ['tickets.resolve']), name: 'Responsable de soporte' }
        assert.equal(domain.can(resolver, 'resolve'), true)
        assert.equal(domain.can(resolver, 'assign'), false)
        let item = (await store.run(resolver, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'other', origin: 'internal' }))).ticket
        await rejectsStatus(() => store.run(resolver, state, command('assign', { id: item.id, version: item.version, assigneeId: administrator.id })), 403)
        item = (await store.run(resolver, state, command('resolve', { id: item.id, version: item.version, note: 'Se restableció la conexión.' }))).ticket
        assert.equal(item.status, 'Resuelto')
        assert.equal(item.assigneeId, resolver.id)
        assert.equal(item.assigneeName, resolver.name)
        assert.equal(item.resolvedById, resolver.id)
        assert.equal(item.resolvedByName, resolver.name)
        const audited = (await store.query(administrator, state, { mode: 'detail', id: item.id })).ticket
        const event = audited.events.find(entry => entry.action === 'automatic-assignment')
        assert.equal(event.byId, resolver.id)
        assert.equal(event.byName, resolver.name)
      })

      await t.test('resolver conserva al responsable existente y registra por separado quién cerró el caso', async () => {
        const resolver = { ...user('closer', ['tickets.resolve']), name: 'Quien verifica la solución' }
        let item = (await store.run(resolver, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'other', origin: 'internal' }))).ticket
        item = (await store.run(administrator, state, command('assign', { id: item.id, version: item.version, assigneeId: administrator.id }))).ticket
        item = (await store.run(resolver, state, command('resolve', { id: item.id, version: item.version, note: 'Solución verificada con el solicitante.', assigneeId: resolver.id }))).ticket
        assert.equal(item.status, 'Resuelto')
        assert.equal(item.assigneeId, administrator.id)
        assert.equal(item.assigneeName, administrator.name)
        assert.equal(item.resolvedById, resolver.id)
        assert.equal(item.resolvedByName, resolver.name)
        const audited = (await store.query(administrator, state, { mode: 'detail', id: item.id })).ticket
        assert.equal(audited.events.filter(entry => entry.action === 'automatic-assignment').length, 0)
        assert.ok(audited.events.some(entry => entry.action === 'Resolvió el ticket' && entry.byId === resolver.id))
      })

      await t.test('la autoasignación no permite cerrar sin permiso ni acceder a tickets ajenos', async () => {
        const withoutResolve = user('without-resolve'), resolver = user('restricted-resolver', ['tickets.resolve'])
        const own = (await store.run(withoutResolve, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'other', origin: 'internal' }))).ticket
        await rejectsStatus(() => store.run(withoutResolve, state, command('resolve', { id: own.id, version: own.version, note: 'Intento sin permiso.' })), 403)
        await rejectsStatus(() => store.run(resolver, state, command('resolve', { id: own.id, version: own.version, note: 'Intento fuera de alcance.' })), 404)
        const unchanged = (await store.query(withoutResolve, state, { mode: 'detail', id: own.id })).ticket
        assert.equal(unchanged.status, 'Nuevo')
        assert.equal(unchanged.assigneeId, '')
        assert.equal(unchanged.version, own.version)
      })

      await t.test('adjuntos se conservan atómicamente sin incluir bytes en los DTO', async () => {
        const attachment = { name: 'comprobante.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4\nDocumento de prueba').toString('base64') }
        const ownUser = user('file-owner')
        const item = (await store.run(ownUser, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal', attachments: [attachment] }))).ticket
        const metadata = item.messages[0].attachments[0]
        assert.equal(metadata.fileName, attachment.name)
        assert.equal(metadata.data, undefined)
        const file = await store.attachment(ownUser, state, { id: item.id, attachmentId: metadata.id })
        assert.equal(file.data.toString('base64'), attachment.data)
        await rejectsStatus(() => store.attachment(user('unrelated'), state, { id: item.id, attachmentId: metadata.id }), 404)
        await rejectsStatus(() => store.run(ownUser, state, command('comment', { id: item.id, version: item.version, note: 'Archivo falso', attachments: [{ ...attachment, data: Buffer.from('<script>').toString('base64') }] })), 400)
        assert.equal((await store.query(ownUser, state, { mode: 'detail', id: item.id })).ticket.version, item.version)
      })

      await t.test('fusionar conserva entradas, autores y versión del principal', async () => {
        const source = (await store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal', description: 'Primer detalle' }))).ticket
        const target = (await store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal', description: 'Segundo detalle' }))).ticket
        await rejectsStatus(() => store.run(administrator, state, command('merge', { id: source.id, version: source.version, targetId: target.id, targetVersion: target.version + 1, note: 'Mismo problema' })), 409)
        const merged = (await store.run(administrator, state, command('merge', { id: source.id, version: source.version, targetId: target.id, targetVersion: target.version, note: 'Mismo problema' }))).ticket
        assert.equal(merged.id, target.id)
        const result = (await store.query(administrator, state, { mode: 'detail', id: target.id })).ticket
        assert.equal(result.messages.length, 2)
        assert.deepEqual(result.messages.map(m => m.body).sort(), ['Primer detalle', 'Segundo detalle'])
        assert.ok(result.messages.some(m => m.sourceTicketId === source.id))
        assert.ok(result.aliases.includes(source.number))
        assert.equal(result.version, target.version + 1)
      })

      await t.test('fusiones encadenadas resuelven números, reintentos y adjuntos al principal autorizado', async () => {
        const attachment = { name: 'registro.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4\nRegistro del caso').toString('base64') }
        const input = createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal', description: 'Origen de la cadena', requesterEmail: 'known@example.test', attachments: [attachment] })
        const first = (await store.run(administrator, state, input)).ticket
        const fileId = first.messages[0].attachments[0].id
        let middle = (await store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal', description: 'Intermedio' }))).ticket
        const last = (await store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal', description: 'Principal' }))).ticket
        middle = (await store.run(administrator, state, command('merge', { id: first.id, version: first.version, targetId: middle.id, targetVersion: middle.version, note: 'Primer vínculo' }))).ticket
        await store.run(administrator, state, command('merge', { id: middle.id, version: middle.version, targetId: last.id, targetVersion: last.version, note: 'Segundo vínculo' }))
        for (const identifier of [first.id, first.number, `Ticket#${first.number}`, middle.id]) {
          const result = (await store.query(administrator, state, { mode: 'detail', id: identifier })).ticket
          assert.equal(result.id, last.id)
          assert.equal(result.messages.length, 3)
          await rejectsStatus(() => store.query(user('not-participant'), state, { mode: 'detail', id: identifier }), 404)
        }
        assert.equal((await store.run(administrator, state, input)).ticket.id, last.id)
        const file = await store.attachment(administrator, state, { id: first.id, attachmentId: fileId })
        assert.equal(file.data.toString('base64'), attachment.data)
        await rejectsStatus(() => store.attachment(user('not-participant'), state, { id: first.id, attachmentId: fileId }), 404)
        const reply = { messageId: `<chain-${engine}@example.test>`, sender: { email: 'known@example.test', name: 'Solicitante' }, subject: `Re: Problema [Ticket#${first.number}]`, text: 'Nuevo detalle por correo', references: [], headerTicketNumbers: [first.number], mode: 'live', mailboxKey: 'live-chain' }
        const received = await store.ingestMail(reply)
        assert.equal(received.ticketId, last.id)
        assert.equal((await store.ingestMail(reply)).duplicate, true)
        const unknown = await store.ingestMail({ ...reply, messageId: `<unknown-${engine}@example.test>`, sender: { email: 'stranger@example.test', name: 'Desconocido' } })
        assert.notEqual(unknown.ticketId, last.id)
        assert.equal((await store.query(administrator, state, { mode: 'detail', id: last.id })).ticket.messages.length, 4)
      })

      await t.test('configuración mantiene historial, bloquea reinicio de números y cambios obsoletos', async () => {
        const metadata = await store.query(administrator, state, { mode: 'metadata' })
        const changed = structuredClone(metadata.config)
        changed.categories.find(c => c.id === 'alarm').subcategories.find(c => c.id === 'repeated').priority = 'Alta'
        const result = await store.run(administrator, state, command('configure', { config: changed, configVersion: metadata.configVersion }))
        assert.equal(result.configVersion, metadata.configVersion + 1)
        await rejectsStatus(() => store.run(administrator, state, command('configure', { config: changed, configVersion: metadata.configVersion })), 409)
        changed.startingNumber = 2000001
        await rejectsStatus(() => store.run(administrator, state, command('configure', { config: changed, configVersion: result.configVersion })), 409)
        await rejectsStatus(() => store.run(user('ordinary'), state, command('configure', { config: changed, configVersion: result.configVersion })), 403)
        const before = (await store.query(administrator, state, { categoryId: 'alarm' })).items
        assert.ok(before.every(item => item.priority === 'Media'))
      })

      await t.test('Seguimientos se incorporan una sola vez conservando autores y fechas', async () => {
        const legacyState = { ...state, history: [{ id: 'legacy-service', customerId: 'customer-1', clientAccount: 'PIG-1', client: 'Cliente 1', followup: { id: 'followup:legacy-service', type: 'Cotizar adicional', description: 'Cotizar sensores', status: 'Pendiente', createdAt: '2026-09-01T12:00:00.000Z', createdById: 'legacy-tech', createdByName: 'Técnico', events: [{ byId: 'legacy-tech', byName: 'Técnico', at: '2026-09-01T12:00:00.000Z', action: 'Creó la solicitud', note: 'Cotizar sensores' }] } }] }
        await store.syncLegacy(legacyState)
        await store.syncLegacy(legacyState)
        const list = await store.query(administrator, legacyState, { serviceId: 'legacy-service' })
        assert.equal(list.total, 1)
        const detail = (await store.query(administrator, legacyState, { mode: 'detail', id: list.items[0].id })).ticket
        assert.equal(detail.createdAt, '2026-09-01T12:00:00.000Z')
        assert.equal(detail.messages[0].byId, 'legacy-tech')
        assert.equal(detail.priority, 'Baja')
      })

      await t.test('solicitud técnica vinculada suma una vez y conserva fecha, autor y servicio', async () => {
        const requestState = { ...state, history: [] }
        const target = (await store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal' }))).ticket
        const linked = (await store.run(administrator, state, command('linkCustomer', { id: target.id, version: target.version, customerId: 'customer-1', note: 'Relacionada con esta cuenta' }))).ticket
        const count = (await store.query(administrator, state, {})).total
        requestState.history = [{ id: 'related-service', customerId: 'customer-1', clientAccount: 'PIG-1', client: 'Cliente 1', followup: { id: 'followup:related-service', relatedTicketId: linked.id, type: 'Gestionar problema', description: 'El técnico aporta un diagnóstico', status: 'Pendiente', createdAt: '2026-01-01T09:00:00.000Z', createdById: 'admin', createdByName: 'Administración', events: [] } }]
        await store.syncLegacy(requestState)
        await store.syncLegacy(requestState)
        assert.equal((await store.query(administrator, requestState, {})).total, count)
        const result = (await store.query(administrator, requestState, { mode: 'detail', id: linked.id })).ticket
        assert.equal(result.version, linked.version + 1)
        assert.equal(result.updatedAt, linked.updatedAt)
        assert.ok(result.serviceIds.includes('related-service'))
        const messages = result.messages.filter(message => message.sourceServiceId === 'related-service')
        assert.equal(messages.length, 1)
        assert.equal(messages[0].channel, 'technical')
        assert.equal(messages[0].byId, 'admin')
        assert.equal(messages[0].at, '2026-01-01T09:00:00.000Z')
      })

      await t.test('los aportes técnicos validan permiso, servicio y cuenta antes de vincular', async () => {
        const actor = user('technical-author')
        const duplicates = await store.query(actor, state, { mode: 'duplicates', customerId: 'customer-1' })
        const item = (await store.run(actor, state, createInput({ allowDuplicate: true, duplicateToken: duplicates.duplicateToken }))).ticket
        const relatedState = { ...state, history: [{ id: 'service-1', customerId: 'customer-1', technicianIds: ['technical-author'] }, { id: 'service-2', customerId: 'customer-2', technicianIds: ['technical-author'] }] }
        await rejectsStatus(() => store.run(actor, relatedState, command('comment', { id: item.id, version: item.version, note: 'Sin permiso técnico', serviceId: 'service-1' })), 403)
        await rejectsStatus(() => store.run(administrator, relatedState, command('comment', { id: item.id, version: item.version, note: 'Otra cuenta', serviceId: 'service-2' })), 400)
        await rejectsStatus(() => store.run(administrator, relatedState, command('comment', { id: item.id, version: item.version, note: 'No existe', serviceId: 'missing' })), 403)
        const result = (await store.run(administrator, relatedState, command('comment', { id: item.id, version: item.version, note: 'Diagnóstico nuevo', serviceId: 'service-1' }))).ticket
        assert.ok(result.serviceIds.includes('service-1'))
        const added = result.messages.find(message => message.body === 'Diagnóstico nuevo')
        assert.equal(added.sourceServiceId, 'service-1')
        assert.equal(added.channel, 'technical')
      })

      await t.test('nuevas solicitudes técnicas heredan las prioridades configuradas', async () => {
        const metadata = await store.query(administrator, state, { mode: 'metadata' })
        metadata.config.categories.find(category => category.id === 'commercial').subcategories.find(category => category.id === 'quote').priority = 'Alta'
        const saved = await store.run(administrator, state, command('configure', { config: metadata.config, configVersion: metadata.configVersion }))
        const technicalState = { ...state, history: [{ id: 'configured-request', customerId: 'customer-2', followup: { id: 'followup:configured-request', type: 'Cotizar adicional', description: 'Cotizar nueva cámara', status: 'Pendiente', createdAt: '2026-10-20T12:00:00.000Z', createdById: 'admin', createdByName: 'Administración', events: [] } }] }
        await store.syncLegacy(technicalState)
        const list = await store.query(administrator, technicalState, { serviceId: 'configured-request' })
        assert.equal(list.total, 1)
        assert.equal(list.items[0].priority, 'Alta')
        assert.equal(list.items[0].ruleVersion, saved.configVersion)
      })

      await t.test('correo test y live tienen deduplicación, hilos y fusiones separados', async () => {
        const base = { messageId: '<shared-id@example.test>', sender: { email: 'customer@example.test', name: 'Cliente' }, subject: 'Problema', text: 'Una observación', references: [], headerTicketNumbers: [] }
        const testMail = { ...base, mailboxKey: 'mailbox-test', mode: 'test' }, liveMail = { ...base, mailboxKey: 'mailbox-live', mode: 'live' }
        const testing = await store.ingestMail(testMail)
        const testingTicket = (await store.query(administrator, state, { mode: 'detail', id: testing.ticketId })).ticket
        const real = await store.ingestMail({ ...liveMail, references: [base.messageId], headerTicketNumbers: [testingTicket.number] })
        assert.notEqual(real.ticketId, testing.ticketId)
        assert.equal((await store.ingestMail(testMail)).duplicate, true)
        assert.equal((await store.ingestMail(liveMail)).duplicate, true)
        const liveTicket = (await store.query(administrator, state, { mode: 'detail', id: real.ticketId })).ticket
        assert.equal(testingTicket.mailMode, 'test')
        assert.equal(liveTicket.mailMode, 'live')
        assert.equal(liveTicket.messages[0].messageId, base.messageId)
        await rejectsStatus(() => store.run(administrator, state, command('merge', { id: testingTicket.id, version: testingTicket.version, targetId: liveTicket.id, targetVersion: liveTicket.version, note: 'No mezclar prueba y real' })), 409)
        const differentMailbox = await store.ingestMail({ ...base, mailboxKey: 'mailbox-other-live', mode: 'live' })
        const other = (await store.query(administrator, state, { mode: 'detail', id: differentMailbox.ticketId })).ticket
        await rejectsStatus(() => store.run(administrator, state, command('merge', { id: other.id, version: other.version, targetId: liveTicket.id, targetVersion: liveTicket.version, note: 'No mezclar buzones' })), 409)
        const collidingMail = { ...liveMail, sender: { email: 'another@example.test', name: 'Otro remitente' } }
        const collision = await store.ingestMail(collidingMail)
        assert.notEqual(collision.ticketId, liveTicket.id)
        assert.equal((await store.ingestMail(collidingMail)).duplicate, true)
        assert.equal((await store.query(administrator, state, { mode: 'detail', id: collision.ticketId })).ticket.mailReviewRequired, true)
      })
    } finally { await env.close() }
  })
}

test('Tickets SQLite: escrituras concurrentes asignan números distintos', async () => {
  const env = await fixture('sqlite'), state = stateFixture()
  try {
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => env.store.run(administrator, state, createInput({ customerId: '', categoryId: 'internal', subcategoryId: 'printing', origin: 'internal', title: `Solicitud ${index}` }))))
    assert.equal(new Set(results.map(item => item.ticket.number)).size, 12)
    assert.equal((await env.store.query(administrator, state, {})).total, 12)
  } finally { await env.close() }
})

test('Tickets dominio: configuración hereda prioridad y preserva categorías retiradas', () => {
  const state = stateFixture(), original = domain.defaultConfig(), input = structuredClone(original)
  input.categories = input.categories.filter(item => item.id !== 'commercial')
  input.categories[0].priority = 'Alta'
  input.categories[0].subcategories = [{ id: 'new', name: 'Nueva subcategoría', active: true }]
  const result = domain.validateConfig(input, state, original)
  assert.equal(domain.classification(result, 'alarm', 'new').effective.priority, 'Alta')
  assert.equal(result.categories.find(item => item.id === 'commercial').active, false)
  assert.equal(result.categories[0].subcategories.find(item => item.id === 'repeated').active, false)
})
