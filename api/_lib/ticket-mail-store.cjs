const { randomUUID } = require('node:crypto')

// Texto ISO y payload JSON mantienen el contrato de pruebas SQLite/PostgreSQL.
const MAIL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pignus_ticket_mail_cursor (
    mailbox_key TEXT PRIMARY KEY, uid_validity TEXT, last_uid INTEGER NOT NULL DEFAULT 0,
    activated_at TEXT, updated_at TEXT, last_success_at TEXT, last_error TEXT,
    lease_owner TEXT, lease_until TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pignus_ticket_mail_outbox (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, entry_id TEXT NOT NULL,
    mailbox_key TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    message_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created_at TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, last_error TEXT,
    result_applied INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS pignus_ticket_mail_outbox_pending ON pignus_ticket_mail_outbox (mailbox_key,status,next_attempt_at)',
  `CREATE TABLE IF NOT EXISTS pignus_ticket_mail_skipped (
    mailbox_key TEXT NOT NULL, uid_validity TEXT NOT NULL, uid INTEGER NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(mailbox_key,uid_validity,uid)
  )`
]

function sqlParameters(query) {
  let index = 0
  return query.replace(/\?/g, () => `$${++index}`)
}

function mailStore(query) {
  const run = (sql, params = []) => query(sql, params)
  return {
    async ensure() { for (const sql of MAIL_SCHEMA) await run(sql) },
    async acquireMailbox(key, ttlMs, now = new Date()) {
      const owner = randomUUID(), at = now.toISOString(), until = new Date(now.getTime() + ttlMs).toISOString()
      await run('INSERT INTO pignus_ticket_mail_cursor (mailbox_key) VALUES (?) ON CONFLICT(mailbox_key) DO NOTHING', [key])
      const rows = await run('UPDATE pignus_ticket_mail_cursor SET lease_owner=?,lease_until=? WHERE mailbox_key=? AND (lease_owner IS NULL OR lease_until<?) RETURNING mailbox_key', [owner, until, key, at])
      return rows.length ? owner : null
    },
    async releaseMailbox(key, owner) { await run('UPDATE pignus_ticket_mail_cursor SET lease_owner=NULL,lease_until=NULL WHERE mailbox_key=? AND lease_owner=?', [key, owner]) },
    async cursor(key) { return (await run('SELECT * FROM pignus_ticket_mail_cursor WHERE mailbox_key=?', [key]))[0] || null },
    async activate(key, owner, snapshot, now = new Date().toISOString()) {
      const last = Math.max(0, Number(snapshot.uidNext) - 1)
      await run('UPDATE pignus_ticket_mail_cursor SET uid_validity=?,last_uid=?,activated_at=?,updated_at=? WHERE mailbox_key=? AND lease_owner=? AND uid_validity IS NULL', [String(snapshot.uidValidity), last, now, now, key, owner])
      return this.cursor(key)
    },
    async advance(key, owner, uid, now = new Date().toISOString()) {
      await run('UPDATE pignus_ticket_mail_cursor SET last_uid=?,updated_at=?,last_success_at=?,last_error=NULL WHERE mailbox_key=? AND lease_owner=? AND last_uid<?', [Number(uid), now, now, key, owner, Number(uid)])
    },
    async success(key, owner, now = new Date().toISOString()) { await run('UPDATE pignus_ticket_mail_cursor SET last_success_at=?,last_error=NULL WHERE mailbox_key=? AND lease_owner=?', [now, key, owner]) },
    async failure(key, owner, failure) { await run('UPDATE pignus_ticket_mail_cursor SET last_error=? WHERE mailbox_key=? AND lease_owner=?', [JSON.stringify(failure), key, owner]) },
    async skip(key, validity, uid, reason, now = new Date().toISOString()) { await run('INSERT INTO pignus_ticket_mail_skipped (mailbox_key,uid_validity,uid,reason,created_at) VALUES (?,?,?,?,?) ON CONFLICT(mailbox_key,uid_validity,uid) DO NOTHING', [key, String(validity), Number(uid), reason, now]) },
    async recoverUncertain(key, olderThan, now = new Date().toISOString()) {
      await run("UPDATE pignus_ticket_mail_outbox SET status='uncertain',finished_at=?,last_error=?,result_applied=0 WHERE mailbox_key=? AND status='sending' AND started_at<?", [now, JSON.stringify({ code: 'MAIL_SEND_UNCERTAIN', message: 'El proceso terminó durante un envío. Verificá su entrega antes de reintentarlo.' }), key, olderThan])
    },
    async claim(key, now = new Date().toISOString()) {
      const rows = await run("UPDATE pignus_ticket_mail_outbox SET status='sending',attempts=attempts+1,started_at=?,result_applied=0 WHERE id=(SELECT id FROM pignus_ticket_mail_outbox WHERE mailbox_key=? AND status IN ('queued','retry') AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1) AND status IN ('queued','retry') RETURNING *", [now, key, now])
      const row = rows[0]
      return row ? { ...row, payload: JSON.parse(row.payload) } : null
    },
    async finish(id, status, failure = null, nextAttemptAt = new Date().toISOString()) {
      await run("UPDATE pignus_ticket_mail_outbox SET status=?,finished_at=?,last_error=?,next_attempt_at=?,result_applied=0 WHERE id=? AND status='sending'", [status, new Date().toISOString(), failure ? JSON.stringify(failure) : null, nextAttemptAt, id])
    },
    async unapplied(key, limit = 100) { return run("SELECT id,ticket_id,entry_id,status,attempts,last_error,message_id,mailbox_key FROM pignus_ticket_mail_outbox WHERE mailbox_key=? AND status NOT IN ('queued','sending') AND result_applied=0 ORDER BY created_at,id LIMIT ?", [key, limit]) },
    async applied(id, status, attempts) { await run('UPDATE pignus_ticket_mail_outbox SET result_applied=1 WHERE id=? AND status=? AND attempts=?', [id, status, attempts]) },
    async status(key) {
      const cursor = await this.cursor(key)
      const queue = await run('SELECT status,count(*) AS total FROM pignus_ticket_mail_outbox WHERE mailbox_key=? GROUP BY status', [key])
      const skipped = await run('SELECT count(*) AS total FROM pignus_ticket_mail_skipped WHERE mailbox_key=?', [key])
      return { activatedAt: cursor?.activated_at || null, lastSuccessAt: cursor?.last_success_at || null, lastError: cursor?.last_error ? JSON.parse(cursor.last_error) : null, outbound: Object.fromEntries(queue.map(row => [row.status, Number(row.total)])), skipped: Number(skipped[0]?.total || 0) }
    }
  }
}

function postgresTicketMailStore(sql) {
  const store = mailStore((query, params) => sql.unsafe(sqlParameters(query), params))
  const ensure = store.ensure
  store.ensure = async () => {
    await ensure()
    for (const table of ['pignus_ticket_mail_cursor', 'pignus_ticket_mail_outbox', 'pignus_ticket_mail_skipped']) {
      await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
      await sql.unsafe(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`)
      await sql.unsafe(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE ${table} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE ${table} FROM authenticated; END IF; END $$`)
    }
  }
  return store
}

function sqliteTicketMailStore(db) {
  return mailStore(async (query, params) => {
    const prepared = db.prepare(query)
    return /^\s*(SELECT|UPDATE[\s\S]+RETURNING)/i.test(query) ? prepared.all(...params) : (prepared.run(...params), [])
  })
}

module.exports = { MAIL_SCHEMA, sqlParameters, mailStore, postgresTicketMailStore, sqliteTicketMailStore }
