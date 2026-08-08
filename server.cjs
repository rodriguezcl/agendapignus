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

const historicalImportPath = path.join(dataDir, 'historical-import.json')
if (fs.existsSync(historicalImportPath)) {
  db.exec("DELETE FROM work_history WHERE id LIKE 'import-%'")
  const insertHistory = db.prepare('INSERT INTO work_history (id, data) VALUES (?, ?)')
  for (const record of JSON.parse(fs.readFileSync(historicalImportPath, 'utf8'))) {
    record.status ||= 'Completado'
    insertHistory.run(String(record.id), JSON.stringify(record))
  }
}

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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}

function alarmCategory(record) {
  if (record.installationZone) return record.installationZone
  const address = `${record.address || ''} ${record.client || ''}`.toLowerCase()
  if (address.includes('docta')) return 'docta'
  if (address.includes('nobu')) return 'nobu-town'
  return 'residencial'
}

function exportHistory(res, month, category) {
  const records = rows('work_history').filter(record => record.date?.startsWith(month) && record.service?.toLowerCase().includes('instalación de alarma') && alarmCategory(record) === category)
  const label = { docta: 'Docta Urbanización', 'nobu-town': 'Nobu Town', residencial: 'Residenciales' }[category] || 'Instalaciones de alarma'
  const headers = ['Fecha', 'Cliente', 'Dirección', 'Contacto', 'Técnicos asignados', 'Detalle', 'Equipo']
  const body = records.map(record => `<tr>${[record.date, record.client, record.address, record.phone, record.technicians?.join(' / '), record.detail, record.team].map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial}th{background:#173b28;color:#fff}th,td{border:1px solid #c8d5ca;padding:8px;text-align:left}h1{font-family:Arial;color:#173b28}</style></head><body><h1>Instalaciones de alarma – ${escapeHtml(label)}</h1><p>Período: ${escapeHtml(month)}</p><table><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr>${body}</table></body></html>`
  res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': `attachment; filename="instalaciones-alarma-${category}-${month}.xls"` })
  res.end(html)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && url.pathname === '/api/history/export') return exportHistory(res, url.searchParams.get('month') || new Date().toISOString().slice(0, 7), url.searchParams.get('category') || 'residencial')
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
