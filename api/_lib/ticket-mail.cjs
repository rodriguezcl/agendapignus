const { createHash, randomUUID } = require('node:crypto')
const { validateAttachments } = require('./tickets-attachments.cjs')

const MAX_MESSAGE_BYTES = 15_000_000
const MAX_TEXT_LENGTH = 40_000
const error = (message, code = 'MAIL_CONFIGURATION', statusCode = 400) => Object.assign(new Error(message), { code, statusCode })
const line = value => String(value || '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim()
const emailAddress = value => {
  const text = String(value || '').trim().toLowerCase()
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(text) && text.length <= 254 ? text : ''
}
const messageIds = value => (Array.isArray(value) ? value : [value]).flatMap(item => String(item || '').match(/<[^<>\s\x00-\x1f]{1,250}>/g) || []).slice(-40)
const boundedInteger = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.parseInt(value, 10) || fallback))

function ticketMailConfig(env = process.env) {
  const enabled = env.TICKETS_MAIL_ENABLED === 'true'
  const mode = env.TICKETS_MAIL_MODE || 'test'
  if (!['test', 'live'].includes(mode)) throw error('TICKETS_MAIL_MODE debe ser test o live.')
  const config = {
    enabled, mode, mailbox: line(env.TICKETS_MAIL_FOLDER || 'INBOX'),
    address: emailAddress(env.TICKETS_MAIL_ADDRESS),
    user: String(env.TICKETS_MAIL_USER || ''), password: String(env.TICKETS_MAIL_PASSWORD || ''),
    imapHost: line(env.TICKETS_MAIL_IMAP_HOST || 'imap.secureserver.net'), imapPort: 993,
    smtpHost: line(env.TICKETS_MAIL_SMTP_HOST || 'smtpout.secureserver.net'), smtpPort: 465,
    batchSize: boundedInteger(env.TICKETS_MAIL_BATCH_SIZE, 25, 1, 100),
    maxRunMs: boundedInteger(env.TICKETS_MAIL_MAX_RUN_MS, 45000, 5000, 300000),
    maxMessageBytes: boundedInteger(env.TICKETS_MAIL_MAX_MESSAGE_BYTES, MAX_MESSAGE_BYTES, 1000, MAX_MESSAGE_BYTES),
    testSourceConfirmed: env.TICKETS_MAIL_TEST_SOURCE_CONFIRMED === 'true'
  }
  config.mailboxKey = createHash('sha256').update([config.imapHost, config.address, config.mailbox, config.mode].join('\n')).digest('hex')
  if (enabled && (!config.address || !config.user || !config.password)) throw error('Faltan los datos de acceso del buzón de Tickets.', 'MAIL_MISSING_CREDENTIALS')
  if (enabled && mode === 'test' && !config.testSourceConfirmed) throw error('Confirmá el buzón o carpeta de prueba mediante TICKETS_MAIL_TEST_SOURCE_CONFIRMED=true.', 'MAIL_TEST_SOURCE_REQUIRED')
  return config
}

function safeMailError(failure) {
  const messages = {
    MAIL_UIDVALIDITY_CHANGED: 'El buzón cambió sus identificadores. Revisá el punto de activación antes de reanudar.',
    MAIL_TOO_LARGE: 'Un mensaje excede el tamaño admitido; requiere revisión en el buzón.',
    MAIL_INVALID_SENDER: 'Un mensaje no tiene un remitente válido; requiere revisión en el buzón.',
    MAIL_INVALID_CONTENT: 'No se pudo interpretar un mensaje; requiere revisión en el buzón.',
    MAIL_ATTACHMENT_REVIEW: 'Un mensaje contiene adjuntos no admitidos o demasiado grandes. Se conserva en el buzón y requiere revisión.',
    MAIL_SEND_UNCERTAIN: 'El servidor no confirmó el resultado del envío. Revisá el buzón antes de reintentar.',
    EAUTH: 'No se pudo autenticar el acceso al correo.',
    ETIMEDOUT: 'Se agotó el tiempo de conexión con el correo.',
    ECONNECTION: 'No se pudo establecer la conexión con el correo.',
    ESOCKET: 'Se interrumpió la conexión con el correo.'
  }
  return { code: line(failure?.code || 'MAIL_UNAVAILABLE').slice(0, 80), message: messages[failure?.code] || 'No se pudo completar la operación de correo. Revisá la conexión y la configuración.' }
}

function headerValue(parsed, key) {
  const value = parsed.headers?.get?.(key)
  return typeof value === 'object' && value ? value.value || '' : String(value || '')
}

function normalizedMail(parsed, { source, ownAddress, now = new Date().toISOString() } = {}) {
  const from = parsed.from?.value || []
  if (from.length !== 1 || !emailAddress(from[0]?.address)) throw error('El mensaje no tiene un remitente único válido.', 'MAIL_INVALID_SENDER')
  const sender = { email: emailAddress(from[0].address), name: line(from[0].name).slice(0, 200) }
  const recipients = [...(parsed.to?.value || []), ...(parsed.cc?.value || [])].map(item => emailAddress(item.address)).filter(Boolean)
  const subject = line(parsed.subject || '(Sin asunto)').slice(0, 300)
  const contentType = line(headerValue(parsed, 'content-type')).toLowerCase()
  const autoSubmitted = line(headerValue(parsed, 'auto-submitted')).toLowerCase()
  const returnPath = headerValue(parsed, 'return-path')
  const returnPathAddresses = parsed.headers?.get?.('return-path')?.value
  const returnPathEmpty = returnPath === '<>' || (Array.isArray(returnPathAddresses) && returnPathAddresses.every(address => !address.address))
  const loop = sender.email === emailAddress(ownAddress) || Boolean(headerValue(parsed, 'x-agentec-ticket'))
  const automated = (Boolean(autoSubmitted) && autoSubmitted !== 'no') || /^(bulk|list|junk)$/i.test(headerValue(parsed, 'precedence')) || Boolean(headerValue(parsed, 'list-id'))
  const bounce = contentType.includes('multipart/report') || returnPathEmpty || /^(mailer-daemon|postmaster)@/i.test(sender.email)
  let attachments = []
  if (!loop && !automated && !bounce) {
    try {
      attachments = validateAttachments((parsed.attachments || []).map((attachment, index) => ({
        fileName: line(attachment.filename || `Adjunto ${index + 1}`).replace(/[/\\]/g, '_').slice(0, 160),
        mimeType: attachment.contentType,
        data: (Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content || '')).toString('base64')
      }))).map(file => ({ id: file.id, name: file.fileName, mime: file.mimeType, bytes: file.byteSize, data: Buffer.from(file.data, 'base64') }))
    } catch { throw error('Los adjuntos requieren revisión antes de incorporar el mensaje.', 'MAIL_ATTACHMENT_REVIEW') }
  }
  // Mailparser genera texto desde HTML. Nunca almacenamos HTML activo ni cargamos recursos remotos.
  const text = String(parsed.text || '').replace(/\x00/g, '').slice(0, MAX_TEXT_LENGTH).trim()
  const date = new Date(parsed.date || now)
  return {
    messageId: messageIds(parsed.messageId)[0] || `<sha256-${createHash('sha256').update(source || JSON.stringify([sender, subject, text, now])).digest('hex')}@agentec.invalid>`,
    inReplyTo: messageIds(parsed.inReplyTo).at(-1) || '', references: messageIds(parsed.references),
    sender, recipients: [...new Set(recipients)], subject, text: text || '(Mensaje sin texto)',
    receivedAt: Number.isNaN(date.getTime()) ? now : date.toISOString(),
    headerTicketNumbers: [...new Set([...subject.matchAll(/\bTicket#\s*(\d{1,30})\b/gi)].map(match => match[1]))],
    attachments, rejectedAttachments: [], automated, bounce, loop,
    textTruncated: String(parsed.text || '').length > MAX_TEXT_LENGTH
  }
}

async function parseTicketMail(source, options = {}) {
  const data = Buffer.isBuffer(source) ? source : Buffer.from(source || '')
  if (data.length > (options.maxMessageBytes || MAX_MESSAGE_BYTES)) throw error('El mensaje excede el límite de tamaño.', 'MAIL_TOO_LARGE')
  const { simpleParser } = require('mailparser')
  let parsed
  try {
    parsed = await simpleParser(data, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true, skipTextLinks: true, maxHtmlLengthToParse: MAX_MESSAGE_BYTES, keepDeliveryStatus: true })
  } catch { throw error('No se pudo interpretar el correo.', 'MAIL_INVALID_CONTENT') }
  return normalizedMail(parsed, { ...options, source: data })
}

function ticketParticipantEmails(ticket) {
  return [...new Set([ticket.requesterEmail, ticket.requester?.email, ...(ticket.externalParticipants || []).map(item => typeof item === 'string' ? item : item?.email)].map(emailAddress).filter(Boolean))]
}

function prepareTicketReply(ticket, input, user, env = process.env) {
  const config = ticketMailConfig(env)
  if(ticket.mailMode==='test')throw error('Los tickets de prueba no pueden enviar respuestas al cliente.', 'MAIL_TEST_NO_SEND',409)
  if (!config.enabled) throw error('El correo de Tickets todavía no está habilitado.', 'MAIL_DISABLED', 409)
  if (config.mode !== 'live') throw error('El modo de prueba no permite enviar correos. Podés registrar una nota interna.', 'MAIL_TEST_NO_SEND', 409)
  const text = String(input?.text || input?.body || input?.note || '').trim()
  if (!text || text.length > MAX_TEXT_LENGTH) throw error('La respuesta debe contener entre 1 y 40000 caracteres.', 'MAIL_INVALID_REPLY')
  const allowed = ticketParticipantEmails(ticket)
  const to = emailAddress(input?.to || ticket.requesterEmail || ticket.requester?.email)
  if (!to || !allowed.includes(to) || to === config.address) throw error('Seleccioná un destinatario externo vinculado al ticket.', 'MAIL_RECIPIENT_FORBIDDEN', 403)
  const now = new Date().toISOString(), id = randomUUID(), entryId = randomUUID()
  const messageId = `<agentec-${id}@${config.address.split('@')[1]}>`
  const previous = (ticket.entries || ticket.messages || []).filter(entry => entry.messageId && (entry.visibility === 'public' || entry.channel === 'email' || entry.kind === 'email_inbound' || entry.kind === 'email_outbound'))
  const last = previous.at(-1)
  const inReplyTo = messageIds(input?.inReplyTo && previous.some(entry => entry.messageId === input.inReplyTo) ? input.inReplyTo : last?.messageId).at(-1) || ''
  const references = messageIds(previous.map(entry => entry.messageId)).slice(-20)
  // Los adjuntos de respuesta deben ser validados por el mismo helper del endpoint.
  const attachments = validateAttachments(input?.attachments || [])
  const payload = { to, subject: `${line(ticket.title).replace(/\s*\[Ticket#\d+\]/gi, '').slice(0, 250)} [Ticket#${String(ticket.number)}]`, text, inReplyTo, references, attachments }
  return {
    entry: { id: entryId, kind: 'email_outbound', text, createdAt: now, authorId: String(user.id), authorName: String(user.name || ''), visibility: 'public', deliveryStatus: 'queued', messageId, to },
    outbox: { id, ticketId: String(ticket.id), entryId, mailboxKey: config.mailboxKey, status: 'queued', attempts: 0, messageId, payload, createdAt: now, nextAttemptAt: now }
  }
}

function outboxOperation(outbox) {
  return { sql: 'INSERT INTO pignus_ticket_mail_outbox (id,ticket_id,entry_id,mailbox_key,status,attempts,message_id,payload,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?)', params: [outbox.id, outbox.ticketId, outbox.entryId, outbox.mailboxKey, outbox.status, outbox.attempts, outbox.messageId, JSON.stringify(outbox.payload), outbox.createdAt, outbox.nextAttemptAt] }
}

function classifyDeliveryError(failure) {
  if (failure?.responseCode >= 500) return 'failed'
  if (failure?.responseCode >= 400 && failure.responseCode < 500) return 'retry'
  if (['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(failure?.code)) return 'failed'
  // Sólo reintentar cuando SMTP no pudo recibir el cuerpo. Un timeout luego de DATA puede haber entregado.
  if (['CONN', 'EHLO', 'HELO', 'AUTH', 'STARTTLS', 'MAIL FROM', 'RCPT TO'].includes(failure?.command)) return 'retry'
  return 'uncertain'
}

module.exports = { MAX_MESSAGE_BYTES, MAX_TEXT_LENGTH, ticketMailConfig, safeMailError, emailAddress, messageIds, normalizedMail, parseTicketMail, ticketParticipantEmails, prepareTicketReply, outboxOperation, classifyDeliveryError }
