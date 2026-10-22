const test = require('node:test')
const assert = require('node:assert/strict')
const { schedulerStatus, JOB_NAME, CRON_EXPRESSION } = require('../api/_lib/ticket-mail-scheduler.cjs')

const NOW = Date.parse('2026-10-22T15:00:00Z')
const ago = milliseconds => new Date(NOW - milliseconds).toISOString()

function fixture({ available = { cron: true, schedule: true, responses: true, runs: true }, job = { jobid: 4, active: true, schedule: CRON_EXPRESSION }, attempt = { request_id: '912345678901234', requested_at: ago(30_000) }, response = { status_code: 200, timed_out: false, has_error: false, created: ago(10_000) }, run = null } = {}) {
  const queries = []
  const sql = { async unsafe(query, parameters = []) {
    queries.push({ query, parameters })
    if (query.includes('to_regclass')) return [available]
    if (query.includes('FROM cron.job_run_details')) { assert.deepEqual(parameters, [job.jobid]); return run ? [run] : [] }
    if (query.includes('FROM cron.job')) { assert.deepEqual(parameters, [JOB_NAME]); return job ? [job] : [] }
    if (query.includes('FROM agentec_private.ticket_mail_schedule')) return attempt ? [attempt] : []
    if (query.includes('FROM net._http_response')) { assert.deepEqual(parameters, [attempt.request_id]); return response ? [response] : [] }
    throw new Error('Consulta inesperada')
  } }
  return { queries, read: () => schedulerStatus({ sql, now: () => NOW }) }
}

test('sin PostgreSQL o extensiones disponibles no consulta tablas opcionales inexistentes', async () => {
  assert.equal((await schedulerStatus()).state, 'unconfigured')
  for (const field of ['cron', 'schedule', 'responses']) {
    const f = fixture({ available: { cron: true, schedule: true, responses: true, [field]: false } })
    const result = await f.read()
    assert.equal(result.configured, false)
    assert.equal(result.active, false)
    assert.equal(result.state, 'unconfigured')
    assert.equal(f.queries.length, 1)
  }
})

test('el nombre de job y la fila de configuración deben existir', async () => {
  for (const missing of [{ job: null }, { attempt: null }]) {
    const f = fixture(missing)
    assert.equal((await f.read()).configured, false)
    assert.equal(f.queries.some(row => row.query.includes('FROM net._http_response')), false)
  }
})

test('el resultado expone sólo fechas, estado y frecuencia sin datos privados', async () => {
  const privateData = { endpoint: 'https://secreto.invalid/api', secret: 'clave-secreta', content: 'contenido privado', error_msg: 'contraseña privada' }
  const f = fixture({ response: { ...privateData, status_code: 200, timed_out: false, has_error: false, created: new Date(ago(10_000)) } })
  const result = await f.read()
  assert.deepEqual(result, {
    configured: true, active: true, intervalMinutes: 2,
    lastAttemptAt: ago(30_000), lastHttpStatus: 200, lastCompletedAt: ago(10_000),
    state: 'ok', message: 'La última ejecución programada finalizó correctamente.'
  })
  for (const value of Object.values(privateData)) assert.equal(JSON.stringify(result).includes(value), false)
  assert.equal(f.queries.some(row => /SELECT\s+\*/i.test(row.query)), false)
  assert.equal(f.queries.some(row => /\b(endpoint|content|secret)\b/.test(row.query)), false)
})

test('distingue pausa, espera de primer ciclo y ejecución en curso', async () => {
  assert.equal((await fixture({ job: { active: false, schedule: CRON_EXPRESSION }, attempt: { request_id: null, requested_at: null } }).read()).state, 'paused')
  const waiting = fixture({ attempt: { request_id: null, requested_at: null } })
  const result = await waiting.read()
  assert.equal(result.state, 'waiting')
  assert.equal(result.configured, true)
  assert.equal(result.active, true)
  assert.equal(result.lastCompletedAt, null)
  assert.equal(waiting.queries.some(row => row.query.includes('FROM net._http_response')), false)
  const running = await fixture({ response: null }).read()
  assert.equal(running.state, 'running')
  assert.equal(running.lastHttpStatus, null)
  assert.equal(running.lastCompletedAt, null)
})

test('un 409 indica que otra operación estaba en curso; fallos HTTP o de red requieren revisión', async () => {
  for (const [status_code, expected] of [[200, 'ok'], [202, 'ok'], [204, 'ok'], [409, 'busy'], [401, 'error'], [405, 'error'], [500, 'error'], [302, 'error'], [null, 'error']]) {
    assert.equal((await fixture({ response: { status_code, created: ago(10_000) } }).read()).state, expected)
  }
  for (const failure of [{ timed_out: true }, { has_error: true }]) {
    assert.equal((await fixture({ response: { status_code: 200, created: ago(10_000), ...failure } }).read()).state, 'error')
  }
})

test('detecta cron detenido por antigüedad del intento y respuestas que no llegan', async () => {
  const old = await fixture({ attempt: { request_id: 1, requested_at: ago(6 * 60_000 + 1) } }).read()
  assert.equal(old.state, 'stale')
  assert.equal(old.lastHttpStatus, 200)
  assert.equal((await fixture({ attempt: { request_id: 1, requested_at: ago(90_001) }, response: null }).read()).state, 'stale')
  assert.equal((await fixture({ attempt: { request_id: 1, requested_at: ago(90_000) }, response: null }).read()).state, 'running')
  assert.equal((await fixture({ attempt: { request_id: 1, requested_at: ago(6 * 60_000) } }).read()).state, 'ok')
})

test('un fallo del cron anterior al primer envío HTTP se muestra como error', async () => {
  const run = { status: 'failed', start_time: ago(25_000), end_time: ago(24_000), return_message: 'error con credenciales privadas' }
  for (const attempt of [{ request_id: null, requested_at: null }, { request_id: 1, requested_at: ago(3 * 60_000) }]) {
    const f = fixture({ attempt, run })
    const result = await f.read()
    assert.equal(result.state, 'error')
    assert.equal(result.lastAttemptAt, ago(25_000))
    assert.equal(result.lastHttpStatus, null)
    assert.equal(result.lastCompletedAt, null)
    assert.equal(JSON.stringify(result).includes('credenciales'), false)
    assert.equal(f.queries.some(row => /return_message/.test(row.query)), false)
    assert.equal(f.queries.some(row => row.query.includes('FROM net._http_response')), false)
  }
  assert.equal((await fixture({ run: { ...run, start_time: ago(2 * 60_000) } }).read()).state, 'ok')
  assert.equal((await fixture({ run: { ...run, status: 'succeeded' } }).read()).state, 'ok')
})

test('la ausencia de historial de cron conserva el estado HTTP sin consultar la tabla', async () => {
  const f = fixture({ available: { cron: true, schedule: true, responses: true, runs: false } })
  assert.equal((await f.read()).state, 'ok')
  assert.equal(f.queries.some(row => row.query.includes('FROM cron.job_run_details')), false)
})

test('no anuncia una frecuencia distinta de la configurada y oculta fallos internos', async () => {
  assert.equal((await fixture({ job: { active: true, schedule: '0 * * * *' } }).read()).state, 'error')
  const result = await schedulerStatus({ sql: { async unsafe() { throw new Error('host y contraseña privados') } } })
  assert.equal(result.state, 'error')
  assert.equal(JSON.stringify(result).includes('contraseña'), false)
})
