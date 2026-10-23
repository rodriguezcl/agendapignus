const { createHash } = require('node:crypto')
const { emailAddress, messageIds, prepareTicketReply, outboxOperation } = require('./ticket-mail.cjs')

const NOTIFICATION_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS pignus_ticket_notifications (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id), recipient_id TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, data TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pignus_ticket_notifications_recipient ON pignus_ticket_notifications (recipient_id,read_at,created_at)',
  'CREATE INDEX IF NOT EXISTS pignus_ticket_notifications_ticket ON pignus_ticket_notifications (ticket_id,recipient_id)'
]
const REMINDERS = new Set(['sla-overdue', 'response-overdue', 'no-update'])
const LABELS = {
  received: 'Recibimos tu solicitud', scheduled: 'Servicio programado', rescheduled: 'Visita reprogramada',
  canceled: 'Visita cancelada', resolved: 'Caso resuelto', reopened: 'Caso nuevamente en gestión',
  waiting: 'Caso en espera', 'sla-overdue': 'Plazo de resolución vencido',
  'response-overdue': 'Primera respuesta pendiente', 'no-update': 'Actualización del caso pendiente'
}
const plain = (value, limit = 200) => String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const system = { id: 'agentec-automation', name: 'Equipo de soporte · Agentec' }

function notificationTitle(ticket, label, state = {}) {
  const current = ticket.customerId && (state.customers || []).find(customer => String(customer.customerId || customer.id) === String(ticket.customerId))
  const customer = current || ticket.customerSnapshot
  const account = plain(customer?.account, 30)
  let name = plain(customer?.name, 80)
  if (account && name.toLowerCase().startsWith(account.toLowerCase() + ' ')) name = name.slice(account.length).trim()
  let identity = [account, name].filter(Boolean).join(' · ')
  if (!identity) {
    // El nombre permite reconocer al solicitante sin exponer direcciones de correo.
    const named = [{ name: ticket.requesterName, label: ticket.origin === 'email' ? 'Remitente' : 'Solicitante' }, { name: ticket.createdByName, label: 'Creado por' }]
      .map(item => ({ ...item, name: plain(item.name, 80) }))
      .find(item => item.name && !item.name.includes('@') && !['usuario', 'correo', 'email'].includes(item.name.toLowerCase()))
    identity = named ? `${named.label}: ${named.name}` : ticket.origin === 'email' ? 'Solicitud por correo' : 'Solicitud sin cuenta'
  }
  return [identity, `Ticket#${plain(ticket.number, 30)}`, plain(label, 100)].filter(Boolean).join(' · ')
}

function scheduledDate(context = {}) {
  const service = context.service || context
  const date = plain(service.date || context.date, 10), time = plain(service.time || service.startTime || context.time, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return ''
  const parsed = new Date(`${date}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return ''
  return `${new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parsed)} a las ${time} h`
}

function eventContent(type, ticket, context = {}, channel = 'platform') {
  if (!LABELS[type]) throw new Error('Tipo de comunicación de Tickets no válido.')
  const name = plain(ticket.requesterName, 80), greeting = name && !name.includes('@') ? `Hola, ${name}.` : 'Hola.'
  const number = `Ticket#${plain(ticket.number, 30)}`, appointment = scheduledDate(context)
  const returnAction = channel === 'email' ? 'responder este correo' : 'agregar una observación al ticket'
  let body
  switch (type) {
    case 'received': body = `${greeting} Gracias por contarnos lo que está pasando. Registramos tu solicitud como ${number}. Nuestro equipo revisará el caso y te mantendremos informado de los avances.`; break
    case 'scheduled': body = `${greeting} ${appointment ? `Registramos una visita para el ${appointment}` : 'Registramos una visita en la agenda'} para atender tu reclamo. Seguiremos el caso hasta conocer el resultado. Gracias por tu disponibilidad.`; break
    case 'rescheduled': body = `${greeting} La visita de tu ${number} fue reprogramada${appointment ? ` para el ${appointment}` : ''}. Tu caso sigue abierto y te mantendremos informado de los avances. Gracias por tu paciencia y disponibilidad.`; break
    case 'canceled': body = `${greeting} La visita asociada a tu ${number} fue cancelada. Tu caso sigue abierto para revisar el próximo paso; te avisaremos cuando se registre una nueva coordinación. Gracias por tu paciencia.`; break
    case 'resolved': body = `${greeting} ${context.sourceTechnical === true ? 'El equipo técnico confirmó que el inconveniente fue resuelto y dejamos registrado el trabajo realizado.' : `Registramos la resolución de tu ${number}.`} Gracias por avisarnos y por acompañarnos durante la gestión. Si el problema continúa, podés ${returnAction} para que retomemos el caso.`; break
    case 'reopened': body = `${greeting} Gracias por la nueva información. Tu ${number} vuelve a estar en gestión para revisar lo que nos indicás. Te mantendremos informado de los avances.`; break
    case 'waiting': {
      // Sólo texto explícitamente público: jamás copiar notas internas, diagnóstico o motivos privados.
      const reason = plain(context.publicReason, 500), next = plain(context.publicNextStep, 500)
      body = `${greeting} Tu caso sigue abierto.${reason ? ` Estamos pendientes de ${reason}.` : ' Quedó en espera de una próxima gestión.'}${next ? ` El próximo paso es ${next}.` : ''} Gracias por la paciencia; te avisaremos cuando se registre una novedad.`
      break
    }
    case 'sla-overdue': body = `${number} superó el plazo de resolución configurado. Revisá el impedimento, definí el próximo paso y compartí una actualización concreta con quien informó el caso.`; break
    case 'response-overdue': body = `${number} sigue sin una primera respuesta dentro del plazo configurado. Revisá la solicitud, confirmá su recepción con una respuesta útil e indicá el próximo paso.`; break
    case 'no-update': body = `${number} necesita una actualización. Revisá su estado y comunicá qué falta o cuál es el próximo paso. Aunque la solución siga pendiente, una respuesta concreta ayuda a que la persona se sienta escuchada.`; break
  }
  return { title: `${number} · ${LABELS[type]}`, body, tone: REMINDERS.has(type) ? 'warning' : type === 'resolved' ? 'success' : 'info' }
}

function canAutomaticallyEmail(ticket, runtime, type, inbound) {
  if (REMINDERS.has(type) || ticket.origin !== 'email' || ticket.mailMode !== 'live' || !ticket.mailboxKey ||
      ticket.mailReviewRequired || ticket.autoReplySuppressed || !runtime?.enabled || runtime.mode !== 'live' ||
      runtime.mailboxKey !== ticket.mailboxKey) return false
  const recipient = emailAddress(ticket.requesterEmail)
  if (!recipient || recipient === emailAddress(runtime.address)) return false
  if (type === 'received') {
    if (!inbound || inbound.automated || inbound.loop || inbound.bounce || inbound.mailReviewRequired || inbound.reviewRequired ||
        emailAddress(inbound.sender?.email) !== recipient || !messageIds(inbound.messageId).length) return false
  }
  return true
}

/** Invocar con la misma transacción que guarda el cambio del caso. eventKey identifica el hecho, no cada reintento. */
async function communicateTicket({ q, ticket, type, eventKey, now = new Date().toISOString(), actorId = '', recipients,
  context = {}, mailRuntime, entries = [], inbound } = {}) {
  if (typeof q !== 'function' || !ticket?.id || !String(eventKey || '').trim()) throw new Error('La comunicación requiere ticket, transacción y clave del evento.')
  const reminder = REMINDERS.has(type), key = hash(ticket.id, type, String(eventKey)), entryId = `automatic:${key}`
  const content = eventContent(type, ticket, context)
  const humanInitiated = Boolean(actorId && !['email', system.id].includes(String(actorId)) && ['scheduled', 'rescheduled', 'canceled', 'resolved', 'waiting'].includes(type))
  const entry = { id: entryId, ticketId: ticket.id, sourceTicketId: ticket.id, sourceTicketNumber: ticket.number,
    kind: 'event', action: `automatic-${type}`, automatic: true, body: content.body, note: content.body,
    humanInitiated, triggeredById: humanInitiated ? String(actorId) : '', slaCycle: ticket.sla?.cycle || 1,
    byId: system.id, byName: system.name, at: now, channel: 'internal', visibility: reminder ? 'internal' : 'public' }
  const inserted = await q('INSERT INTO pignus_ticket_entries (id,ticket_id,at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id', [entryId, ticket.id, now, JSON.stringify(entry)])
  if (!inserted.length) return { created: false, notifications: 0, queued: false }
  const recipientsToNotify = [...new Set((recipients || (reminder ? [ticket.assigneeId] : [ticket.createdById, ticket.requesterId]))
    .map(value => String(value || '')).filter(value => value && value !== String(actorId) && !['email', system.id].includes(value)))]
  for (const recipient of recipientsToNotify) {
    const id = `ticket-notice:${hash(key, recipient)}`
    const notification = { id, notificationId: id, title: notificationTitle(ticket, LABELS[type]), eventLabel: LABELS[type], detail: content.body, tone: content.tone, createdAt: now,
      target: { type: 'ticket', ticketId: ticket.id, notificationId: id } }
    await q('INSERT INTO pignus_ticket_notifications (id,ticket_id,recipient_id,created_at,read_at,data) VALUES (?,?,?,?,NULL,?) ON CONFLICT(id) DO NOTHING', [id, ticket.id, recipient, now, JSON.stringify(notification)])
  }
  let queued = false
  if (canAutomaticallyEmail(ticket, mailRuntime, type, inbound)) {
    const prepared = prepareTicketReply({ ...ticket, entries }, { text: eventContent(type, ticket, context, 'email').body }, system, mailRuntime)
    // Un único evento es también el comprobante de la cola; no duplicar la conversación ni registrar el acuse como respuesta humana.
    const automaticOutbox = { ...prepared.outbox, entryId, createdAt: now, nextAttemptAt: now,
      payload: { ...prepared.outbox.payload, automatic: true } }
    Object.assign(entry, { body: prepared.entry.text, note: prepared.entry.text, channel: 'email', deliveryStatus: 'queued', messageId: prepared.entry.messageId, to: prepared.entry.to })
    await q('UPDATE pignus_ticket_entries SET data=? WHERE id=?', [JSON.stringify(entry), entryId])
    const operation = outboxOperation(automaticOutbox)
    await q(operation.sql, operation.params)
    queued = true
  }
  return { created: true, notifications: recipientsToNotify.length, queued, entryId }
}

async function readNotifications(q, recipientId, { limit = 50 } = {}) {
  if (!recipientId) return []
  const rows = await q('SELECT data FROM pignus_ticket_notifications WHERE recipient_id=? AND read_at IS NULL ORDER BY created_at DESC,id DESC LIMIT ?', [String(recipientId), Math.max(1, Math.min(100, Number(limit) || 50))])
  return rows.map(row => JSON.parse(row.data))
}

async function acknowledgeNotifications(q, recipientId, { ids, ticketId } = {}, now = new Date().toISOString()) {
  if (!recipientId || (!ticketId && !Array.isArray(ids))) return { acknowledged: 0 }
  const values = [...new Set((ids || []).filter(value => typeof value === 'string' && value.length <= 150))].slice(0, 100)
  if (!ticketId && !values.length) return { acknowledged: 0 }
  const args = [now, String(recipientId)], where = ['recipient_id=?', 'read_at IS NULL']
  if (ticketId) { where.push('ticket_id=?'); args.push(String(ticketId)) }
  if (values.length) { where.push(`id IN (${values.map(() => '?').join(',')})`); args.push(...values) }
  const rows = await q(`UPDATE pignus_ticket_notifications SET read_at=? WHERE ${where.join(' AND ')} RETURNING id`, args)
  return { acknowledged: rows.length }
}

module.exports = { NOTIFICATION_SCHEMA, REMINDERS, notificationTitle, eventContent, scheduledDate, canAutomaticallyEmail, communicateTicket, readNotifications, acknowledgeNotifications }
