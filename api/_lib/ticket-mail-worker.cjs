const { parseTicketMail, safeMailError, classifyDeliveryError, emailAddress, messageIds } = require('./ticket-mail.cjs')
const { validateAttachments } = require('./tickets-attachments.cjs')

function createImapAdapter(config) {
  const { ImapFlow } = require('imapflow')
  let client
  return {
    async connect() {
      const endpoint = await require('./ticket-mail-network.cjs').resolveMailEndpoint('imap', config.imapHost, config.imapPort)
      client = new ImapFlow({ host: endpoint.host, port: endpoint.port, servername: endpoint.servername,
        secure: config.imapSecurity !== 'starttls', doSTARTTLS: config.imapSecurity === 'starttls',
        auth: { user: config.user, pass: config.password }, logger: false, disableAutoIdle: true,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        tls: { servername: endpoint.servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
      client.on('error', () => {})
      await client.connect(); await client.mailboxOpen(config.mailbox, { readOnly: true })
    },
    snapshot() { return { uidValidity: String(client.mailbox.uidValidity), uidNext: Number(client.mailbox.uidNext) } },
    async metadata(start, end) { return client.fetchAll(`${start}:${end}`, { uid: true, size: true, envelope: true }, { uid: true }) },
    async read(uid, limit) {
      const download = await client.download(String(uid), undefined, { uid: true, maxBytes: limit + 1 })
      const chunks = []; let size = 0
      for await (const chunk of download.content) {
        size += chunk.length
        if (size > limit) { download.content.destroy(); throw Object.assign(new Error('Mensaje demasiado grande.'), { code: 'MAIL_TOO_LARGE' }) }
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    },
    async close() { if (client) { try { await client.logout() } catch { client.close() } } }
  }
}

function createSmtpAdapter(config) {
  const nodemailer = require('nodemailer')
  let transport
  return {
    async send(row) {
      if (!transport) {
        const endpoint = await require('./ticket-mail-network.cjs').resolveMailEndpoint('smtp', config.smtpHost, config.smtpPort)
        transport = nodemailer.createTransport({ host: endpoint.host, port: endpoint.port,
          secure: config.smtpSecurity !== 'starttls', requireTLS: config.smtpSecurity === 'starttls',
          auth: { user: config.smtpUser || config.user, pass: config.smtpPassword || config.password },
          connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
          tls: { servername: endpoint.servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
          disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false })
      }
      const payload = row.payload
      const attachments = validateAttachments(payload.attachments || []).map(file => ({ filename: file.fileName, content: Buffer.from(file.data, 'base64'), contentType: file.mimeType }))
      return transport.sendMail({ from: { name: config.senderName || 'Tickets · Agentec', address: config.address }, to: payload.to,
        envelope: { from: config.address, to: [payload.to] }, subject: payload.subject, text: payload.text,
        messageId: row.message_id, inReplyTo: payload.inReplyTo || undefined, references: payload.references || [], attachments,
        headers: { 'X-Agentec-Ticket': row.ticket_id, 'X-Auto-Response-Suppress': 'All' },
        disableFileAccess: true, disableUrlAccess: true })
    },
    close() { transport?.close() }
  }
}

async function applyResults(mailStore, ticketStore, key) {
  for (const result of await mailStore.unapplied(key)) {
    await ticketStore.applyDelivery(result)
    await mailStore.applied(result.id, result.status, result.attempts)
  }
}

async function processOutbox({ config, mailStore, ticketStore, smtpFactory, deadline, now }) {
  if (!config.enabled || config.mode !== 'live') return { sent: 0, uncertain: 0, failed: 0, retried: 0 }
  await mailStore.recoverUncertain(config.mailboxKey, new Date(now() - 10 * 60_000).toISOString())
  await applyResults(mailStore, ticketStore, config.mailboxKey)
  const counts = { sent: 0, uncertain: 0, failed: 0, retried: 0 }
  let smtp
  try {
    for (let index = 0; index < config.batchSize && now() < deadline; index++) {
      const row = await mailStore.claim(config.mailboxKey)
      if (!row) break
      let status = 'sent', failure = null
      try {
        if (!emailAddress(row.payload.to) || row.payload.to === config.address) throw Object.assign(new Error('Destinatario inválido.'), { code: 'EENVELOPE' })
        smtp ||= smtpFactory(config)
        const result = await smtp.send(row)
        if (!(result?.accepted || []).some(address => emailAddress(typeof address === 'string' ? address : address.address) === emailAddress(row.payload.to))) {
          status = (result?.rejected || []).length ? 'failed' : 'uncertain'
          failure = safeMailError({ code: status === 'uncertain' ? 'MAIL_SEND_UNCERTAIN' : 'MAIL_REJECTED' })
        }
      } catch (problem) {
        status = classifyDeliveryError(problem)
        if (status === 'retry' && Number(row.attempts) >= 5) status = 'failed'
        failure = safeMailError(status === 'uncertain' ? { code: 'MAIL_SEND_UNCERTAIN' } : problem)
      }
      const retryAt = new Date(now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(5, Number(row.attempts)))).toISOString()
      // Si persistir falla, queda 'sending'; la recuperación lo marca incierto, nunca reenvía a ciegas.
      await mailStore.finish(row.id, status, failure, retryAt)
      counts[status === 'retry' ? 'retried' : status]++
      await applyResults(mailStore, ticketStore, config.mailboxKey)
    }
  } finally { smtp?.close?.() }
  return counts
}

async function runTicketMail({ config, mailStore, ticketStore, imapFactory = createImapAdapter, smtpFactory = createSmtpAdapter, now = Date.now }) {
  if (!config.enabled) return { enabled: false, mode: config.mode, received: 0, sent: 0 }
  if (config.mode === 'test' && !config.testSourceConfirmed) throw Object.assign(new Error('Confirmá la fuente de prueba.'), { code: 'MAIL_TEST_SOURCE_REQUIRED' })
  await ticketStore.ensure()
  await mailStore.ensure()
  const start = now(), deadline = start + config.maxRunMs
  const owner = await mailStore.acquireMailbox(config.mailboxKey, config.maxRunMs + 90_000)
  if (!owner) return { enabled: true, mode: config.mode, busy: true }
  let imap
  const summary = { enabled: true, mode: config.mode, activated: false, received: 0, duplicates: 0, skipped: 0 }
  try {
    imap = imapFactory(config)
    await imap.connect()
    const snapshot = imap.snapshot()
    if (!snapshot.uidValidity || !Number.isSafeInteger(snapshot.uidNext) || snapshot.uidNext < 1) throw Object.assign(new Error('El buzón no ofrece un cursor válido.'), { code: 'MAIL_INVALID_CURSOR' })
    let cursor = await mailStore.cursor(config.mailboxKey)
    if (!cursor.uid_validity) {
      cursor = await mailStore.activate(config.mailboxKey, owner, snapshot)
      summary.activated = true
    }
    if (String(cursor.uid_validity) !== String(snapshot.uidValidity)) throw Object.assign(new Error('Cambió UIDVALIDITY.'), { code: 'MAIL_UIDVALIDITY_CHANGED' })
    const first = Number(cursor.last_uid) + 1, last = Math.min(Number(snapshot.uidNext) - 1, first + config.batchSize - 1)
    if (first <= last) {
      const messages = (await imap.metadata(first, last)).filter(item => item.uid >= first && item.uid <= last).sort((a, b) => a.uid - b.uid)
      let complete = true
      for (const item of messages) {
        if (now() >= deadline) { complete = false; break }
        let message
        try {
        if (Number(item.size) > config.maxMessageBytes) throw Object.assign(new Error('Mensaje demasiado grande.'), { code: 'MAIL_TOO_LARGE' })
        const source = await imap.read(item.uid, config.maxMessageBytes)
        message = await parseTicketMail(source, { ownAddress: config.address, maxMessageBytes: config.maxMessageBytes })
        } catch(problem) {
          if(!['MAIL_TOO_LARGE','MAIL_INVALID_SENDER','MAIL_INVALID_CONTENT','MAIL_ATTACHMENT_REVIEW'].includes(problem.code))throw problem
          const sender=item.envelope?.from?.[0]||{}
          message={messageId:messageIds(item.envelope?.messageId)[0]||`<review-${config.mailboxKey}-${snapshot.uidValidity}-${item.uid}@agentec.invalid>`,sender:{name:sender.name||'Correo a revisar',email:emailAddress(sender.address)},subject:item.envelope?.subject||'Correo que requiere revisión',text:`${safeMailError(problem).message}\nRevisar el correo original en la carpeta configurada (UID ${item.uid}). No se eliminó ni modificó el mensaje.`,attachments:[],references:[],mailReviewRequired:true,reviewCode:problem.code}
        }
        if (message.loop || message.bounce || message.automated) {
          await mailStore.skip(config.mailboxKey, snapshot.uidValidity, item.uid, message.loop ? 'loop' : message.bounce ? 'bounce' : 'automated')
          summary.skipped++
        } else {
          const result = await ticketStore.ingestMail({ ...message, areaId: config.areaId, mailboxKey: config.mailboxKey, uidValidity: String(snapshot.uidValidity), uid: item.uid, mode: config.mode })
          if (result.duplicate) summary.duplicates++; else summary.received++
        }
        // Persistimos después del ticket: ante una interrupción ingestMail se puede repetir sin duplicar.
        await mailStore.advance(config.mailboxKey, owner, item.uid)
      }
      if (complete) await mailStore.advance(config.mailboxKey, owner, last)
    }
    await imap.close(); imap = null
    Object.assign(summary, await processOutbox({ config, mailStore, ticketStore, smtpFactory, deadline, now }))
    await mailStore.success(config.mailboxKey, owner)
    return summary
  } catch (problem) {
    await mailStore.failure(config.mailboxKey, owner, safeMailError(problem))
    throw problem
  } finally {
    if (imap) await imap.close()
    await mailStore.releaseMailbox(config.mailboxKey, owner)
  }
}

module.exports = { createImapAdapter, createSmtpAdapter, applyResults, processOutbox, runTicketMail }
