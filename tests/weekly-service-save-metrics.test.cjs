const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { weeklyServiceSaveMetrics, readWeeklyServiceSaveSummary } = require('../api/_lib/weekly-service-save-metrics.cjs')

const admin = { id: 'admin', roleCode: 'administrator' }
const planner = { id: 'planner', roleCode: 'user', permissions: { weekly: true } }
const sample = { durationMs: 731, retried: false, withAttachments: false }
const table = 'pignus_weekly_service_save_metrics'
const post = (store, input, user = planner) => weeklyServiceSaveMetrics({ ...store, method: 'POST', input, user })
const get = (store, user = admin) => weeklyServiceSaveMetrics({ ...store, method: 'GET', user })
const empty = { count: 0, p50Ms: null, p95Ms: null }

test('only planners can submit samples, only administrators read results and validation runs before storage', async () => {
  const store = { connection: null, kind: 'db' }
  for (const user of [null, { ...admin, status: 'Inactivo' }, { id: 'tech', roleCode: 'technician' }]) {
    await assert.rejects(post(store, sample, user), { statusCode: 403 })
  }
  await assert.rejects(get(store, planner), { statusCode: 403 })
  await assert.rejects(weeklyServiceSaveMetrics({ ...store, user: admin, method: 'DELETE' }), { statusCode: 405 })
  for (const invalid of [null, {}, { ...sample, id: 'personal' }, { ...sample, message: 'private' }, { ...sample, durationMs: 0 },
    { ...sample, durationMs: 7.5 }, { ...sample, durationMs: 2147483648 }, { ...sample, durationMs: '27' },
    { ...sample, retried: 1 }, { ...sample, withAttachments: null }]) {
    await assert.rejects(post(store, invalid), { statusCode: 400 })
  }
})

for (const kind of ['db', 'sql']) test(`${kind}: aggregate actual durations independently of Agenda and expire old samples`, async t => {
  let connection
  if (kind === 'db') {
    connection = new DatabaseSync(':memory:')
    t.after(() => connection.close())
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const pg = await PGlite.create()
    t.after(() => pg.close())
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;')
    connection = pgliteAdapter(pg)
  }
  const store = { connection, kind }
  const query = sql => kind === 'sql' ? connection.unsafe(sql) : connection.prepare(sql).all()
  const tableCheck = kind === 'sql' ? `SELECT relname FROM pg_class WHERE relname='${table}'` : `SELECT name FROM sqlite_master WHERE name='${table}'`
  assert.deepEqual((await readWeeklyServiceSaveSummary(store)).all, empty)
  assert.equal((await query(tableCheck)).length, 0, 'read-only access must not create schema')

  for (const [durationMs, retried, withAttachments] of [[10, false, false], [50, true, true], [100, false, true], [400, false, false]]) {
    assert.deepEqual(await post(store, { durationMs, retried, withAttachments }), { ok: true })
  }
  const insertExpired = `INSERT INTO ${table} VALUES (0, 2000000, TRUE, TRUE)`
  if (kind === 'sql') await connection.unsafe(insertExpired)
  else connection.exec(insertExpired)
  assert.deepEqual(await get(store), {
    windowDays: 7,
    all: { count: 4, p50Ms: 50, p95Ms: 400 },
    firstAttempt: { count: 3, p50Ms: 100, p95Ms: 400 },
    retried: { count: 1, p50Ms: 50, p95Ms: 50 },
    withoutAttachments: { count: 2, p50Ms: 10, p95Ms: 400 },
    withAttachments: { count: 2, p50Ms: 50, p95Ms: 100 }
  })
  assert.equal(Number((await query(`SELECT COUNT(*) AS n FROM ${table} WHERE recorded_at_ms=0`))[0].n), 1)
  await post(store, sample)
  assert.equal(Number((await query(`SELECT COUNT(*) AS n FROM ${table} WHERE recorded_at_ms=0`))[0].n), 0)
  if (kind === 'sql') {
    const [protection] = await query(`SELECT relrowsecurity AS rls,
      has_table_privilege('anon', '${table}', 'SELECT') AS public_reader,
      has_table_privilege('authenticated', '${table}', 'INSERT') AS public_writer
      FROM pg_class WHERE relname='${table}'`)
    assert.deepEqual(protection, { rls: true, public_reader: false, public_writer: false })
  }
})
