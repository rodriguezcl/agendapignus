const crypto = require('node:crypto')
const HOUR = 3600000
const LEASE = 20 * 60000
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }) }
const hash = token => crypto.createHash('sha256').update(token).digest('hex')
const active = state => ['pending', 'running'].includes(state.job?.status)
function expire(state, now) {
  if (state.job?.status === 'running' && now - state.job.startedAt > LEASE) {
    state.job = { ...state.job, status: 'error', finishedAt: now, code: 'WORKER_TIMEOUT' }; delete state.lastReport
  }
  if (state.job?.status === 'pending' && now - state.job.createdAt > HOUR) state.job = { ...state.job, status: 'error', finishedAt: now, code: 'REQUEST_EXPIRED' }
}
function request(state, now, actor) {
  expire(state, now)
  if (!active(state)) state.job = { id: crypto.randomUUID(), status: 'pending', createdAt: now, requestedBy: actor }
  return state.job
}
function worker(state, body, now) {
  expire(state, now)
  state.lastSeen = now
  if (body.action === 'poll') {
    if (!active(state) && (!state.nextAutomaticAt || now >= state.nextAutomaticAt)) request(state, now, 'automatic')
    if (state.job?.status !== 'pending') return { job: null }
    state.job = { ...state.job, status: 'running', startedAt: now }
    state.nextAutomaticAt = now + HOUR
    return { job: { id: state.job.id } }
  }
  if (!['heartbeat', 'finish'].includes(body.action)) fail(400, 'Acción inválida.')
  if (state.job?.id !== body.jobId || state.job.status !== 'running') fail(409, 'La ejecución ya no está activa.')
  if (body.action === 'finish') {
    if (!['imported', 'unchanged', 'error'].includes(body.status)) fail(400, 'Resultado inválido.')
    const count = Number(body.count)
    state.job = { ...state.job, status: body.status === 'error' ? 'error' : 'completed', result: body.status, finishedAt: now,
      count: Number.isInteger(count) && count >= 0 && count < 10000000 ? count : null,
      code: body.status === 'error' ? String(body.code || 'WORKER_ERROR').replace(/[^A-Z_]/g, '').slice(0, 64) : null }
    if (body.status !== 'error') state.lastSuccess = { at: now, count: state.job.count }
  }
  return { ok: true }
}
function publicStatus(state, configured, now) {
  return { configured, presenceEnabled: state.presenceEnabled === true, online: Boolean(state.lastSeen && now - state.lastSeen < 180000), lastSeen: state.lastSeen || null, lastSuccess: state.lastSuccess || null, job: state.job || null }
}
async function ensure(sql) {
  return require('./schema-readiness.cjs').ensureCommittedSchema(sql, 'customer-sync', async sql => {
  await sql`create table if not exists pignus_customer_sync (id integer primary key check (id = 1), token_hash text, state jsonb not null default '{}'::jsonb)`
  await sql`alter table pignus_customer_sync enable row level security`
  await sql`revoke all on pignus_customer_sync from anon, authenticated`
  await sql`insert into pignus_customer_sync (id) values (1) on conflict do nothing`
  })
}
async function handle({ sql, mode, body = {}, bearer = '', user, reconcileReport }) {
  if (mode === 'worker' && !/^[a-f0-9]{64}$/.test(bearer)) fail(401, 'Conector no autorizado.')
  await ensure(sql)
  return sql.begin(async tx => {
    const [row] = await tx`select token_hash, state from pignus_customer_sync where id = 1 for update`
    const state = row.state || {}
    const now = Date.now()
    let result, tokenHash = row.token_hash
    if (mode === 'worker') {
      if (!/^[a-f0-9]{64}$/.test(bearer) || !tokenHash || !crypto.timingSafeEqual(Buffer.from(hash(bearer)), Buffer.from(tokenHash))) fail(401, 'Conector no autorizado.')
      const successful = body.action === 'finish' && ['imported','unchanged'].includes(body.status)
      const report = successful ? require('./softguard-presence.cjs').validatePresenceReport(body, state.lastReport) : null
      result = worker(state, body, now)
      if(body.action === 'finish') {
        if(report && reconcileReport) {
          await reconcileReport(tx, report, state.lastReport, new Date(now).toISOString())
          state.lastReport = report
          state.presenceEnabled = true
        } else { delete state.lastReport; state.presenceEnabled = false }
      }
    } else if (mode === 'token') {
      if (user?.roleCode !== 'administrator') fail(403, 'Solamente Administración puede conectar la PC.')
      expire(state, now)
      if (active(state)) fail(409, 'Esperá a que termine la solicitud activa antes de reemplazar la conexión.')
      const token = crypto.randomBytes(32).toString('hex')
      tokenHash = hash(token)
      state.lastSeen = null; delete state.lastReport
      result = { token }
    } else if (mode === 'request') {
      if (!tokenHash) fail(409, 'Primero conectá la PC de sincronización.')
      request(state, now, String(user.id))
    } else if (mode !== 'status') fail(405, 'Método no permitido.')
    expire(state, now)
    await tx`update pignus_customer_sync set token_hash = ${tokenHash}, state = ${tx.json(state)} where id = 1`
    return result || publicStatus(state, Boolean(tokenHash), now)
  })
}
module.exports = { handle, request, worker, publicStatus, expire }
