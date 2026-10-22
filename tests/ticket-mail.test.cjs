const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { ticketMailConfig, parseTicketMail, prepareTicketReply, classifyDeliveryError, safeMailError, outboxOperation } = require('../api/_lib/ticket-mail.cjs')
const { sqliteTicketMailStore } = require('../api/_lib/ticket-mail-store.cjs')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { runTicketMail, processOutbox } = require('../api/_lib/ticket-mail-worker.cjs')

const env = (extra = {}) => ({ TICKETS_MAIL_ENABLED: 'true', TICKETS_MAIL_MODE: 'test', TICKETS_MAIL_TEST_SOURCE_CONFIRMED: 'true', TICKETS_MAIL_ADDRESS: 'support@example.test', TICKETS_MAIL_USER: 'test-user', TICKETS_MAIL_PASSWORD: 'test-only-fake-password', ...extra })
const source = (id, options = {}) => Buffer.from([
  `From: ${options.from || 'Cliente <customer@example.test>'}`, 'To: support@example.test',
  `Subject: ${options.subject || 'La alarma tiene un problema'}`, `Message-ID: <${id}@example.test>`,
  ...(options.references ? [`References: ${options.references}`] : []), ...(options.reply ? [`In-Reply-To: ${options.reply}`] : []),
  ...(options.headers || []), `Content-Type: ${options.type || 'text/plain'}; charset=utf-8`, '', options.text || 'Se activa durante la noche.'
].join('\r\n'))

function fixture() {
  const db = new DatabaseSync(':memory:')
  const mailStore = sqliteTicketMailStore(db), ticketStore = createTicketStore({ db })
  const config = ticketMailConfig(env())
  let snapshot = { uidValidity: '123', uidNext: 4 }, messages = []
  const seen = { connects: 0, reads: [], smtp: 0 }
  const imapFactory = () => ({
    async connect() { seen.connects++ }, snapshot: () => snapshot,
    async metadata(start, end) { return messages.filter(message => message.uid >= start && message.uid <= end).map(message => ({ uid: message.uid, size: message.source.length })) },
    async read(uid) { seen.reads.push(uid); return messages.find(message => message.uid === uid).source }, async close() {}
  })
  const run = extra => runTicketMail({ config, mailStore, ticketStore, imapFactory, smtpFactory: () => { seen.smtp++; throw new Error('SMTP no debe construirse en test') }, ...extra })
  return { db, config, mailStore, ticketStore, seen, run, setMailbox(next, nextMessages = messages) { snapshot = next; messages = nextMessages } }
}

test('correo deshabilitado no exige credenciales ni abre conexiones', async () => {
  const config = ticketMailConfig({})
  assert.equal(config.enabled, false)
  const result = await runTicketMail({ config })
  assert.equal(result.enabled, false)
  assert.throws(() => ticketMailConfig(env({ TICKETS_MAIL_TEST_SOURCE_CONFIRMED: '' })), /fuente|buzón|carpeta/)
  assert.throws(() => ticketMailConfig(env({ TICKETS_MAIL_MODE: 'unexpected' })), /test o live/)
})

test('parser conserva texto seguro, referencias y formato Ticket# sin renderizar HTML', async () => {
  const parsed = await parseTicketMail(source('html', { subject: 'Re: Alarma [Ticket#453276]', type: 'text/html', text: '<p>Puerta de ingreso</p><script>alert(1)</script><img src="https://example.test/tracker.png">', reply: '<original@example.test>', references: '<older@example.test> <original@example.test>' }), { ownAddress: 'support@example.test' })
  assert.match(parsed.text, /Puerta de ingreso/)
  assert.doesNotMatch(parsed.text, /<script|<img|<p>/)
  assert.equal(parsed.html, undefined)
  assert.deepEqual(parsed.headerTicketNumbers, ['453276'])
  assert.equal(parsed.inReplyTo, '<original@example.test>')
  assert.deepEqual(parsed.references, ['<older@example.test>', '<original@example.test>'])
})

test('el mensaje sin Message-ID recibe una huella estable y no un identificador aleatorio', async () => {
  const raw = Buffer.from('From: person@example.test\r\nTo: support@example.test\r\nSubject: Consulta\r\n\r\nTexto')
  assert.equal((await parseTicketMail(raw)).messageId, (await parseTicketMail(raw)).messageId)
})

test('bloquea adjuntos inválidos sin omitirlos silenciosamente', async () => {
  const raw = Buffer.from('From: customer@example.test\r\nMessage-ID: <unsafe@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nAdjunto\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="fake.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nZXhlY3V0YWJsZQ==\r\n--b--')
  await assert.rejects(parseTicketMail(raw), { code: 'MAIL_ATTACHMENT_REVIEW' })
})

test('detecta respuestas automáticas, rebotes y mensajes propios para evitar bucles', async () => {
  assert.equal((await parseTicketMail(source('auto', { headers: ['Auto-Submitted: auto-replied'] }))).automated, true)
  assert.equal((await parseTicketMail(source('bounce', { from: 'MAILER-DAEMON@example.test' }))).bounce, true)
  assert.equal((await parseTicketMail(source('self', { from: 'support@example.test' }), { ownAddress: 'support@example.test' })).loop, true)
  assert.equal((await parseTicketMail(source('loop', { headers: ['X-Agentec-Ticket: ticket-1'] }))).loop, true)
  assert.equal((await parseTicketMail(source('bounce-path', { headers: ['Return-Path: <>'] }))).bounce, true)
})

test('adjuntos PDF válidos se incorporan como bytes y no como URL o ruta del servidor', async () => {
  const pdf = Buffer.from('%PDF-1.7\n%%EOF')
  const raw = Buffer.from(`From: customer@example.test\r\nMessage-ID: <safe@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nAdjunto\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="reclamo.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${pdf.toString('base64')}\r\n--b--`)
  const message = await parseTicketMail(raw)
  assert.equal(message.attachments.length, 1)
  assert.equal(message.attachments[0].mime, 'application/pdf')
  assert.deepEqual(message.attachments[0].data, pdf)
  assert.equal(message.attachments[0].path, undefined)
})

test('primera activación omite todo el historial y procesa nuevos UID aunque estén leídos', async () => {
  const f = fixture()
  try {
    f.setMailbox({ uidValidity: '123', uidNext: 4 }, [{ uid: 1, source: source('historical') }])
    assert.equal((await f.run()).activated, true)
    assert.deepEqual(f.seen.reads, [])
    assert.equal((await f.mailStore.cursor(f.config.mailboxKey)).last_uid, 3)
    f.setMailbox({ uidValidity: '123', uidNext: 5 }, [{ uid: 4, source: source('new'), flags: ['\\Seen'] }])
    assert.equal((await f.run()).received, 1)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pignus_tickets').get().n, 1)
    assert.equal(f.seen.smtp, 0)
    assert.equal((await f.run()).received, 0)
  } finally { f.db.close() }
})

test('dedup por Message-ID permite repetir ingestión si el cursor no llegó a guardarse', async () => {
  const f = fixture()
  try {
    await f.run()
    f.setMailbox({ uidValidity: '123', uidNext: 5 }, [{ uid: 4, source: source('retry') }])
    const advance = f.mailStore.advance.bind(f.mailStore)
    f.mailStore.advance = async () => { throw new Error('simulated interruption after ticket commit') }
    await assert.rejects(f.run(), /interruption/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pignus_tickets').get().n, 1)
    f.mailStore.advance = advance
    assert.equal((await f.run()).duplicates, 1)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pignus_ticket_entries').get().n, 1)
  } finally { f.db.close() }
})

test('cambio de UIDVALIDITY se detiene sin importar historial ni avanzar el cursor', async () => {
  const f = fixture()
  try {
    await f.run()
    f.setMailbox({ uidValidity: '999', uidNext: 10 })
    await assert.rejects(f.run(), { code: 'MAIL_UIDVALIDITY_CHANGED' })
    const cursor = await f.mailStore.cursor(f.config.mailboxKey)
    assert.equal(cursor.uid_validity, '123')
    assert.equal(cursor.last_uid, 3)
    assert.match(JSON.parse(cursor.last_error).message, /identificadores/)
  } finally { f.db.close() }
})

test('bucles y respuestas automáticas quedan registrados sin crear tickets ni enviar acuses', async () => {
  const f = fixture()
  try {
    await f.run()
    f.setMailbox({ uidValidity: '123', uidNext: 6 }, [
      { uid: 4, source: source('autoreply', { headers: ['Auto-Submitted: auto-replied'] }) },
      { uid: 5, source: source('own', { from: 'support@example.test' }) }
    ])
    const result = await f.run()
    assert.equal(result.skipped, 2)
    assert.equal(result.received, 0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pignus_tickets').get().n, 0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pignus_ticket_mail_skipped').get().n, 2)
    assert.equal(f.seen.smtp, 0)
    assert.equal((await f.mailStore.cursor(f.config.mailboxKey)).last_uid, 5)
  } finally { f.db.close() }
})

test('la exclusión del worker impide procesar el mismo buzón concurrentemente', async () => {
  const f = fixture()
  try {
    await f.ticketStore.ensure()
    const owner = await f.mailStore.acquireMailbox(f.config.mailboxKey, 5000)
    assert.ok(owner)
    assert.equal((await f.run()).busy, true)
    assert.equal(f.seen.connects, 0)
    await f.mailStore.releaseMailbox(f.config.mailboxKey, owner)
    assert.equal((await f.run()).activated, true)
  } finally { f.db.close() }
})

test('un correo inválido genera un caso para revisión sin detener los mensajes siguientes', async () => {
  const f = fixture()
  try {
    await f.run()
    f.setMailbox({ uidValidity: '123', uidNext: 5 }, [{ uid: 4, source: Buffer.from('From: invalid\r\n\r\nTexto') }])
    assert.equal((await f.run()).received,1)
    assert.equal((await f.mailStore.cursor(f.config.mailboxKey)).last_uid, 4)
    const item=JSON.parse(f.db.prepare('SELECT data FROM pignus_tickets').get().data)
    assert.equal(item.mailReviewRequired,true)
    assert.match(item.description,/remitente válido/)
    const status = await f.mailStore.status(f.config.mailboxKey)
    assert.equal(status.lastError, null)
    assert.doesNotMatch(JSON.stringify(status), /test-only-fake-password|invalid\r/)
  } finally { f.db.close() }
})

test('hilos sólo incorporan remitentes participantes; conocer Ticket# no otorga acceso', async () => {
  const f = fixture()
  try {
    const first = await f.ticketStore.ingestMail(await parseTicketMail(source('first')))
    const item = JSON.parse(f.db.prepare('SELECT data FROM pignus_tickets WHERE id=?').get(first.ticketId).data)
    const followup = await f.ticketStore.ingestMail(await parseTicketMail(source('second', { reply: '<first@example.test>' })))
    assert.equal(followup.ticketId, first.ticketId)
    const foreign = await f.ticketStore.ingestMail(await parseTicketMail(source('foreign', { from: 'stranger@example.test', subject: `Re: [Ticket#${item.number}]`, reply: '<first@example.test>' })))
    assert.notEqual(foreign.ticketId, first.ticketId)
    assert.equal(JSON.parse(f.db.prepare('SELECT data FROM pignus_tickets WHERE id=?').get(foreign.ticketId).data).customerId, '')
  } finally { f.db.close() }
})

test('respuesta queda en cola y respeta destinatarios; test jamás permite enviar', () => {
  const item = { id: 'ticket-1', number: '453276', title: 'Consulta', requesterEmail: 'customer@example.test', entries: [{ messageId: '<first@example.test>', channel: 'email' }] }
  const user = { id: 'user-1', name: 'Operador' }
  assert.throws(() => prepareTicketReply(item, { text: 'Respuesta' }, user, env()), { code: 'MAIL_TEST_NO_SEND' })
  assert.throws(() => prepareTicketReply(item, { text: 'Respuesta', to: 'stranger@example.test' }, user, env({ TICKETS_MAIL_MODE: 'live' })), { code: 'MAIL_RECIPIENT_FORBIDDEN' })
  const reply = prepareTicketReply(item, { text: 'Respuesta' }, user, env({ TICKETS_MAIL_MODE: 'live' }))
  assert.equal(reply.entry.deliveryStatus, 'queued')
  assert.equal(reply.outbox.payload.subject, 'Consulta [Ticket#453276]')
  assert.equal(reply.outbox.payload.inReplyTo, '<first@example.test>')
})

test('clasificación SMTP nunca reintenta automáticamente un timeout con entrega incierta', () => {
  assert.equal(classifyDeliveryError({ code: 'ETIMEDOUT', command: 'DATA' }), 'uncertain')
  assert.equal(classifyDeliveryError({ code: 'ECONNECTION', command: 'CONN' }), 'retry')
  assert.equal(classifyDeliveryError({ responseCode: 450 }), 'retry')
  assert.equal(classifyDeliveryError({ responseCode: 550 }), 'failed')
  assert.doesNotMatch(JSON.stringify(safeMailError({ code: 'EAUTH', message: 'password=secret-value' })), /secret-value/)
})

test('activar live no habilita respuestas de tickets de prueba ni consume su cola', async () => {
  const f = fixture()
  try {
    await f.ticketStore.ensure()
    const testConfig = ticketMailConfig(env()), liveConfig = ticketMailConfig(env({ TICKETS_MAIL_MODE: 'live' }))
    assert.notEqual(testConfig.mailboxKey, liveConfig.mailboxKey)
    const item = { id: 'test-ticket', number: '1000001', title: 'Prueba', mailMode: 'test', requesterEmail: 'customer@example.test' }
    assert.throws(() => prepareTicketReply(item, { text: 'Respuesta' }, { id: 'u' }, env({ TICKETS_MAIL_MODE: 'live' })), { code: 'MAIL_TEST_NO_SEND' })
    // Incluso una cola de prueba heredada o creada por una versión anterior permanece aislada.
    const pending = prepareTicketReply({ ...item, mailMode: 'live' }, { text: 'Respuesta' }, { id: 'u' }, env({ TICKETS_MAIL_MODE: 'live' }))
    const op = outboxOperation({ ...pending.outbox, mailboxKey: testConfig.mailboxKey })
    f.db.prepare(op.sql).run(...op.params)
    let sends = 0
    const smtpFactory = () => ({ async send() { sends++; return { accepted: ['customer@example.test'] } }, close() {} })
    await processOutbox({ config: liveConfig, mailStore: f.mailStore, ticketStore: { async applyDelivery() {} }, smtpFactory, deadline: Date.now() + 5000, now: Date.now })
    await processOutbox({ config: testConfig, mailStore: f.mailStore, ticketStore: { async applyDelivery() {} }, smtpFactory, deadline: Date.now() + 5000, now: Date.now })
    assert.equal(sends, 0)
    assert.equal(f.db.prepare('SELECT status FROM pignus_ticket_mail_outbox').get().status, 'queued')
  } finally { f.db.close() }
})

test('worker al cambiar test a live inicia otro cursor y no incorpora correo real al caso de prueba', async () => {
  const f = fixture()
  try {
    await f.run()
    f.setMailbox({ uidValidity: '123', uidNext: 5 }, [{ uid: 4, source: source('copied-message') }])
    await f.run()
    const liveConfig = ticketMailConfig(env({ TICKETS_MAIL_MODE: 'live' }))
    assert.equal((await f.run({ config: liveConfig })).activated, true)
    assert.deepEqual(f.seen.reads, [4])
    f.setMailbox({ uidValidity: '123', uidNext: 6 }, [{ uid: 5, source: source('copied-message', { reply: '<copied-message@example.test>' }) }])
    assert.equal((await f.run({ config: liveConfig })).received, 1)
    const items = f.db.prepare('SELECT data FROM pignus_tickets').all().map(row => JSON.parse(row.data))
    assert.equal(items.length, 2)
    assert.deepEqual(items.map(item => item.mailMode).sort(), ['live', 'test'])
    assert.notEqual(items[0].mailboxKey, items[1].mailboxKey)
    assert.equal(f.seen.smtp, 0)
  } finally { f.db.close() }
})

test('un envío interrumpido queda incierto al recuperar y no se vuelve a enviar', async () => {
  const f = fixture()
  try {
    await f.ticketStore.ensure()
    const config = ticketMailConfig(env({ TICKETS_MAIL_MODE: 'live' }))
    const item = { id: 't', number: '1000001', title: 'Consulta', requesterEmail: 'customer@example.test' }
    const op = outboxOperation(prepareTicketReply(item, { text: 'Respuesta' }, { id: 'u' }, env({ TICKETS_MAIL_MODE: 'live' })).outbox)
    f.db.prepare(op.sql).run(...op.params)
    f.db.prepare("UPDATE pignus_ticket_mail_outbox SET status='sending',started_at=?,attempts=1").run(new Date(Date.now() - 15 * 60_000).toISOString())
    let calls = 0
    await processOutbox({ config, mailStore: f.mailStore, ticketStore: { async applyDelivery() {} }, smtpFactory: () => { calls++; throw new Error('No reenviar') }, deadline: Date.now() + 5000, now: Date.now })
    assert.equal(calls, 0)
    assert.equal(f.db.prepare('SELECT status FROM pignus_ticket_mail_outbox').get().status, 'uncertain')
  } finally { f.db.close() }
})

test('outbox conserva resultado incierto y no duplica envío; sólo sent tras aceptación SMTP', async () => {
  const f = fixture()
  try {
    await f.ticketStore.ensure()
    const config = ticketMailConfig(env({ TICKETS_MAIL_MODE: 'live' }))
    const insert = prepared => { const op = outboxOperation(prepared.outbox); f.db.prepare(op.sql).run(...op.params) }
    const item = { id: 'ticket-1', number: '453276', title: 'Consulta', requesterEmail: 'customer@example.test' }
    insert(prepareTicketReply(item, { text: 'Respuesta' }, { id: 'u' }, env({ TICKETS_MAIL_MODE: 'live' })))
    let sends = 0
    const runner = smtpFactory => processOutbox({ config, mailStore: f.mailStore, ticketStore: { async applyDelivery() {} }, smtpFactory, deadline: Date.now() + 5000, now: Date.now })
    const uncertain = await runner(() => ({ async send() { sends++; throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', command: 'DATA' }) }, close() {} }))
    assert.equal(uncertain.uncertain, 1)
    await runner(() => ({ async send() { sends++; return { accepted: ['customer@example.test'] } }, close() {} }))
    assert.equal(sends, 1)
    insert(prepareTicketReply(item, { text: 'Otra respuesta' }, { id: 'u' }, env({ TICKETS_MAIL_MODE: 'live' })))
    assert.equal((await runner(() => ({ async send() { sends++; return { accepted: ['customer@example.test'] } }, close() {} }))).sent, 1)
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pignus_ticket_mail_outbox WHERE status='sent'").get().n, 1)
  } finally { f.db.close() }
})
