const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

// API local: Vite reenvía las rutas /api a este proceso durante el desarrollo.
const port = 3001
const dataDir = path.join(__dirname, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'agenda-tecnica.db'))

// Las sesiones viven sólo en memoria: al cerrar el servidor se invalidan todas.
// La cookie contiene un identificador aleatorio, nunca la contraseña ni datos del usuario.
const sessions = new Map()
const loginAttempts = new Map()
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000
const LOGIN_WINDOW = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 5

// Esquema idempotente: permite iniciar el sistema en una instalación nueva.
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS work_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (account TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS agendas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, data TEXT NOT NULL);
`)

const historicalImportPath = path.join(dataDir, 'historical-import.json')

// Los archivos históricos usaban sólo el primer nombre. Esta normalización
// preserva la trazabilidad al asociarlos con los empleados reales del sistema.
const HISTORICAL_TECHNICIAN_NAMES = {
  Santos: 'Santos Diaz',
  Mariano: 'Mariano Diaz Tillard',
  Pascual: 'Pascual Gonzalez',
  Rodrigo: 'Rodrigo Gonzalez',
  Leonardo: 'Leonardo Rivadero',
  Gonzalo: 'Gonzalo Rivadero'
}

function normalizeHistoryTechnicians(records = []) {
  return records.map(record => {
    const technicians = (record.technicians || []).map(name => HISTORICAL_TECHNICIAN_NAMES[name] || name)
    const changed = technicians.some((name, index) => name !== record.technicians?.[index])
    return changed ? { ...record, technicians } : record
  })
}

if (fs.existsSync(historicalImportPath)) {
  db.exec("DELETE FROM work_history WHERE id LIKE 'import-%'")
  const insertHistory = db.prepare('INSERT INTO work_history (id, data) VALUES (?, ?)')
  for (const record of normalizeHistoryTechnicians(JSON.parse(fs.readFileSync(historicalImportPath, 'utf8')))) {
    record.status ||= 'Completado'
    insertHistory.run(String(record.id), JSON.stringify(record))
  }
}

function rows(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data))
}

function auditSafe(record) {
  if (!record) return null
  const { password, passwordHash, ...safe } = record
  return safe
}

function writeAudit(user, action, entity, entityId, before, after) {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role }, action, entity, entityId, before: auditSafe(before), after: auditSafe(after) }
  db.prepare('INSERT INTO audit_log (id, data) VALUES (?, ?)').run(entry.id, JSON.stringify(entry))
}

function auditChanges(table, records, key, entity, user) {
  const previous = new Map(rows(table).map(record => [String(record[key]), record]))
  const incoming = new Map((records || []).map(record => [String(record[key]), record]))
  for (const [id, record] of incoming) {
    const old = previous.get(id)
    if (!old) writeAudit(user, 'Creó', entity, id, null, record)
    else if (JSON.stringify(auditSafe(old)) !== JSON.stringify(auditSafe(record))) writeAudit(user, 'Modificó', entity, id, old, record)
  }
  for (const [id, record] of previous) if (!incoming.has(id)) writeAudit(user, 'Eliminó', entity, id, record, null)
}

/** Devuelve el estado completo que consume la interfaz React al iniciar. */
function readState() {
  const agenda = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const theme = db.prepare('SELECT value FROM preferences WHERE key = ?').get('theme')
  return {
    roles: rows('roles'),
    // Nunca se exponen hashes ni contraseñas a la interfaz.
    employees: sanitizeEmployeesForRead(),
    services: rows('services'),
    history: rows('work_history'),
    customers: rows('customers'),
    agenda: agenda ? JSON.parse(agenda.data) : null,
    preferences: theme ? { theme: theme.value } : {}
  }
}

function readTechnicianState(user) {
  return {
    roles: [], employees: [], services: [], customers: [], agenda: null, preferences: {},
    history: rows('work_history').filter(record => record.technicians?.includes(user.name))
  }
}

function replaceRows(table, records, key) {
  // Sincronización diferencial: evita borrar y recrear cientos de registros
  // cuando el usuario sólo modificó un servicio, empleado o cliente.
  const existing = new Map(db.prepare(`SELECT ${key}, data FROM ${table}`).all().map(row => [String(row[key]), row.data]))
  const upsert = db.prepare(`INSERT OR REPLACE INTO ${table} (${key}, data) VALUES (?, ?)`)
  const remove = db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`)
  for (const record of records || []) {
    const recordKey = String(record[key])
    const serialized = JSON.stringify(record)
    if (existing.get(recordKey) !== serialized) upsert.run(recordKey, serialized)
    existing.delete(recordKey)
  }
  for (const recordKey of existing.keys()) remove.run(recordKey)
}

/** Guarda todas las entidades dentro de una transacción para evitar estados parciales. */
function saveState(state, user) {
  const previousEmployees = new Map(rows('employees').map(employee => [String(employee.id), employee]))
  const storedAgenda = db.prepare('SELECT data FROM agendas WHERE id = ?').get('current')
  const previousAgenda = storedAgenda ? JSON.parse(storedAgenda.data) : {}
  const nextAgenda = state.agenda || {}
  // Evita que un cliente con datos anteriores vuelva a guardar abreviaturas históricas.
  const normalizedHistory = normalizeHistoryTechnicians(state.history || [])
  const securedEmployees = (state.employees || []).map(employee => {
    const previous = previousEmployees.get(String(employee.id))
    const next = { ...employee }
    if (next.password?.trim() && next.password.trim().length < 8) throw new Error('Las contraseñas deben tener al menos 8 caracteres.')
    if (!previous && !next.password?.trim()) throw new Error('Todo empleado nuevo requiere una contraseña.')
    // En una edición sin nueva contraseña se conserva el hash existente.
    if (next.password?.trim()) next.passwordHash = hashPassword(next.password)
    else if (previous?.passwordHash) next.passwordHash = previous.passwordHash
    // Compatibilidad: la primera autenticación convierte automáticamente credenciales antiguas.
    else if (previous?.password) next.passwordHash = hashPassword(previous.password)
    delete next.password
    return next
  })
  db.exec('BEGIN')
  try {
    // El registro se realiza dentro de la misma transacción que los datos:
    // nunca queda una acción auditada que no haya sido guardada (ni al revés).
    auditChanges('roles', state.roles, 'id', 'Rol', user)
    auditChanges('employees', securedEmployees, 'id', 'Empleado', user)
    auditChanges('services', state.services, 'id', 'Tipo de servicio', user)
    auditChanges('work_history', normalizedHistory, 'id', 'Servicio / historial', user)
    auditChanges('customers', state.customers, 'account', 'Cliente', user)
    if (JSON.stringify(previousAgenda) !== JSON.stringify(nextAgenda)) writeAudit(user, 'Modificó', 'Agenda técnica', 'agenda-actual', previousAgenda, nextAgenda)
    replaceRows('roles', state.roles, 'id')
    replaceRows('employees', securedEmployees, 'id')
    replaceRows('services', state.services, 'id')
    replaceRows('work_history', normalizedHistory, 'id')
    replaceRows('customers', state.customers, 'account')
    db.prepare('INSERT OR REPLACE INTO agendas (id, data) VALUES (?, ?)').run('current', JSON.stringify(nextAgenda))
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

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(value => value.trim().split('=').map(decodeURIComponent)).filter(([key]) => key))
}

function publicEmployee(employee) {
  const { password, passwordHash, ...safeEmployee } = employee
  return safeEmployee
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
  if (!storedHash?.includes(':')) return false
  const [salt, hash] = storedHash.split(':')
  const calculated = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calculated, 'hex'))
}

function sanitizeEmployeesForRead() {
  return rows('employees').map(publicEmployee)
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie).pignus_session
  const session = token && sessions.get(token)
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token)
    return null
  }
  return session.user
}

function requireSession(req, res) {
  const user = sessionUser(req)
  if (!user) {
    send(res, 401, { error: 'Sesión requerida.' })
    return null
  }
  return user
}

function readJson(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk; if (body.length > limit) reject(new Error('Solicitud demasiado grande.')) })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) } catch { reject(new Error('Datos inválidos.')) }
    })
    req.on('error', reject)
  })
}

function loginLimited(req) {
  const ip = req.socket.remoteAddress || 'local'
  const attempt = loginAttempts.get(ip)
  if (!attempt || attempt.until < Date.now()) return false
  return attempt.count >= LOGIN_MAX_ATTEMPTS
}

function registerLoginFailure(req) {
  const ip = req.socket.remoteAddress || 'local'
  const current = loginAttempts.get(ip)
  const withinWindow = current?.until > Date.now()
  loginAttempts.set(ip, { count: withinWindow ? current.count + 1 : 1, until: Date.now() + LOGIN_WINDOW })
}

function clearLoginFailures(req) { loginAttempts.delete(req.socket.remoteAddress || 'local') }

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

/** Genera el reporte Excel compatible solicitado por gerencia, filtrado por ubicación. */
function exportHistory(res, month, category) {
  // "all" permite obtener un único reporte mensual sin perder los reportes por ubicación.
  const isAllCategories = category === 'all'
  const records = rows('work_history').filter(record => record.date?.startsWith(month) && record.service?.toLowerCase().includes('instalación de alarma') && (isAllCategories || alarmCategory(record) === category))
  const label = { docta: 'Docta Urbanización', 'nobu-town': 'Nobu Town', residencial: 'Residenciales', all: 'Todas las instalaciones de alarma' }[category] || 'Instalaciones de alarma'
  const headers = ['Fecha', 'Cliente', 'Dirección', 'Contacto', 'Técnicos asignados', 'Detalle', 'Equipo']
  const body = records.map(record => `<tr>${[record.date, record.client, record.address, record.phone, record.technicians?.join(' / '), record.detail, record.team].map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial}th{background:#173b28;color:#fff}th,td{border:1px solid #c8d5ca;padding:8px;text-align:left}h1{font-family:Arial;color:#173b28}</style></head><body><h1>Instalaciones de alarma – ${escapeHtml(label)}</h1><p>Período: ${escapeHtml(month)}</p><table><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr>${body}</table></body></html>`
  res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': `attachment; filename="instalaciones-alarma-${category}-${month}.xls"` })
  res.end(html)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = sessionUser(req)
    return user ? send(res, 200, { user }) : send(res, 401, { error: 'Sin sesión activa.' })
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (loginLimited(req)) return send(res, 429, { error: 'Demasiados intentos. Esperá 15 minutos antes de volver a intentar.' })
    return readJson(req).then(({ email, password }) => {
      const employee = rows('employees').find(item => item.status === 'Activo' && item.email?.trim().toLowerCase() === String(email || '').trim().toLowerCase())
      const legacyPassword = Buffer.from(String(employee?.password || ''))
      const suppliedPassword = Buffer.from(String(password || ''))
      const validLegacyPassword = legacyPassword.length === suppliedPassword.length && crypto.timingSafeEqual(suppliedPassword, legacyPassword)
      const valid = employee && (employee.passwordHash ? verifyPassword(password, employee.passwordHash) : validLegacyPassword)
      if (!valid) {
        registerLoginFailure(req)
        return send(res, 401, { error: 'Usuario o contraseña incorrectos.' })
      }
      // Migra contraseñas creadas antes de esta mejora sin conservar texto plano.
      if (!employee.passwordHash) {
        employee.passwordHash = hashPassword(employee.password)
        delete employee.password
        db.prepare('UPDATE employees SET data = ? WHERE id = ?').run(JSON.stringify(employee), String(employee.id))
      }
      clearLoginFailures(req)
      const user = { id: employee.id, name: employee.name, email: employee.email, role: employee.role }
      const token = crypto.randomBytes(32).toString('hex')
      sessions.set(token, { user, expiresAt: Date.now() + SESSION_MAX_AGE })
      // La auditoría de acceso permite conocer exactamente cuándo cada usuario ingresó.
      writeAudit(user, 'Inició sesión', 'Sesión', String(user.id), null, { sessionExpiresAt: new Date(Date.now() + SESSION_MAX_AGE).toISOString() })
      res.setHeader('Set-Cookie', `pignus_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}`)
      return send(res, 200, { user })
    }).catch(() => send(res, 400, { error: 'No se pudo procesar el acceso.' }))
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = parseCookies(req.headers.cookie).pignus_session
    const session = token && sessions.get(token)
    if (session) writeAudit(session.user, 'Cerró sesión', 'Sesión', String(session.user.id), { sessionExpiresAt: new Date(session.expiresAt).toISOString() }, null)
    if (token) sessions.delete(token)
    res.setHeader('Set-Cookie', 'pignus_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
    return send(res, 200, { ok: true })
  }
  if (req.method === 'GET' && url.pathname === '/api/history/export') {
    if (!requireSession(req, res)) return
    return exportHistory(res, url.searchParams.get('month') || new Date().toISOString().slice(0, 7), url.searchParams.get('category') || 'residencial')
  }
  if (req.method === 'GET' && req.url === '/api/state') {
    const user = requireSession(req, res)
    if (!user) return
    return send(res, 200, user.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'tecnico' ? readTechnicianState(user) : readState())
  }
  if (req.method === 'GET' && url.pathname === '/api/audit') {
    const user = requireSession(req, res)
    if (!user) return
    const role = user.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (role !== 'administrador') return send(res, 403, { error: 'La auditoría es exclusiva del rol Administrador.' })
    const requestedLimit = Number(url.searchParams.get('limit')) || 500
    const limit = Math.min(Math.max(requestedLimit, 1), 1000)
    return send(res, 200, { records: rows('audit_log').sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit) })
  }
  if (req.method === 'POST' && url.pathname === '/api/technician/status') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() !== 'tecnico') return send(res, 403, { error: 'Esta acción es exclusiva del rol Técnico.' })
    return readJson(req).then(({ recordId, type, observation }) => {
      const record = rows('work_history').find(item => item.id === recordId)
      const allowed = ['Completado', 'Cancelado', 'Reprogramación solicitada']
      if (!record || !record.technicians?.includes(user.name) || !allowed.includes(type) || record.technicalStatus) return send(res, 400, { error: 'No se puede actualizar este servicio.' })
      if (type !== 'Completado' && !String(observation || '').trim()) return send(res, 400, { error: 'La observación es obligatoria.' })
      const now = new Date().toISOString()
      const updated = { ...record, technicalStatus: type, technicalObservation: String(observation || '').trim(), technicalReportedAt: now, completedAt: type === 'Completado' ? now : record.completedAt, status: type === 'Completado' ? 'Completado' : 'Requiere revisión', technicianRequest: type === 'Completado' ? '' : type }
      db.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify(updated), String(record.id))
      writeAudit(user, 'Informó estado técnico', 'Servicio / historial', String(record.id), record, updated)
      return send(res, 200, { record: updated })
    }).catch(() => send(res, 400, { error: 'No se pudo informar el estado.' }))
  }
  if (req.method === 'PUT' && req.url === '/api/state') {
    const user = requireSession(req, res)
    if (!user) return
    if (user.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'tecnico') return send(res, 403, { error: 'El rol Técnico no puede modificar la agenda.' })
    readJson(req, 15_000_000).then(state => {
      saveState(state, user)
      send(res, 200, { ok: true })
    }).catch(error => { console.error(error); send(res, 400, { error: 'No se pudieron guardar los datos.' }) })
    return
  }
  send(res, 404, { error: 'Ruta no encontrada.' })
})

server.listen(port, () => console.log(`Base de datos disponible en http://localhost:${port}`))
