const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')

const port = 3001
const dataDir = path.join(__dirname, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'agenda-tecnica.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS work_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (account TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS agendas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

function rows(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data))
}

function readState() {
  const agenda = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const theme = db.prepare('SELECT value FROM preferences WHERE key = ?').get('theme')
  return {
    roles: rows('roles'),
    employees: rows('employees'),
    services: rows('services'),
    history: rows('work_history'),
    customers: rows('customers'),
    agenda: agenda ? JSON.parse(agenda.data) : null,
    preferences: theme ? { theme: theme.value } : {}
  }
}

function replaceRows(table, records, key) {
  db.prepare(`DELETE FROM ${table}`).run()
  const insert = db.prepare(`INSERT INTO ${table} (${key}, data) VALUES (?, ?)`)
  for (const record of records || []) insert.run(String(record[key]), JSON.stringify(record))
}

function saveState(state) {
  db.exec('BEGIN')
  try {
    replaceRows('roles', state.roles, 'id')
    replaceRows('employees', state.employees, 'id')
    replaceRows('services', state.services, 'id')
    replaceRows('work_history', state.history, 'id')
    replaceRows('customers', state.customers, 'account')
    db.prepare('INSERT OR REPLACE INTO agendas (id, data) VALUES (?, ?)').run('current', JSON.stringify(state.agenda || {}))
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('theme', state.preferences?.theme || 'light')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, readState())
  if (req.method === 'PUT' && req.url === '/api/state') {
    let body = ''
    req.on('data', chunk => { body += chunk; if (body.length > 15_000_000) req.destroy() })
    req.on('end', () => {
      try { saveState(JSON.parse(body)); send(res, 200, { ok: true }) }
      catch (error) { console.error(error); send(res, 400, { error: 'No se pudieron guardar los datos.' }) }
    })
    return
  }
  send(res, 404, { error: 'Ruta no encontrada.' })
})

server.listen(port, () => console.log(`Base de datos disponible en http://localhost:${port}`))
