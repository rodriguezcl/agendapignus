const notice = require('./appointment-notice.cjs')
const experience = require('./experience-whatsapp.cjs')
const delivery = require('./appointment-delivery.cjs')
const { channelFor } = require('./installation-communications.cjs')
const { createHmac, timingSafeEqual } = require('node:crypto')
const { sqlParameters } = require('./ticket-mail-store.cjs')
const TABLE = 'pignus_appointment_whatsapp'

function configuration(env = process.env, kind = 'appointment', installationType = 'alarm') {
  const postSale = kind === 'experience'
  const cameras = channelFor(installationType) === 'cameras'
  const prefix = cameras ? `PIGNUS_GHL_CAMERAS${postSale ? '_EXPERIENCE' : ''}` : `PIGNUS_GHL${postSale ? '_EXPERIENCE' : ''}`
  let url = ''
  try {
    const parsed = new URL(env[`${prefix}_WEBHOOK_URL`] || '')
    if (parsed.protocol === 'https:' && parsed.hostname === 'services.leadconnectorhq.com' && !parsed.port && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && /^\/hooks\/[A-Za-z0-9]+\/webhook-trigger\/[A-Za-z0-9-]+$/.test(parsed.pathname)) url = parsed.href
  } catch { /* A malformed endpoint never reaches fetch or logs. */ }
  // A post-sale event must never run the appointment-confirmation workflow.
  if (postSale && url === env[cameras ? 'PIGNUS_GHL_CAMERAS_WEBHOOK_URL' : 'PIGNUS_GHL_WEBHOOK_URL']) url = ''
  if (cameras && [env.PIGNUS_GHL_WEBHOOK_URL, env.PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL,
    env[postSale ? 'PIGNUS_GHL_CAMERAS_WEBHOOK_URL' : 'PIGNUS_GHL_CAMERAS_EXPERIENCE_WEBHOOK_URL']].includes(url)) url = ''
  return { enabled: env[`${prefix}_ENABLED`] === 'true' && Boolean(url) && String(env.PIGNUS_SESSION_SECRET || '').length >= 32, url }
}
const enabledRoutes = env => ['appointment', 'experience'].flatMap(kind => ['alarm', 'cameras'].filter(type => configuration(env, kind, type).enabled).map(type => ({ kind, type })))
const anyEnabled = env => enabledRoutes(env).length > 0
const envelopeFor = (record, state, item) => item.kind === 'experience' ? experience.envelope(record, state) : { ...notice.envelope(record, state), id: item.id }

function receiptToken(eventId, env = process.env) {
  if (!/^whatsapp-[a-f0-9]{64}$/.test(eventId) || String(env.PIGNUS_SESSION_SECRET || '').length < 32) return ''
  return createHmac('sha256', env.PIGNUS_SESSION_SECRET).update(`agentec/whatsapp/receipt/v1:${eventId}`).digest('hex')
}

function signedPayload(item, env = process.env, isTest = false) {
  const payload = (item.kind === 'experience' ? experience : notice).webhookPayload(item, isTest)
  return { ...payload, receiptToken: receiptToken(payload.eventId, env) }
}

async function receiveReceipt({ store, input, env = process.env, at = new Date().toISOString() }) {
  // Standard GHL Webhook actions place extra fields in customData.
  const data = input?.customData || input || {}
  const expected = receiptToken(String(data.eventId || ''), env), supplied = String(data.receiptToken || '')
  if (!expected || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw Object.assign(new Error('Confirmación no autorizada.'), { statusCode: 401 })
  await store.ensure()
  await store.acknowledge(data.eventId.slice(9), at)
  return { ok: true }
}

function createStore({ sql, db, env = process.env }) {
  const query = (text, params = []) => sql ? sql.unsafe(sqlParameters(text), params) : Promise.resolve(/^(SELECT|UPDATE[\s\S]+RETURNING)/i.test(text) ? db.prepare(text).all(...params) : (db.prepare(text).run(...params), []))
  const parse = row => row ? { ...row, payload: JSON.parse(row.payload), history: JSON.parse(row.history) } : null
  async function ensure() {
    await query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, customer_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, started_at TEXT, sent_at TEXT, last_error TEXT, history TEXT NOT NULL)`)
    await query(`CREATE INDEX IF NOT EXISTS appointment_whatsapp_pending ON ${TABLE} (status,next_attempt_at)`)
    if (sql) {
      await query(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`)
      await query(`REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC`)
      await query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE ${TABLE} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE ${TABLE} FROM authenticated; END IF; END $$`)
    }
  }
  return { ensure, query,
    async enqueue(previous, next, at = new Date().toISOString()) {
      const items = [
        ...notice.changes(previous, next, 'whatsapp').filter(item => item.date >= notice.today(at)),
        ...experience.changes(previous, next)
      ].filter(item => configuration(env, item.kind, item.installationType).enabled)
      await ensure()
      const existing = await this.list()
      const cancellations = delivery.cancellations(previous, next, existing, at, 'whatsapp')
      items.push(...cancellations.map(row => row.payload))
      for (const original of items) {
        const item = delivery.revision(original, existing, at)
        const planned = item.kind === 'appointment' ? cancellations.find(row => row.payload.id === item.id) || delivery.plan(item, existing, at, 'whatsapp') : { payload: item, status: item.phone ? 'queued' : 'needs_phone', nextAt: at }
        const updateGuard = item.kind === 'appointment' ? "status IN ('queued','needs_phone','cancelled','skipped') AND attempts=0" : "status IN ('queued','retry','needs_phone','cancelled')"
        await query(`UPDATE ${TABLE} SET service_id=?,customer_id=?,status=?,payload=?,updated_at=?,next_attempt_at=?,last_error=NULL WHERE id=? AND ${updateGuard}`, [item.serviceId, item.customerId, planned.status, JSON.stringify(planned.payload), at, planned.nextAt, item.id])
        await query(`INSERT INTO ${TABLE} (id,service_id,customer_id,status,payload,created_at,updated_at,next_attempt_at,history) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, [item.id, item.serviceId, item.customerId, planned.status, JSON.stringify(planned.payload), at, at, planned.nextAt, JSON.stringify([{ at, action: planned.status === 'skipped' ? 'skipped' : 'created' }])])
      }
      await this.reconcile(next, at)
    },
    async list() { return (await query(`SELECT * FROM ${TABLE} ORDER BY created_at DESC`)).map(parse) },
    async reconcile(state, at) {
      await delivery.reconcile({ rows: await this.list(), state, at, channel: 'whatsapp', save: async (row, planned) => {
        await query(`UPDATE ${TABLE} SET status=?,payload=?,updated_at=?,next_attempt_at=?,last_error=NULL WHERE id=? AND status IN ('queued','retry','needs_phone','skipped','needs_action')`, [planned.status, JSON.stringify(planned.payload), at, planned.nextAt, row.id])
      } })
      for (const row of await this.list()) {
        if (row.payload.kind === 'appointment') continue
        if (!['queued', 'retry', 'needs_phone'].includes(row.status)) continue
        const record = state.history.find(item => String(item.id) === row.service_id)
        const current = row.payload.kind === 'experience' && experience.ready(record, state) ? experience.envelope(record, state) : null
        if (current && current.customerId === row.customer_id && current.id === row.id) {
          const status = current.phone ? row.status === 'needs_phone' ? 'queued' : row.status : 'needs_phone'
          await query(`UPDATE ${TABLE} SET payload=?,status=?,updated_at=? WHERE id=? AND status IN ('queued','retry','needs_phone')`, [JSON.stringify(current), status, at, row.id])
          continue
        }
        if (!eligible(record, row.payload, state, at)) {
          await query(`UPDATE ${TABLE} SET status='cancelled',updated_at=?,last_error=NULL WHERE id=? AND status IN ('queued','retry','needs_phone')`, [at, row.id])
        } else {
          await query(`UPDATE ${TABLE} SET payload=? WHERE id=? AND status IN ('queued','retry','needs_phone')`, [JSON.stringify(envelopeFor(record, state, row.payload)), row.id])
        }
      }
    },
    async claim(at, kinds = ['appointment', 'experience'], routes = null) {
      // Called inside the shared mailbox lease. Keep the contact's mutable GHL
      // fields reserved until its previous workflow reaches the receipt action.
      const field = (alias, name) => sql ? `(${alias}.payload::jsonb->>'${name}')` : `json_extract(${alias}.payload,'$.${name}')`
      const phone = alias => field(alias, 'phone'), email = alias => field(alias, 'recipient')
      if (!kinds.length) return null
      const kindFilter = ` AND COALESCE(${field('candidate', 'kind')},'appointment') IN (${kinds.map(() => '?').join(',')})`
      if (routes && !routes.length) return null
      const routeFilter = routes ? ` AND (${routes.map(() => `(COALESCE(${field('candidate', 'kind')},'appointment')=? AND CASE WHEN ${field('candidate', 'installationType')} IN ('cameras','combined') THEN 'cameras' ELSE 'alarm' END=?)`).join(' OR ')})` : ''
      return parse((await query(`UPDATE ${TABLE} SET status='sending',attempts=attempts+1,started_at=?,updated_at=? WHERE id=(SELECT candidate.id FROM ${TABLE} candidate WHERE candidate.status IN ('queued','retry') AND candidate.next_attempt_at<=?${kindFilter}${routeFilter} AND NOT EXISTS (SELECT 1 FROM ${TABLE} active WHERE active.id<>candidate.id AND active.status IN ('sending','accepted','uncertain') AND (${phone('active')}=${phone('candidate')} OR (${email('candidate')}<>'' AND LOWER(${email('active')})=LOWER(${email('candidate')})))) ORDER BY candidate.created_at,candidate.id LIMIT 1) AND status IN ('queued','retry') RETURNING *`, [at, at, at, ...kinds, ...(routes || []).flatMap(route => [route.kind, route.type])]))[0])
    },
    async acknowledge(id, at) {
      const row = parse((await query(`SELECT * FROM ${TABLE} WHERE id=?`, [id]))[0])
      if (!row || !['sending', 'accepted', 'uncertain'].includes(row.status)) return
      await query(`UPDATE ${TABLE} SET status='processed',updated_at=?,sent_at=COALESCE(sent_at,?),last_error=NULL,history=? WHERE id=? AND status IN ('sending','accepted','uncertain')`, [at, at, JSON.stringify([...row.history, { at, action: 'workflow_completed' }]), id])
    },
    async review(id, updatedAt, user, at) {
      const row = parse((await query(`SELECT * FROM ${TABLE} WHERE id=?`, [id]))[0])
      if (!row || !['uncertain', 'needs_action'].includes(row.status) || row.updated_at !== updatedAt) throw Object.assign(new Error('El aviso cambió. Actualizá la ficha.'), { statusCode: 409 })
      const changed = await query(`UPDATE ${TABLE} SET status='reviewed',updated_at=?,last_error=NULL,history=? WHERE id=? AND status=? AND updated_at=? RETURNING id`, [at, JSON.stringify([...row.history, { at, action: row.status === 'needs_action' ? 'cancellation_contacted_manually' : 'reviewed_without_resend', byId: user.id, byName: user.name || user.email }]), id, row.status, updatedAt])
      if (!changed.length) throw Object.assign(new Error('El aviso cambió. Actualizá la ficha.'), { statusCode: 409 })
    },
    async finish(row, status, error, at) {
      const next = new Date(Date.parse(at) + Math.min(900000, 30000 * 2 ** Math.min(5, row.attempts))).toISOString()
      await query(`UPDATE ${TABLE} SET status=?,updated_at=?,next_attempt_at=?,sent_at=?,last_error=?,history=? WHERE id=? AND status='sending' AND attempts=?`, [status, at, next, status === 'accepted' ? at : null, error, JSON.stringify([...row.history, { at, action: status, attempt: row.attempts }]), row.id, row.attempts])
    },
    async recover(at) {
      const cutoff = new Date(Date.parse(at) - 10 * 60000).toISOString()
      await query(`UPDATE ${TABLE} SET status='uncertain',updated_at=?,last_error=? WHERE status='sending' AND started_at<?`, [at, 'El proceso se interrumpió sin confirmar el resultado. Revisá la ejecución en GoHighLevel; no se reenviará automáticamente.', cutoff])
      await query(`UPDATE ${TABLE} SET status='uncertain',updated_at=?,last_error=? WHERE status='accepted' AND sent_at<?`, [at, 'GoHighLevel no confirmó el fin del flujo. Revisá su ejecución y el paso de confirmación; los nuevos avisos de este contacto quedan retenidos.', new Date(Date.parse(at) - 30 * 60000).toISOString()])
    }
  }
}

function eligible(record, item, state, now) {
  if (item.kind === 'experience') {
    if (!experience.ready(record, state)) return false
    const current = experience.envelope(record, state)
    return current.id === item.id && current.phone === item.phone && current.recipient === item.recipient && current.customerId === item.customerId
  }
  return !item.cancelledNotice && delivery.current(record, item, state, 'whatsapp', now)
}

// An HTTP acceptance is NOT evidence of a delivered WhatsApp. Ambiguous requests
// must be reviewed in GHL, whose webhook does not guarantee idempotent delivery.
async function deliver(payload, config, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  try {
    const response = await fetchImpl(config.url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) })
    if (response.status === 429) return { status: 'retry', error: 'GoHighLevel limitó temporalmente las solicitudes. Se reintentará.' }
    if (response.status >= 400 && response.status < 500) return { status: 'failed', error: `GoHighLevel rechazó la solicitud (HTTP ${response.status}). Revisá el flujo y su configuración.` }
    if (!response.ok) return { status: 'uncertain', error: 'GoHighLevel no confirmó la recepción. Revisá su historial antes de reenviar.' }
    // Bound the response body: it must never be retained or exposed to the client.
    const reader = response.body?.getReader()
    let body = '', size = 0
    if (reader) {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 16384) break
          body += Buffer.from(value).toString('utf8')
        }
      } finally { await reader.cancel().catch(() => {}) }
    }
    if (/test request received/i.test(body)) return { status: 'draft', error: 'GoHighLevel recibió una muestra, no un envío operativo. Publicá el flujo y revisá esta visita.' }
    return { status: 'accepted', error: null }
  } catch {
    return { status: 'uncertain', error: 'No se pudo confirmar si GoHighLevel recibió el aviso. Revisá su historial; no se reenviará automáticamente.' }
  }
}

async function processWhatsApp({ store, readState, env = process.env, now = Date.now, fetchImpl = fetch, maxRunMs = 7000 }) {
  const routes = enabledRoutes(env), kinds = [...new Set(routes.map(route => route.kind))], counts = { accepted: 0, failed: 0, uncertain: 0, retry: 0, cancelled: 0, draft: 0 }
  if (!kinds.length) return { ...counts, paused: true }
  await store.ensure()
  await store.recover(new Date(now()).toISOString())
  const pending = new Set((await store.list()).filter(row => row.status !== 'cancelled').map(row => row.id))
  await store.reconcile(await readState(), new Date(now()).toISOString())
  counts.cancelled = (await store.list()).filter(row => row.status === 'cancelled' && pending.has(row.id)).length
  const deadline = now() + maxRunMs
  for (let i = 0; i < 5 && now() < deadline; i++) {
    const row = await store.claim(new Date(now()).toISOString(), kinds, routes)
    if (!row) break
    // If a read fails, the row remains sending and is recovered as uncertain.
    const state = await readState(), record = state.history.find(item => String(item.id) === row.service_id)
    let result
    if (!eligible(record, row.payload, state, now())) result = { status: 'cancelled', error: null }
    else {
      const current = envelopeFor(record, state, row.payload)
      const config = configuration(env, current.kind, current.installationType)
      // A category edit after claiming must not use a stale or disabled workflow.
      if (!config.enabled || current.installationType !== (row.payload.installationType || 'alarm')) result = { status: 'cancelled', error: null }
      else result = await deliver(signedPayload(current, env), config, { fetchImpl, timeoutMs: Math.max(1, Math.min(5000, deadline - now())) })
    }
    if (result.status === 'retry' && row.attempts >= 5) result = { status: 'failed', error: 'GoHighLevel sigue limitando las solicitudes después de cinco intentos. Revisá el canal.' }
    await store.finish(row, result.status, result.error, new Date(now()).toISOString())
    counts[result.status]++
  }
  return counts
}

function present(row) {
  return { id: `whatsapp:${row.id}`, kind: row.payload.kind || 'appointment', channel: 'whatsapp', recordId: row.service_id, customerId: row.customer_id,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, sentAt: row.sent_at, sender: 'GoHighLevel',
    scheduledAt: row.payload.scheduledAt, omissionReason: row.payload.omissionReason, cancelledNotice: row.payload.cancelledNotice,
    attempts: row.attempts, error: row.last_error || '', client: row.payload.client, account: row.payload.account,
    recipient: row.payload.phone, technicians: row.payload.technicians, serviceType: row.payload.serviceType || 'Instalación de alarma', history: row.history }
}

module.exports = { TABLE, configuration, anyEnabled, receiptToken, signedPayload, receiveReceipt, createStore, eligible, deliver, processWhatsApp, present }
