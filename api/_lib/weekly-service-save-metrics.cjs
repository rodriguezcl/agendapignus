const { can, roleCode } = require('./permission-catalog.cjs')
const { ensureCommittedSchema } = require('./schema-readiness.cjs')

const table = 'pignus_weekly_service_save_metrics'
const windowDays = 7
const windowMs = windowDays * 24 * 60 * 60 * 1000
const fields = ['durationMs', 'retried', 'withAttachments']
const groups = ['all', 'firstAttempt', 'retried', 'withoutAttachments', 'withAttachments']
const sqliteReady = new WeakSet()
const createTable = `CREATE TABLE IF NOT EXISTS ${table} (
  recorded_at_ms BIGINT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1 AND 2147483647),
  retried BOOLEAN NOT NULL CHECK (retried IN (TRUE, FALSE)),
  with_attachments BOOLEAN NOT NULL CHECK (with_attachments IN (TRUE, FALSE))
)`
const createIndex = `CREATE INDEX IF NOT EXISTS weekly_service_save_metrics_recorded ON ${table} (recorded_at_ms)`

function assertMetricsPermission(user, method) {
  if (method !== 'POST' && method !== 'GET') {
    throw Object.assign(new Error('Método de medición inválido.'), { statusCode: 405 })
  }
  if (user?.id == null || user.status === 'Inactivo' ||
      !(method === 'GET' ? roleCode(user) === 'administrator' : can(user, 'planning.create'))) {
    throw Object.assign(new Error('No tenés permiso para esta medición.'), { statusCode: 403 })
  }
}

function validateSample(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== fields.length || !fields.every(key => Object.hasOwn(input, key)) ||
      !Number.isInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 2147483647 ||
      typeof input.retried !== 'boolean' || typeof input.withAttachments !== 'boolean') {
    throw Object.assign(new Error('Muestra de guardado inválida.'), { statusCode: 400 })
  }
}

async function storeSample(connection, kind, sample) {
  const now = Date.now()
  if (kind === 'sql') {
    await ensureCommittedSchema(connection, 'weekly-service-save-metrics-v1', async tx => {
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('pignus-weekly-service-save-metrics-schema'))")
      await tx.unsafe(createTable)
      await tx.unsafe(createIndex)
      await tx.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
      await tx.unsafe(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`)
      await tx.unsafe(`DO $$ BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE ${table} FROM anon; END IF;
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE ${table} FROM authenticated; END IF;
      END $$`)
    })
    await connection.unsafe(`WITH expired AS (DELETE FROM ${table} WHERE recorded_at_ms < $1)
      INSERT INTO ${table} (recorded_at_ms, duration_ms, retried, with_attachments) VALUES ($2, $3, $4, $5)`,
    [now - windowMs, now, sample.durationMs, sample.retried, sample.withAttachments])
    return
  }
  if (!sqliteReady.has(connection)) {
    connection.exec(`${createTable}; ${createIndex}`)
    sqliteReady.add(connection)
  }
  connection.exec('BEGIN IMMEDIATE')
  try {
    connection.prepare(`DELETE FROM ${table} WHERE recorded_at_ms < ?`).run(now - windowMs)
    connection.prepare(`INSERT INTO ${table} (recorded_at_ms, duration_ms, retried, with_attachments) VALUES (?, ?, ?, ?)`)
      .run(now, sample.durationMs, Number(sample.retried), Number(sample.withAttachments))
    connection.exec('COMMIT')
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}

async function readWeeklyServiceSaveSummary({ connection, kind }) {
  const summary = { windowDays }
  for (const group of groups) summary[group] = { count: 0, p50Ms: null, p95Ms: null }
  const exists = kind === 'sql'
    ? (await connection.unsafe('SELECT to_regclass($1) AS name', ['public.' + table]))[0]?.name
    : connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)?.name
  if (!exists) return summary

  // Nearest-rank percentiles use observed durations, including for a single sample.
  const statement = `WITH recent AS (
      SELECT duration_ms, retried, with_attachments FROM ${table} WHERE recorded_at_ms >= ${kind === 'sql' ? '$1' : '?'}
    ), categorized AS (
      SELECT 'all' AS segment, duration_ms FROM recent
      UNION ALL SELECT CASE WHEN retried THEN 'retried' ELSE 'firstAttempt' END, duration_ms FROM recent
      UNION ALL SELECT CASE WHEN with_attachments THEN 'withAttachments' ELSE 'withoutAttachments' END, duration_ms FROM recent
    ), ranked AS (
      SELECT segment, duration_ms, ROW_NUMBER() OVER (PARTITION BY segment ORDER BY duration_ms) AS position,
        COUNT(*) OVER (PARTITION BY segment) AS samples FROM categorized
    )
    SELECT segment, MAX(samples) AS count,
      MAX(CASE WHEN position = (samples + 1) / 2 THEN duration_ms END) AS p50,
      MAX(CASE WHEN position = (samples * 95 + 99) / 100 THEN duration_ms END) AS p95
    FROM ranked GROUP BY segment`
  const since = Date.now() - windowMs
  const rows = kind === 'sql' ? await connection.unsafe(statement, [since]) : connection.prepare(statement).all(since)
  for (const row of rows) summary[row.segment] = { count: Number(row.count), p50Ms: Number(row.p50), p95Ms: Number(row.p95) }
  return summary
}

async function weeklyServiceSaveMetrics({ connection, kind, user, method, input }) {
  assertMetricsPermission(user, method)
  if (method === 'GET') return readWeeklyServiceSaveSummary({ connection, kind })
  validateSample(input)
  await storeSample(connection, kind, input)
  return { ok: true }
}

module.exports = { assertMetricsPermission, weeklyServiceSaveMetrics, readWeeklyServiceSaveSummary }
