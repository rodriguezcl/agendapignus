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

test('consultar, guardar, probar y procesar correo exige configurar Tickets', async () => {
  const f = await fixture()
  try {
    for (const action of [null, 'save', 'test', 'activate', 'disable', 'run']) await assert.rejects(f.request(action && { action }, { id: 'tech', roleCode: 'technician' }), { statusCode: 403 })
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
    assert.equal(f.seen[0].maxRunMs, 20000)
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
