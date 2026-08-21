const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '..')
const databasePath = path.resolve(process.argv[2] || path.join(root, 'data', 'agenda-tecnica.db'))
const dataDirectory = path.dirname(databasePath)
const allowedDataDirectory = path.join(root, 'data')
const backupDirectory = path.join(dataDirectory, 'backups')
const limit = 100

if (!databasePath.startsWith(`${allowedDataDirectory}${path.sep}`)) throw new Error('La base de datos no está dentro del directorio esperado.')

fs.mkdirSync(backupDirectory, { recursive: true })
const db = new DatabaseSync(databasePath)
db.exec('PRAGMA busy_timeout = 30000')

const before = db.prepare('SELECT COUNT(*) AS total FROM audit_log').get().total
const latest = db.prepare('SELECT id, data FROM audit_log ORDER BY rowid DESC LIMIT ?').all(limit)
const backupPath = path.join(backupDirectory, `audit-last-${limit}-before-compaction.json`)
fs.writeFileSync(backupPath, JSON.stringify(latest.map(row => JSON.parse(row.data)), null, 2))

db.exec('BEGIN IMMEDIATE')
try {
  db.exec('DROP TABLE IF EXISTS audit_log_compact')
  db.exec('CREATE TABLE audit_log_compact (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
  const insert = db.prepare('INSERT INTO audit_log_compact (id, data) VALUES (?, ?)')
  latest.slice().reverse().forEach(row => insert.run(String(row.id), row.data))
  db.exec('DROP TABLE audit_log')
  db.exec('ALTER TABLE audit_log_compact RENAME TO audit_log')
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
db.exec('VACUUM')
const after = db.prepare('SELECT COUNT(*) AS total FROM audit_log').get().total
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
db.close()

console.log(JSON.stringify({ databasePath, backupPath, before, after, integrity }))
