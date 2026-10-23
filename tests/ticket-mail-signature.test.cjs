const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSignature, appendSignature, sanitizeSignatureHtml, MAX_SIGNATURE_HTML, MAX_SIGNATURE_TEXT } = require('../api/_lib/ticket-mail-signature.cjs')
const { prepareTicketReply, ticketMailConfig, outboxOperation } = require('../api/_lib/ticket-mail.cjs')
const { createSmtpAdapter, processOutbox } = require('../api/_lib/ticket-mail-worker.cjs')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { sqliteTicketMailStore } = require('../api/_lib/ticket-mail-store.cjs')
const { DatabaseSync } = require('node:sqlite')

const config = () => ({ ...ticketMailConfig({ TICKETS_MAIL_ENABLED: 'true', TICKETS_MAIL_MODE: 'live', TICKETS_MAIL_ADDRESS: 'support@example.com', TICKETS_MAIL_USER: 'support@example.com', TICKETS_MAIL_PASSWORD: 'fake-password' }), signature: { enabled: true, html: '<p><strong>Soporte Pignus</strong><br>Tel. 3511234567</p>' } })
const ticket = { id: 'signature-ticket', number: '1000001', title: 'Consulta', requesterEmail: 'customer@example.com' }
const actor = { id: 'operator', name: 'Operador' }

test('firma conserva formato, tablas, enlaces y logos HTTPS y deriva el texto seguro', () => {
  const signature = normalizeSignature({ enabled: true, text: 'Texto inyectado', html: '<table style="border-collapse:collapse"><tr><td style="padding:8px;color:#334455;font-family:Arial, sans-serif"><b>Cristian Rodríguez</b><br><a href="mailto:soporte@example.com">Soporte</a></td><td><img src="https://example.com/logo.png" width="120" alt="Pignus"></td></tr></table>' })
  assert.match(signature.html, /<table|color:#334455|padding:8px/)
  assert.match(signature.html, /src="https:\/\/example.com\/logo.png"/)
  assert.match(signature.html, /href="mailto:soporte@example.com"/)
  assert.match(signature.text, /Cristian Rodríguez/)
  assert.match(signature.text, /Pignus/)
  assert.doesNotMatch(signature.text, /Texto inyectado|<|logo.png/)
})

test('firma elimina scripts, SVG, eventos, CSS activo y URLs locales o ejecutables', () => {
  const dirty = '<p onclick="alert(1)" style="position:fixed;z-index:9999;color:#123456;background-image:url(https://example.com/tracker);width:expression(alert(1))">Firma</p><script>alert(1)</script><iframe src="https://evil.com"></iframe><svg><a onload="alert(1)">SVG</a></svg><style>body{display:none}</style><form>Oculto<input value="x"></form>' +
    ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'cid:logo', 'file:///secret', '//example.com/logo.png', 'http://example.com/logo.png', 'https://localhost/logo.png', 'https://127.0.0.1/logo', 'https://10.0.0.1/logo', 'https://[::1]/logo', 'https://user:pass@example.com/logo', 'https://server.local/logo'].map(src => `<img src="${src}" onerror="alert(1)">`).join('') +
    '<a href="jav&#x61;script:alert(1)">No ejecutar</a><a href="http://example.com">Sitio</a><a href="tel:+543511234567">Llamar</a>'
  const clean = normalizeSignature({ enabled: true, html: dirty })
  assert.doesNotMatch(clean.html, /script|iframe|svg|onerror|onclick|position|z-index|expression|background-image|<style|<form|<img|javascript:|data:|cid:|file:/i)
  assert.match(clean.html, /color:#123456/)
  assert.match(clean.html, /href="http:\/\/example.com\/"/)
  assert.match(clean.html, /href="tel:\+543511234567"/)
  assert.doesNotMatch(clean.text, /alert|SVG|Oculto/)
})

test('firma rechaza límites y activación vacía; apagada conserva borrador', () => {
  assert.deepEqual(normalizeSignature(undefined), { enabled: false, html: '', text: '' })
  for (const input of [{ enabled: true, html: '' }, { enabled: true, html: '<script>hola</script>' }, { enabled: true, html: 'a'.repeat(MAX_SIGNATURE_HTML + 1) }, { enabled: true, html: 'a'.repeat(MAX_SIGNATURE_TEXT + 1) }, { enabled: 'true', html: 'x' }]) assert.throws(() => normalizeSignature(input), { code: 'MAIL_SIGNATURE_INVALID' })
  assert.equal(normalizeSignature({ enabled: false, html: '<b>Firma borrador</b>' }).text, 'Firma borrador')
  assert.deepEqual(appendSignature('Respuesta', { enabled: false, html: '<b>Firma borrador</b>' }), { text: 'Respuesta' })
})

test('respuesta firma una sola vez al encolar, escapa HTML y conserva versión enviada', () => {
  const current = config()
  const reply = prepareTicketReply(ticket, { text: 'Hola <script>alert(1)</script> & "cliente"\nSeguimos.' }, actor, current)
  assert.equal(reply.entry.text, reply.outbox.payload.text)
  assert.match(reply.outbox.payload.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;cliente&quot;<br>Seguimos/)
  assert.doesNotMatch(reply.outbox.payload.html, /<script>/)
  assert.match(reply.outbox.payload.text, /Seguimos\.\n\nSoporte Pignus/)
  const snapshot = JSON.stringify(reply.outbox.payload)
  current.signature.html = '<p>Otra firma</p>'
  assert.equal(JSON.stringify(reply.outbox.payload), snapshot)
  assert.equal((reply.outbox.payload.text.match(/Soporte Pignus/g) || []).length, 1)
})

test('reintento SMTP usa el snapshot de cola aunque cambie la firma del buzón', async () => {
  const db = new DatabaseSync(':memory:'), store = createTicketStore({ db }), mailStore = sqliteTicketMailStore(db)
  try {
    await store.ensure()
    const current = config(), prepared = prepareTicketReply(ticket, { text: 'Respuesta inicial' }, actor, current)
    const op = outboxOperation(prepared.outbox); db.prepare(op.sql).run(...op.params)
    current.signature.html = '<p>Firma posterior</p>'
    const seen = [], runner = () => processOutbox({ config: current, mailStore, ticketStore: { async applyDelivery() {} }, deadline: Date.now() + 5000, now: Date.now, smtpFactory: () => ({ async send(row) { seen.push(structuredClone(row.payload)); if (seen.length === 1) throw Object.assign(new Error('Reintentar antes de DATA'), { responseCode: 450 }); return { accepted: [row.payload.to] } }, close() {} }) })
    assert.equal((await runner()).retried, 1)
    db.prepare('UPDATE pignus_ticket_mail_outbox SET next_attempt_at=?').run(new Date(0).toISOString())
    assert.equal((await runner()).sent, 1)
    assert.deepEqual(seen, [prepared.outbox.payload, prepared.outbox.payload])
  } finally { db.close() }
})

test('adaptador SMTP entrega HTML seguro y texto; mensajes anteriores siguen en texto', async t => {
  const network = require('../api/_lib/ticket-mail-network.cjs'), nodemailer = require('nodemailer'), sent = []
  t.mock.method(network, 'resolveMailEndpoint', async () => ({ host: '8.8.8.8', port: 465, servername: 'smtp.example.com' }))
  t.mock.method(nodemailer, 'createTransport', () => ({ async sendMail(message) { sent.push(message); return { accepted: [message.to] } }, close() {} }))
  const current = config(), smtp = createSmtpAdapter(current), payload = prepareTicketReply(ticket, { text: 'Respuesta con firma' }, actor, current).outbox.payload
  await smtp.send({ payload, message_id: '<signed@example.com>', ticket_id: ticket.id })
  assert.equal(sent[0].text, payload.text)
  assert.equal(sent[0].html, sanitizeSignatureHtml(payload.html))
  assert.equal(sent[0].disableFileAccess, true); assert.equal(sent[0].disableUrlAccess, true)
  await smtp.send({ payload: { to: ticket.requesterEmail, text: 'Mensaje anterior', subject: 'Anterior' }, message_id: '<old@example.com>', ticket_id: ticket.id })
  assert.equal(sent[1].html, undefined); assert.equal(sent[1].text, 'Mensaje anterior')
  await smtp.send({ payload: { ...payload, html: payload.html + '<script>injected()</script><img src="file:///private">' }, message_id: '<sanitized@example.com>', ticket_id: ticket.id })
  assert.doesNotMatch(sent[2].html, /script|injected|file:/)
  smtp.close()
})
