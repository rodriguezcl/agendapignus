const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { NOTIFICATION_SCHEMA, eventContent, communicateTicket, readNotifications, acknowledgeNotifications } = require('../api/_lib/ticket-communications.cjs')
const { MAIL_SCHEMA } = require('../api/_lib/ticket-mail-store.cjs')

const ticket = () => ({ id: 'case-1', number: '1000001', title: 'Revisar alarma', origin: 'phone',
  requesterId: 'operator-1', createdById: 'operator-1', requesterName: 'María', assigneeId: 'support-1', status: 'En gestión' })
const runtime = { enabled: true, mode: 'live', mailboxKey: 'mailbox-live', address: 'support@example.com', signature: { enabled: true, html: '<b>Soporte Pignus</b>', text: 'Soporte Pignus' } }
const emailTicket = () => ({ ...ticket(), origin: 'email', requesterId: '', createdById: 'email', mailMode: 'live', mailboxKey: runtime.mailboxKey, requesterEmail: 'customer@example.com' })
const now = '2026-10-22T15:00:00.000Z'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE pignus_tickets (id TEXT PRIMARY KEY); CREATE TABLE pignus_ticket_entries (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id), at TEXT NOT NULL, data TEXT NOT NULL)')
  for (const statement of [...NOTIFICATION_SCHEMA, ...MAIL_SCHEMA]) db.exec(statement)
  db.prepare('INSERT INTO pignus_tickets (id) VALUES (?)').run('case-1')
  const q = async (sql, args = []) => /\bSELECT\b|\bRETURNING\b/i.test(sql) ? db.prepare(sql).all(...args) : (db.prepare(sql).run(...args), [])
  const communicate = (options = {}) => communicateTicket({ q, ticket: ticket(), type: 'scheduled', eventKey: 'service-1:created', now, actorId: 'support-1', context: { service: { date: '2026-10-23', time: '09:30' } }, ...options })
  const entries = () => db.prepare('SELECT data FROM pignus_ticket_entries ORDER BY at,id').all().map(row => JSON.parse(row.data))
  const outbox = () => db.prepare('SELECT * FROM pignus_ticket_mail_outbox').all().map(row => ({ ...row, payload: JSON.parse(row.payload) }))
  return { db, q, communicate, entries, outbox }
}

test('avisos empáticos no anticipan trabajo ni publican notas internas', () => {
  const received = eventContent('received', ticket())
  assert.match(received.body, /Gracias por contarnos/)
  assert.match(received.body, /revisará el caso/)
  assert.doesNotMatch(received.body, /estamos trabajando|24 horas|resuelto/)
  const waiting = eventContent('waiting', { ...ticket(), waitReason: 'Clave privada del panel 1234' }, { note: 'Información interna' })
  assert.doesNotMatch(waiting.body, /1234|Información interna/)
  assert.match(eventContent('resolved', ticket(), { sourceTechnical: true }, 'email').body, /El equipo técnico confirmó.*responder este correo/)
  assert.match(eventContent('resolved', ticket()).body, /agregar una observación al ticket/)
  assert.doesNotMatch(eventContent('resolved', ticket()).body, /equipo técnico confirmó/)
})

test('la fecha de visita conserva el día de agenda y no inventa un horario ausente', () => {
  assert.match(eventContent('scheduled', ticket(), { date: '2026-10-23', time: '08:30' }).body, /viernes, 23 de octubre de 2026 a las 08:30 h/)
  for (const context of [{}, { date: '2026-02-31', time: '08:30' }, { date: '2026-10-23', time: '99:88' }]) {
    const body = eventContent('scheduled', ticket(), context).body
    assert.match(body, /Registramos una visita en la agenda/)
    assert.doesNotMatch(body, /99:88|31 de febrero|undefined/)
  }
})

test('el evento y sus avisos son idempotentes y sobreviven al cierre del caso', async () => {
  const f = fixture()
  try {
    assert.deepEqual(await f.communicate(), { created: true, notifications: 1, queued: false, entryId: f.entries()[0].id })
    assert.deepEqual(await f.communicate(), { created: false, notifications: 0, queued: false })
    await f.communicate({ ticket: { ...ticket(), status: 'Resuelto' }, type: 'resolved', eventKey: 'service-1:completed', context: { sourceTechnical: true } })
    const notices = await readNotifications(f.q, 'operator-1')
    assert.equal(notices.length, 2)
    assert.ok(notices.some(item => item.title.includes('Caso resuelto')))
    assert.ok(notices.every(item => item.target.notificationId === item.id && item.target.ticketId === 'case-1'))
    assert.equal(f.entries().length, 2)
    assert.ok(f.entries().every(item => item.kind === 'event' && item.automatic === true))
  } finally { f.db.close() }
})

test('el acuse de lectura no elimina ni revela avisos de otro destinatario', async () => {
  const f = fixture()
  try {
    await f.communicate({ recipients: ['operator-1', 'operator-2', 'support-1', 'email', 'operator-1'] })
    const first = (await readNotifications(f.q, 'operator-1'))[0]
    assert.equal((await readNotifications(f.q, 'operator-2')).length, 1)
    assert.equal((await readNotifications(f.q, 'support-1')).length, 0)
    assert.equal((await acknowledgeNotifications(f.q, 'operator-2', { ids: [first.id] }, now)).acknowledged, 0)
    assert.equal((await acknowledgeNotifications(f.q, 'operator-1', { ids: [first.id] }, now)).acknowledged, 1)
    assert.equal((await readNotifications(f.q, 'operator-1')).length, 0)
    assert.equal((await readNotifications(f.q, 'operator-2')).length, 1)
    assert.equal((await acknowledgeNotifications(f.q, 'operator-2', { ticketId: 'case-1' }, now)).acknowledged, 1)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM pignus_ticket_notifications').get().total, 2)
  } finally { f.db.close() }
})

test('los recordatorios SLA sólo avisan internamente al responsable y no se multiplican en cada ejecución', async () => {
  const f = fixture()
  try {
    for (const type of ['sla-overdue', 'response-overdue', 'no-update']) {
      const options = { ticket: emailTicket(), type, eventKey: `${type}:${now}`, actorId: '', mailRuntime: runtime }
      await f.communicate(options)
      await f.communicate(options)
    }
    assert.equal((await readNotifications(f.q, 'support-1')).length, 3)
    assert.equal((await readNotifications(f.q, 'operator-1')).length, 0)
    assert.equal(f.outbox().length, 0)
    assert.ok(f.entries().every(item => item.visibility === 'internal'))
  } finally { f.db.close() }
})

test('correo automático queda firmado y enlazado en la cola una sola vez; no envía directamente', async () => {
  const f = fixture()
  try {
    const source = { id: 'inbound-1', visibility: 'public', channel: 'email', messageId: '<source@example.com>' }
    const input = { ticket: emailTicket(), mailRuntime: runtime, entries: [source] }
    assert.equal((await f.communicate(input)).queued, true)
    assert.equal((await f.communicate(input)).created, false)
    const [out] = f.outbox(), [entry] = f.entries()
    assert.equal(out.status, 'queued')
    assert.equal(out.entry_id, entry.id)
    assert.equal(out.payload.automatic, true)
    assert.match(out.payload.text, /Gracias por tu disponibilidad\.\n\nSoporte Pignus/)
    assert.match(out.payload.html, /<b>Soporte Pignus<\/b>/)
    assert.equal(out.payload.inReplyTo, source.messageId)
    assert.deepEqual(out.payload.references, [source.messageId])
    assert.equal(out.payload.to, 'customer@example.com')
    assert.equal(entry.body, out.payload.text)
    assert.equal(entry.deliveryStatus, 'queued')
    assert.equal(out.created_at, now)
    assert.equal(f.outbox().length, 1)
  } finally { f.db.close() }
})

test('la entrega marca respuestas automáticas para evitar bucles y mantiene diferenciadas las respuestas humanas', async t => {
  const sent = [], nodemailer = require('nodemailer'), network = require('../api/_lib/ticket-mail-network.cjs')
  t.mock.method(network, 'resolveMailEndpoint', async () => ({ host: '8.8.8.8', port: 465, servername: 'smtp.example.com' }))
  t.mock.method(nodemailer, 'createTransport', () => ({ async sendMail(message) { sent.push(message); return { accepted: [message.to] } }, close() {} }))
  const smtp = require('../api/_lib/ticket-mail-worker.cjs').createSmtpAdapter({ ...runtime, smtpHost: 'smtp.example.com', smtpPort: 465 })
  try {
    for (const automatic of [true, false]) await smtp.send({ ticket_id: 'case-1', message_id: `<${automatic}@example.com>`, payload: { to: 'customer@example.com', subject: 'Consulta', text: 'Respuesta', automatic } })
    assert.equal(sent[0].headers['Auto-Submitted'], 'auto-replied')
    assert.equal(sent[0].headers['X-Auto-Response-Suppress'], 'All')
    assert.equal(sent[1].headers['Auto-Submitted'], undefined)
  } finally { smtp.close() }
})

test('los correos de prueba, buzones diferentes, notas manuales y casos a revisar nunca generan respuesta automática externa', async () => {
  const f = fixture()
  try {
    const variants = [
      { ticket: { ...emailTicket(), mailMode: 'test' } },
      { mailRuntime: { ...runtime, mode: 'test' } },
      { mailRuntime: { ...runtime, enabled: false } },
      { mailRuntime: { ...runtime, mailboxKey: 'other' } },
      { ticket: { ...emailTicket(), mailReviewRequired: true } },
      { ticket: { ...emailTicket(), origin: 'phone' } },
      { ticket: { ...emailTicket(), requesterEmail: runtime.address } },
      { ticket: { ...emailTicket(), autoReplySuppressed: true } }
    ]
    for (let index = 0; index < variants.length; index++) {
      const result = await f.communicate({ ticket: emailTicket(), mailRuntime: runtime, eventKey: `variant-${index}`, ...variants[index] })
      assert.equal(result.queued, false)
    }
    assert.equal(f.outbox().length, 0)
  } finally { f.db.close() }
})

test('el acuse de recepción exige un mensaje genuino y no responde a bots, rebotes ni al buzón propio', async () => {
  const f = fixture()
  try {
    const inbound = { sender: { email: 'customer@example.com' }, messageId: '<new@example.com>' }
    for (const [index, blocked] of [undefined, { ...inbound, automated: true }, { ...inbound, loop: true }, { ...inbound, bounce: true }, { ...inbound, mailReviewRequired: true }, { ...inbound, sender: { email: 'other@example.com' } }].entries()) {
      assert.equal((await f.communicate({ type: 'received', eventKey: `blocked-${index}`, ticket: emailTicket(), mailRuntime: runtime, inbound: blocked })).queued, false)
    }
    assert.equal((await f.communicate({ type: 'received', eventKey: 'mail-created', ticket: emailTicket(), mailRuntime: runtime, inbound })).queued, true)
    assert.equal(f.outbox().length, 1)
  } finally { f.db.close() }
})

test('un error de persistencia revierte el evento, el aviso y el correo dentro de la transacción llamante', async () => {
  const f = fixture()
  try {
    f.db.exec('BEGIN IMMEDIATE')
    const failingQ = async (sql, args) => { if (sql.startsWith('INSERT INTO pignus_ticket_mail_outbox')) throw new Error('fallo controlado'); return f.q(sql, args) }
    await assert.rejects(f.communicate({ q: failingQ, ticket: { ...emailTicket(), requesterId: 'operator-1' }, mailRuntime: runtime }), /fallo controlado/)
    f.db.exec('ROLLBACK')
    assert.equal(f.entries().length, 0)
    assert.equal(f.outbox().length, 0)
    assert.equal((await readNotifications(f.q, 'operator-1')).length, 0)
    assert.equal((await f.communicate({ ticket: emailTicket(), mailRuntime: runtime })).queued, true)
  } finally { f.db.close() }
})
