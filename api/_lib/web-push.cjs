const { createHash, hkdfSync, timingSafeEqual, ECDH } = require('node:crypto')
const policy = require('./permission-catalog.cjs')
const { userForEmployee, visibleStateForUser } = require('./core.cjs')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
const hash = value => createHash('sha256').update(String(value)).digest('hex')

function workerSecret(env = process.env) {
  if (String(env.PIGNUS_SESSION_SECRET || '').length < 32) return null
  return Buffer.from(hkdfSync('sha256', env.PIGNUS_SESSION_SECRET, '', 'pignus/web-push/worker/v1', 32)).toString('hex')
}
function workerAuthorized(req, env) {
  const secret = workerSecret(env), actual = Buffer.from(String(req.headers?.authorization || ''))
  const expected = Buffer.from(`Bearer ${secret}`)
  return Boolean(secret && actual.length === expected.length && timingSafeEqual(actual, expected))
}
function validateSubscription(input) {
  let url
  try { url = new URL(input?.endpoint) } catch { fail('La suscripción del dispositivo no es válida.') }
  const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
    url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com')
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length > 2048) fail('El proveedor de notificaciones no está permitido.')
  const keys = input.keys || {}
  for (const [name, length] of [['p256dh', 65], ['auth', 16]]) {
    if (typeof keys[name] !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys[name]) || Buffer.from(keys[name], 'base64url').length !== length) fail('Las claves del dispositivo no son válidas.')
  }
  try { ECDH.convertKey(Buffer.from(keys.p256dh, 'base64url'), 'prime256v1') } catch { fail('La clave pública del dispositivo no es válida.') }
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}
const noticeKeys = notice => (notice.soundKeys || [notice.id]).map(key => hash(key))
const snapshotKeys = notices => [...new Set(notices.flatMap(notice => [...noticeKeys(notice), ...(notice.target?.type === 'ticket' ? [hash(`ticket:${notice.target.ticketId}`)] : [])]))]
function newNotices(notices, seen = []) {
  const known = new Set(seen)
  return notices.filter(notice => noticeKeys(notice).some(key => !known.has(key)))
}
function payloadFor(notices, userId) {
  // No financial amounts, addresses, client names or internal notes on a lock screen.
  return { title: 'Agenda Pignus', body: notices.length === 1 ? 'Tenés un nuevo aviso pendiente. Tocá para consultarlo.' : `Tenés ${notices.length} nuevos avisos. Tocá para consultarlos.`,
    noticeId: notices[0]?.id || '', userId: String(userId), tag: `pignus-${hash(userId).slice(0, 20)}` }
}
async function notificationsFor(sql, state, user, now = new Date()) {
  const { selectDashboardNotifications } = require('../_vendor/push-notifications.cjs')
  const projected = visibleStateForUser(state, user)
  const access = policy.permissionsWithAliases(user)
  const technicalOnly = policy.roleCode(user) === 'technician' || (policy.can(user, 'technical.view') && !['dashboard','weekly','agenda','history','collections','accounts','map','employees','services','vehicles','settings','audit'].some(key => access[key]))
  let passwordResetRequests = []
  if (policy.can(user, 'notifications.passwordRequests')) {
    const [row] = await sql`select value from pignus_preferences where key='password_reset_requests'`
    try { passwordResetRequests = JSON.parse(row?.value || '[]') } catch { /* malformed legacy preference */ }
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const operational = technicalOnly ? [] : selectDashboardNotifications({ ...projected, user, today, now: now.getTime(), passwordResetRequests })
  const tickets = policy.can(user, 'notifications.tickets') && policy.can(user, 'tickets.view')
    ? (await require('./tickets-http.cjs').storeFor(sql, 'sql').query(user, state, { mode: 'notifications' })).notifications : []
  const registrations=await require('./native-registration.cjs').notices(sql,'sql',state,user)
  return (await import('../../shared/registration/notifications.mjs')).combineRegistrationNotifications(operational,tickets,registrations)
}
function currentUser(state, id) {
  const employee = state.employees?.find(item => String(item.id) === String(id) && item.status === 'Activo')
  return employee ? userForEmployee(employee, state.roles) : null
}
async function configured(sql) {
  const [row] = await sql`select to_regclass('public.pignus_push_config') as relation`
  if (!row?.relation) return null
  const [config] = await sql`select * from pignus_push_config where id=true`
  return config || null
}
async function sendPush(config, subscription, payload) {
  return require('web-push').sendNotification(subscription, JSON.stringify(payload), { TTL: 300, urgency: 'normal', timeout: 5000,
    vapidDetails: { subject: config.subject, publicKey: config.public_key, privateKey: config.private_key } })
}
async function request({ sql, user, sessionHash, method, input = {}, readState }) {
  const config = await configured(sql)
  if (!config) { if (method === 'GET') return { available: false }; fail('Las notificaciones todavía no están habilitadas en el servidor.', 503) }
  if (method === 'GET') return { available: true, publicKey: config.public_key }
  if (!['POST','DELETE'].includes(method)) fail('Método no permitido.', 405)
  if (typeof input.endpoint !== 'string' && !input.subscription) fail('Falta identificar este dispositivo.')
  const endpoint = input.subscription?.endpoint || input.endpoint
  if (typeof endpoint !== 'string' || endpoint.length > 2048) fail('Dispositivo inválido.')
  const id = hash(endpoint)
  if (method === 'DELETE') {
    await sql`delete from pignus_push_subscriptions where id=${id} and user_id=${String(user.id)}`
    return { enabled: false }
  }
  if (input.action === 'status') {
    // Reattach an already opted-in browser after renewing an expired session;
    // an explicit logout must always revoke this device's current subscription.
    const [row] = await sql`update pignus_push_subscriptions set session_hash=${sessionHash} where id=${id} and user_id=${String(user.id)} returning id`
    return { enabled: Boolean(row) }
  }
  if (input.action === 'test') {
    const [row] = await sql`update pignus_push_subscriptions set last_test_at=now() where id=${id} and user_id=${String(user.id)} and (last_test_at is null or last_test_at < now()-interval '30 seconds') returning subscription`
    if (!row) fail('Activá las notificaciones o esperá 30 segundos antes de volver a probar.', 429)
    try { await sendPush(config, row.subscription, { ...payloadFor([], user.id), body: 'Las notificaciones de este dispositivo están activadas.', test: true }) }
    catch { fail('No se pudo enviar la prueba. Desactivá y volvé a activar este dispositivo.', 502) }
    return { sent: true }
  }
  if (input.action !== 'subscribe') fail('Acción no válida.')
  const subscription = validateSubscription(input.subscription)
  const notices = await notificationsFor(sql, await readState(sql), user)
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${String(user.id)}))`
    const [count] = await tx`select count(*)::int as total from pignus_push_subscriptions where user_id=${String(user.id)} and id<>${id}`
    if (count.total >= 10) fail('Alcanzaste el límite de 10 dispositivos. Desactivá uno antes de agregar otro.', 409)
    await tx`insert into pignus_push_subscriptions(id,user_id,session_hash,subscription,seen) values(${id},${String(user.id)},${sessionHash},${tx.json(subscription)},${tx.json(snapshotKeys(notices))})
      on conflict(id) do update set user_id=excluded.user_id, session_hash=excluded.session_hash, subscription=excluded.subscription,
      seen=case when pignus_push_subscriptions.user_id=excluded.user_id then pignus_push_subscriptions.seen else excluded.seen end,
      updated_at=now(), next_attempt_at=now(), lease_until=null, lease_token=null`
  })
  return { enabled: true }
}
async function revokeSession(sql, sessionHash) {
  // The app permits one active session per account. Explicit logout also
  // removes subscriptions left behind by an older, expired session.
  if (await configured(sql)) await sql`delete from pignus_push_subscriptions where session_hash=${sessionHash}
    or user_id in (select employee_id from pignus_sessions where token_hash=${sessionHash})`
}
async function processPush({ sql, readState, send = sendPush, select = notificationsFor, maxRunMs = 35000 }) {
  const config = await configured(sql)
  if (!config) return { configured: false, sent: 0 }
  const started = Date.now(), cache = new Map()
  const candidates = await sql`select id from pignus_push_subscriptions where next_attempt_at<=now() and (lease_until is null or lease_until<now()) order by checked_at nulls first, id limit 100`
  if (!candidates.length) return { configured: true, checked: 0, sent: 0, removed: 0, failed: 0 }
  const state = await readState(sql)
  let sent = 0, removed = 0, failed = 0, checked = 0
  for (const candidate of candidates) {
    if (Date.now() - started > maxRunMs) break
    const token = require('node:crypto').randomUUID()
    const [row] = await sql`update pignus_push_subscriptions set lease_until=now()+interval '90 seconds',lease_token=${token} where id=${candidate.id} and (lease_until is null or lease_until<now()) returning *`
    if (!row) continue
    try {
      const user = currentUser(state, row.user_id)
      if (!user) { await sql`delete from pignus_push_subscriptions where id=${row.id} and lease_token=${token}`; removed++; continue }
      if (!cache.has(row.user_id)) cache.set(row.user_id, await select(sql, state, user))
      const notices = cache.get(row.user_id), fresh = newNotices(notices, row.seen)
      if (fresh.length) {
        const [stillEnabled] = await sql`select id from pignus_push_subscriptions where id=${row.id} and lease_token=${token}`
        if (!stillEnabled) continue
        await send(config, row.subscription, payloadFor(fresh, user.id))
        sent++
      }
      // Retain identities while they remain actionable; resolved notices may become actionable again later.
      await sql`update pignus_push_subscriptions set seen=${sql.json(snapshotKeys(notices))},checked_at=now(),next_attempt_at=now()+interval '55 seconds',lease_until=null,lease_token=null where id=${row.id} and lease_token=${token}`
      checked++
    } catch (error) {
      if ([404,410].includes(error.statusCode)) { await sql`delete from pignus_push_subscriptions where id=${row.id} and lease_token=${token}`; removed++ }
      else { await sql`update pignus_push_subscriptions set checked_at=now(),next_attempt_at=now()+interval '2 minutes',lease_until=null,lease_token=null where id=${row.id} and lease_token=${token}`; failed++ }
    }
  }
  return { configured: true, checked, sent, removed, failed }
}
module.exports = { hash, workerSecret, workerAuthorized, validateSubscription, noticeKeys, snapshotKeys, newNotices, payloadFor, notificationsFor, currentUser, configured, request, revokeSession, processPush }
