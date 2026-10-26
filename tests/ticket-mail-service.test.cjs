const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { createMailService, workerSecret, workerAuthorized, CHANNEL_LEASE } = require('../api/_lib/ticket-mail-service.cjs')
const { sqliteTicketMailStore } = require('../api/_lib/ticket-mail-store.cjs')

const admin = { id: 'admin', name: 'Administración', roleCode: 'administrator' }
const env = { PIGNUS_SESSION_SECRET: 'clave-ficticia-para-pruebas-correo-agentec-1234' }
const settings = () => ({
  address: 'soporte@example.com', senderName: 'Soporte', areaId: 'technical', mode: 'test', testSourceConfirmed: true,
  incoming: { protocol: 'imap', host: 'imap.example.com', port: 993, security: 'tls', user: 'soporte@example.com', folder: 'Pruebas', password: 'clave-entrante-ficticia' },
  outgoing: { protocol: 'smtp', host: 'smtp.example.com', port: 587, security: 'starttls', user: 'envios@example.com', useIncomingCredentials: false, password: 'clave-saliente-ficticia' }
})

async function fixture(overrides = {}) {
  const db = new DatabaseSync(':memory:'), ticketStore = createTicketStore({ db })
  await ticketStore.ensure()
  const seen = []
  const service = createMailService({ db, ticketStore, env,
    testDependencies: { resolveEndpoint: async () => ({ host: '8.8.8.8', port: 993, servername: 'mail.example.com' }),
      createImap: () => ({ on() {}, async connect() {}, async mailboxOpen(folder, options) { assert.deepEqual(options, { readOnly: true }) }, close() {} }),
      createSmtp: () => ({ async verify() {}, close() {} }) },
    runMail: async ({ config }) => { seen.push(config); return { enabled: config.enabled, received: 0, sent: 0 } }, ...overrides })
  const request = (input, user = admin) => service.request({ method: input ? 'POST' : 'GET', input, user, state: {} })
  const activate = async (mode = 'test') => {
    let dto = await request({ action: 'save', version: 0, settings: { ...settings(), mode } })
    for (const direction of ['incoming', 'outgoing']) dto = await request({ action: 'test', version: dto.version, direction })
    return request({ action: 'activate', version: dto.version })
  }
  return { db, ticketStore, service, seen, request, activate, close: () => db.close() }
}

test('el scheduler sólo admite Bearer exacto y secreto de servidor configurado', () => {
  const secret = 'secreto-ficticio-del-scheduler-123456789'
  for (const authorization of [undefined, secret, `Bearer ${secret}x`, `Basic ${secret}`, [`Bearer ${secret}`]]) assert.equal(workerAuthorized({ headers: { authorization } }, { TICKETS_MAIL_WORKER_SECRET: secret }), false)
  assert.equal(workerAuthorized({ headers: { authorization: `Bearer ${secret}` } }, { TICKETS_MAIL_WORKER_SECRET: secret }), true)
  assert.equal(workerAuthorized({ headers: { authorization: 'Bearer corto' } }, { TICKETS_MAIL_WORKER_SECRET: 'corto' }), false)
  assert.equal(workerAuthorized({ headers: { authorization: `Bearer ${secret}` } }, {}), false)
})

test('el scheduler deriva una clave dedicada estable sin aceptar el secreto de sesión', () => {
  const secret = workerSecret(env)
  assert.match(secret, /^[a-f0-9]{64}$/)
  assert.equal(workerSecret({ ...env }), secret)
  assert.notEqual(workerSecret({ PIGNUS_SESSION_SECRET: env.PIGNUS_SESSION_SECRET + 'rotado' }), secret)
  assert.equal(workerAuthorized({ headers: { authorization: `Bearer ${secret}` } }, env), true)
  assert.equal(workerAuthorized({ headers: { authorization: `Bearer ${env.PIGNUS_SESSION_SECRET}` } }, env), false)
  for (const PIGNUS_SESSION_SECRET of [undefined, '', 'corta', 123]) assert.equal(workerSecret({ PIGNUS_SESSION_SECRET }), null)
})

test('un secreto explícito inválido no permite volver a la clave derivada', () => {
  const derived = workerSecret(env)
  const explicit = 'clave-explicita-para-worker-de-correo-123456789'
  assert.equal(workerSecret({ ...env, TICKETS_MAIL_WORKER_SECRET: explicit }), explicit)
  assert.equal(workerAuthorized({ headers: { authorization: `Bearer ${derived}` } }, { ...env, TICKETS_MAIL_WORKER_SECRET: explicit }), false)
  for (const value of ['', 'corta', 123, false, null]) {
    const configured = { ...env, TICKETS_MAIL_WORKER_SECRET: value }
    assert.equal(workerSecret(configured), null)
    assert.equal(workerAuthorized({ headers: { authorization: `Bearer ${derived}` } }, configured), false)
  }
})

test('el estado local informa que la ejecución automática no está configurada', async () => {
  const f = await fixture()
  try {
    const result = await f.request()
    assert.equal(result.scheduler.configured, false)
    assert.equal(result.scheduler.active, false)
    assert.equal(result.scheduler.state, 'unconfigured')
    assert.equal(result.scheduler.lastAttemptAt, null)
  } finally { f.close() }
})

test('el scheduler procesa SLA aunque el correo esté deshabilitado y no duplica tareas ante un error', async () => {
  const calls = [], f = await fixture()
  try {
    f.ticketStore.processSla = async () => { calls.push('sla'); return { reminders: 2 } }
    const result = await f.service.process()
    assert.equal(result.enabled, false)
    assert.deepEqual(result.sla, { reminders: 2 })
    assert.deepEqual(calls, ['sla'])
    assert.equal(f.seen.length, 1)
    f.ticketStore.processSla = async () => { throw new Error('Fallo de persistencia del SLA') }
    await assert.rejects(f.service.process(), /persistencia del SLA/)
    assert.equal(f.seen.length, 1)
    assert.equal((await sqliteTicketMailStore(f.db).cursor(CHANNEL_LEASE)).lease_owner, null)
  } finally { f.close() }
})

test('consultar, guardar, probar y procesar correo exige configurar Tickets', async () => {
  const f = await fixture()
  try {
    for (const action of [null, 'save', 'save-signature', 'test', 'activate', 'disable', 'run']) await assert.rejects(f.request(action && { action }, { id: 'tech', roleCode: 'technician' }), { statusCode: 403 })
    await assert.rejects(f.service.request({ method: 'DELETE', user: admin }), { statusCode: 405 })
    assert.equal(f.seen.length, 0)
  } finally { f.close() }
})

test('el proceso usa la configuración cifrada de la UI y separa las credenciales SMTP', async () => {
  const f = await fixture()
  try {
    const active = await f.activate()
    assert.equal(active.enabled, true)
    assert.equal(JSON.stringify(active).includes('clave-entrante-ficticia'), false)
    await f.service.process()
    assert.equal(f.seen.length, 1)
    assert.equal(f.seen[0].password, 'clave-entrante-ficticia')
    assert.equal(f.seen[0].smtpPassword, 'clave-saliente-ficticia')
    assert.equal(f.seen[0].smtpPort, 587)
    assert.equal(f.seen[0].smtpSecurity, 'starttls')
    assert.equal(f.seen[0].areaId, 'technical')
    assert(f.seen[0].maxRunMs > 0 && f.seen[0].maxRunMs <= 20000)
    const stopped = await f.request({ action: 'disable', version: active.version })
    assert.equal(stopped.enabled, false)
    await f.service.process()
    assert.equal(f.seen[1].enabled, false)
    assert.equal(f.seen[1].password, '')
  } finally { f.close() }
})

test('sincronizar manualmente en operativo exige confirmación explícita de envíos', async () => {
  const f = await fixture()
  try {
    await f.activate('live')
    await assert.rejects(f.request({ action: 'run' }), { statusCode: 409 })
    assert.equal(f.seen.length, 0)
    const result = await f.request({ action: 'run', confirmSend: true })
    assert.equal(result.result.enabled, true)
    assert.equal(f.seen.length, 1)
    assert.equal(result.settings.mode, 'live')
  } finally { f.close() }
})

test('guardar y sincronizar comparten bloqueo entre procesos y lo liberan al fallar', async () => {
  const f = await fixture({ runMail: async () => { throw Object.assign(new Error('respuesta con contraseña privada'), { code: 'EAUTH' }) } })
  try {
    await f.activate()
    const mailStore = sqliteTicketMailStore(f.db)
    const owner = await mailStore.acquireMailbox(CHANNEL_LEASE, 10000)
    await assert.rejects(f.request({ action: 'save', version: 4, settings: settings() }), { statusCode: 409 })
    await assert.rejects(f.request({ action: 'save-signature', version: 4, signature: { enabled: true, html: 'Firma' } }), { statusCode: 409 })
    await assert.rejects(f.service.process(), { statusCode: 409 })
    await mailStore.releaseMailbox(CHANNEL_LEASE, owner)
    await assert.rejects(f.service.process(), error => error.statusCode === 502 && !error.message.includes('privada'))
    assert.equal((await mailStore.cursor(CHANNEL_LEASE)).lease_owner, null)
  } finally { f.close() }
})

test('la activación vuelve a validar que el área de destino siga activa', async () => {
  const f = await fixture()
  try {
    let dto = await f.request({ action: 'save', version: 0, settings: settings() })
    for (const direction of ['incoming', 'outgoing']) dto = await f.request({ action: 'test', version: dto.version, direction })
    const record = JSON.parse(f.db.prepare("SELECT data FROM pignus_ticket_settings WHERE id='config'").get().data)
    record.config.areas.find(area => area.id === 'technical').active = false
    f.db.prepare("UPDATE pignus_ticket_settings SET data=? WHERE id='config'").run(JSON.stringify(record))
    await assert.rejects(f.request({ action: 'activate', version: dto.version }), /área de destino/)
  } finally { f.close() }
})

test('el correo nuevo usa el área elegida y una respuesta conserva su asignación', async () => {
  const f = await fixture()
  try {
    const metadata = await f.ticketStore.query(admin, {}, { mode: 'metadata' })
    const area = metadata.config.areas.find(item => item.id !== 'technical')
    assert.ok(area)
    const mail = { messageId: '<primero@example.com>', sender: { email: 'cliente@example.com', name: 'Cliente' }, subject: 'Consulta', text: 'Necesito ayuda', mode: 'live', mailboxKey: 'test-key', areaId: area.id }
    const first = await f.ticketStore.ingestMail(mail)
    const ticket = (await f.ticketStore.query(admin, {}, { mode: 'detail', id: first.ticketId })).ticket
    assert.equal(ticket.areaId, area.id)
    await f.ticketStore.ingestMail({ ...mail, messageId: '<segundo@example.com>', inReplyTo: mail.messageId, areaId: 'technical' })
    const updated = (await f.ticketStore.query(admin, {}, { mode: 'detail', id: first.ticketId })).ticket
    assert.equal(updated.areaId, area.id)
  } finally { f.close() }
})

test('firma común se guarda sin reprobar correo y queda en cola e historial sólo para respuestas externas', async () => {
  const f = await fixture(), previousSecret = process.env.PIGNUS_SESSION_SECRET
  process.env.PIGNUS_SESSION_SECRET = env.PIGNUS_SESSION_SECRET
  try {
    const active = await f.activate('live')
    await assert.rejects(f.request({ action: 'save-signature', version: active.version }), { code: 'MAIL_SIGNATURE_INVALID' })
    const signed = await f.request({ action: 'save-signature', version: active.version, signature: { enabled: true, html: '<b>Atención Pignus</b><br>Equipo de soporte' } })
    assert.equal(signed.enabled, true)
    assert.deepEqual(signed.tests, active.tests)
    const metadata = await f.ticketStore.query(admin, {}, { mode: 'metadata' })
    assert.equal(metadata.config.mail.signatureEnabled, true)
    assert.equal(metadata.config.mail.signature, undefined)
    assert.equal(metadata.config.mail.outboundEnabled, true)
    const runtime = await require('../api/_lib/ticket-mail-channel.cjs').createMailChannelStore({ db: f.db, env }).runtime()
    const received = await f.ticketStore.ingestMail({ messageId: '<signature-case@example.com>', sender: { email: 'cliente@example.com', name: 'Cliente' }, subject: 'Consulta firma', text: 'Necesito ayuda', mode: 'live', mailboxKey: runtime.mailboxKey, areaId: 'technical' })
    let ticket = (await f.ticketStore.query(admin, {}, { mode: 'detail', id: received.ticketId })).ticket
    const command = (action, note) => ({ action, commandId: require('node:crypto').randomUUID(), id: ticket.id, version: ticket.version, note })
    ticket = (await f.ticketStore.run(admin, {}, command('reply', 'Estamos revisando el caso.'))).ticket
    const response = ticket.messages.find(item => item.deliveryStatus === 'queued')
    const payload = JSON.parse(f.db.prepare('SELECT payload FROM pignus_ticket_mail_outbox WHERE entry_id=?').get(response.id).payload)
    assert.equal(response.body, payload.text)
    assert.equal(response.note, payload.text)
    assert.match(response.body, /Estamos revisando el caso\.\n\nAtención Pignus\nEquipo de soporte/)
    assert.match(payload.html, /<b>Atención Pignus<\/b>/)
    ticket = (await f.ticketStore.run(admin, {}, { ...command('comment', 'Nota sólo interna'), visibility: 'internal' })).ticket
    const note = ticket.messages.find(item => item.body === 'Nota sólo interna')
    assert.equal(note.visibility, 'internal')
    const state = { roles: [{ id: 'admin-role', code: 'administrator', name: 'Administrador', permissions: {} }], employees: [{ id: admin.id, name: admin.name, roleId: 'admin-role', status: 'Activo' }] }
    ticket = (await f.ticketStore.run(admin, state, { ...command('assign', ''), assigneeId: admin.id })).ticket
    ticket = (await f.ticketStore.run(admin, {}, command('resolve', 'Quedó solucionado'))).ticket
    assert.equal(ticket.status, 'Resuelto')
    assert.equal(ticket.resolution, 'Quedó solucionado')
    const stored = f.db.prepare('SELECT data FROM pignus_ticket_entries WHERE ticket_id=?').all(ticket.id).map(row => JSON.parse(row.data))
    const outbox = f.db.prepare('SELECT entry_id,payload FROM pignus_ticket_mail_outbox').all().map(row => ({ ...row, payload: JSON.parse(row.payload) }))
    assert.equal(outbox.filter(row => !row.payload.automatic).length, 1)
    const resolved = stored.find(item => item.action === 'automatic-resolved')
    assert.ok(resolved)
    assert.ok(outbox.some(row => row.entry_id === resolved.id && row.payload.automatic === true))
    assert.equal(stored.filter(item => item.body?.includes('Atención Pignus')).length, outbox.length)
    assert.ok(outbox.every(row => row.payload.text.includes('Atención Pignus') && row.payload.html.includes('<b>Atención Pignus</b>')))
    assert.equal(note.body, 'Nota sólo interna')
  } finally {
    if (previousSecret === undefined) delete process.env.PIGNUS_SESSION_SECRET
    else process.env.PIGNUS_SESSION_SECRET = previousSecret
    f.close()
  }
})

async function slaMailCase(f, suffix) {
  await f.activate('live')
  const runtime = await require('../api/_lib/ticket-mail-channel.cjs').createMailChannelStore({ db: f.db, env }).runtime()
  const received = await f.ticketStore.ingestMail({ messageId: `<sla-${suffix}@example.com>`, sender: { email: 'cliente@example.com', name: 'Cliente' }, subject: 'Revisión del equipo', text: 'Necesito ayuda', mode: 'live', mailboxKey: runtime.mailboxKey, areaId: 'technical' })
  const detail = async () => (await f.ticketStore.query(admin, {}, { mode: 'detail', id: received.ticketId })).ticket
  const initial = await detail()
  const at = minutes => new Date(new Date(initial.sla.startedAt).getTime() + minutes * 60000).toISOString()
  const entries = () => f.db.prepare('SELECT data FROM pignus_ticket_entries WHERE ticket_id=?').all(received.ticketId).map(row => JSON.parse(row.data))
  const deliver = async (entry, minutes, status = 'sent') => {
    const outbox = f.db.prepare('SELECT * FROM pignus_ticket_mail_outbox WHERE entry_id=?').get(entry.id)
    assert.ok(outbox, 'La comunicación debe tener una entrega en cola')
    await f.ticketStore.applyDelivery({ ...outbox, status, finished_at: at(minutes) })
    return detail()
  }
  const command = async (action, note, extra = {}, state = {}) => {
    const item = await detail()
    return (await f.ticketStore.run(admin, state, { action, commandId: require('node:crypto').randomUUID(), id: item.id, version: item.version, note, ...extra })).ticket
  }
  return { detail, at, entries, deliver, command }
}

test('SLA por correo: acuse, comentario y respuesta en cola no cuentan; la entrega real sí', async () => {
  const f = await fixture(), previousSecret = process.env.PIGNUS_SESSION_SECRET
  process.env.PIGNUS_SESSION_SECRET = env.PIGNUS_SESSION_SECRET
  try {
    const c = await slaMailCase(f, 'delivery')
    let ticket = await c.detail()
    assert.equal(ticket.sla.firstResponseAt, '')
    ticket = await c.deliver(c.entries().find(entry => entry.action === 'automatic-received'), 1)
    assert.equal(ticket.sla.firstResponseAt, '')
    ticket = await c.command('comment', 'Revisamos el caso desde la plataforma.', { visibility: 'public' })
    assert.equal(ticket.sla.firstResponseAt, '')
    ticket = await c.command('reply', 'Estamos revisando la conexión del equipo y te avisaremos los avances.')
    assert.equal(ticket.sla.firstResponseAt, '')
    assert.equal(ticket.sla.lastHumanUpdateAt, '')
    const response = c.entries().find(entry => entry.deliveryStatus === 'queued' && !entry.automatic)
    assert.ok(response)
    for (const status of ['failed', 'uncertain']) {
      ticket = await c.deliver(response, 2, status)
      assert.equal(ticket.sla.firstResponseAt, '')
      assert.equal(ticket.sla.lastHumanUpdateAt, '')
    }
    ticket = await c.deliver(response, 3)
    assert.equal(ticket.sla.firstResponseAt, c.at(3))
    assert.equal(ticket.sla.lastHumanUpdateAt, c.at(3))
    assert.equal(ticket.slaSummary.firstResponse.completedAt, c.at(3))
    ticket = await c.deliver(response, 4)
    assert.equal(ticket.sla.firstResponseAt, c.at(3))
    assert.equal(ticket.sla.lastHumanUpdateAt, c.at(3))
  } finally {
    if (previousSecret === undefined) delete process.env.PIGNUS_SESSION_SECRET
    else process.env.PIGNUS_SESSION_SECRET = previousSecret
    f.close()
  }
})

test('SLA por correo: resolver cierra el caso pero la respuesta se registra al entregar el aviso', async () => {
  const f = await fixture(), previousSecret = process.env.PIGNUS_SESSION_SECRET
  process.env.PIGNUS_SESSION_SECRET = env.PIGNUS_SESSION_SECRET
  try {
    const c = await slaMailCase(f, 'resolved')
    const state = { roles: [{ id: 'admin-role', code: 'administrator', name: 'Administrador', permissions: {} }], employees: [{ id: admin.id, name: admin.name, roleId: 'admin-role', status: 'Activo' }] }
    await c.command('assign', '', { assigneeId: admin.id }, state)
    let ticket = await c.command('resolve', 'El equipo volvió a comunicarse correctamente.')
    assert.equal(ticket.status, 'Resuelto')
    assert.equal(ticket.sla.firstResponseAt, '')
    assert.equal(ticket.slaSummary.firstResponse.status, 'pending')
    assert.equal(ticket.slaSummary.firstResponse.completedAt, '')
    const completedAt = ticket.sla.completedAt
    const response = c.entries().find(entry => entry.action === 'automatic-resolved')
    ticket = await c.deliver(response, 10)
    assert.equal(ticket.sla.firstResponseAt, c.at(10))
    assert.equal(ticket.slaSummary.firstResponse.completedAt, c.at(10))
    assert.equal(ticket.sla.completedAt, completedAt)
    assert.equal(ticket.slaSummary.resolution.completedAt, completedAt)
  } finally {
    if (previousSecret === undefined) delete process.env.PIGNUS_SESSION_SECRET
    else process.env.PIGNUS_SESSION_SECRET = previousSecret
    f.close()
  }
})

test('SLA por correo: entregar una respuesta del ciclo anterior no responde una reapertura', async () => {
  const f = await fixture(), previousSecret = process.env.PIGNUS_SESSION_SECRET
  process.env.PIGNUS_SESSION_SECRET = env.PIGNUS_SESSION_SECRET
  try {
    const c = await slaMailCase(f, 'reopened')
    await c.command('reply', 'La primera revisión está en curso.')
    const oldReply = c.entries().find(entry => entry.deliveryStatus === 'queued' && !entry.automatic)
    const state = { roles: [{ id: 'admin-role', code: 'administrator', name: 'Administrador', permissions: {} }], employees: [{ id: admin.id, name: admin.name, roleId: 'admin-role', status: 'Activo' }] }
    await c.command('assign', '', { assigneeId: admin.id }, state)
    await c.command('resolve', 'La primera revisión concluyó.')
    let ticket = await c.command('reopen', 'El cliente informa que la falla continúa.')
    assert.equal(ticket.sla.cycle, 2)
    ticket = await c.deliver(oldReply, 10)
    assert.equal(ticket.sla.firstResponseAt, '')
    assert.equal(ticket.sla.lastHumanUpdateAt, '')
    await c.command('reply', 'Gracias por avisarnos; estamos revisando la nueva información.')
    const newReply = c.entries().find(entry => entry.deliveryStatus === 'queued' && !entry.automatic && entry.id !== oldReply.id)
    ticket = await c.deliver(newReply, 20)
    assert.equal(ticket.sla.firstResponseAt, c.at(20))
    assert.equal(ticket.sla.cycle, 2)
  } finally {
    if (previousSecret === undefined) delete process.env.PIGNUS_SESSION_SECRET
    else process.env.PIGNUS_SESSION_SECRET = previousSecret
    f.close()
  }
})
