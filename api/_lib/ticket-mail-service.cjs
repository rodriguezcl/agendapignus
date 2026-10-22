const { timingSafeEqual, hkdfSync } = require('node:crypto')
const { can } = require('./permission-catalog.cjs')
const { safeMailError } = require('./ticket-mail.cjs')

const CHANNEL_LEASE = 'agentec-mail-channel-operation'
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }

function workerSecret(env = process.env) {
  const explicit = env.TICKETS_MAIL_WORKER_SECRET
  if (explicit !== undefined) return typeof explicit === 'string' && explicit.length >= 32 ? explicit : null
  const session = env.PIGNUS_SESSION_SECRET
  if (typeof session !== 'string' || session.length < 32) return null
  return Buffer.from(hkdfSync('sha256', session, '', 'agentec/tickets/mail-worker/v1', 32)).toString('hex')
}

function workerAuthorized(req, env = process.env) {
  const secret = workerSecret(env)
  if (!secret) return false
  const header = req.headers?.authorization
  if (typeof header !== 'string') return false
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function createMailService({ sql, db, ticketStore, env = process.env, runMail, testDependencies } = {}) {
  const channel = require('./ticket-mail-channel.cjs').createMailChannelStore({ sql, db, env })
  const stores = require('./ticket-mail-store.cjs')
  const mailStore = sql ? stores.postgresTicketMailStore(sql) : stores.sqliteTicketMailStore(db)
  const worker = runMail || require('./ticket-mail-worker.cjs').runTicketMail

  async function snapshot() {
    const result = await channel.get()
    try {
      const runtime = await channel.runtime()
      result.status = await mailStore.status(runtime.mailboxKey)
    } catch {
      result.status = { lastError: { message: 'Revisá las credenciales guardadas del correo.' } }
    }
    result.scheduler = await require('./ticket-mail-scheduler.cjs').schedulerStatus({ sql })
    return result
  }

  async function exclusive(operation) {
    await ticketStore.ensure()
    // El mismo bloqueo cubre el formulario, el proceso manual y el scheduler.
    const owner = await mailStore.acquireMailbox(CHANNEL_LEASE, 180000)
    if (!owner) fail('Hay una operación de correo en curso. Esperá unos segundos y volvé a intentar.', 409)
    try { return await operation() } finally { await mailStore.releaseMailbox(CHANNEL_LEASE, owner) }
  }

  async function process({ manual = false, confirmSend = false, maxRunMs = 20000 } = {}) {
    return exclusive(async () => {
      const config = await channel.runtime()
      if (manual && config.enabled && config.mode === 'live' && !confirmSend) fail('Confirmá la recepción y el envío de las respuestas pendientes antes de sincronizar.', 409)
      try {
        return await worker({ config: { ...config, maxRunMs: Math.min(config.maxRunMs, maxRunMs) }, mailStore, ticketStore })
      } catch (problem) {
        const safe = safeMailError(problem)
        throw Object.assign(new Error(safe.message), { statusCode: 502, code: safe.code })
      }
    })
  }

  async function request({ method, input = {}, user, state }) {
    if (!can(user, 'tickets.configure')) fail('No tenés permiso para configurar el correo de Tickets.', 403)
    if (!['GET', 'POST'].includes(method)) fail('Método no permitido.', 405)
    await ticketStore.ensure()
    if (method === 'GET') return snapshot()
    if (input.action === 'run') {
      const result = await process({ manual: true, confirmSend: input.confirmSend === true })
      return { ...await snapshot(), result }
    }
    return exclusive(async () => {
      switch (input.action) {
        case 'save': {
          const metadata = await ticketStore.query(user, state, { mode: 'metadata' })
          await channel.save(input, user, { areas: metadata.config.areas })
          break
        }
        case 'test': await channel.test(input, { ...testDependencies, user }); break
        case 'activate': {
          const metadata = await ticketStore.query(user, state, { mode: 'metadata' })
          await channel.activate(input, user, { areas: metadata.config.areas })
          break
        }
        case 'disable': await channel.disable(input, user); break
        default: fail('Operación de correo no válida.')
      }
      return snapshot()
    })
  }
  return { request, process, snapshot }
}

module.exports = { createMailService, workerSecret, workerAuthorized, CHANNEL_LEASE }
