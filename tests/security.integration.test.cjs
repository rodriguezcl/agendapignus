const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const { dedupeAgendaTeams } = require('../scripts/rebuild-weekly-from-history.cjs')

const root = path.resolve(__dirname, '..')
const port = 32109
const origin = `http://127.0.0.1:${port}`
let temporaryDirectory
let serverProcess

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
}

function upsertJson(db, table, key, record) {
  db.prepare(`INSERT OR REPLACE INTO ${table} (${key}, data) VALUES (?, ?)`).run(String(record[key]), JSON.stringify(record))
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${origin}/api/auth/session`)).status === 401) return }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('La API de pruebas no inició a tiempo.')
}

async function login(email) {
  const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Prueba1234' }) })
  assert.equal(response.status, 200)
  return response.headers.get('set-cookie').split(';')[0]
}

async function api(pathname, cookie, options = {}) {
  return fetch(`${origin}${pathname}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } })
}

async function state(cookie) {
  const response = await api('/api/state', cookie)
  assert.equal(response.status, 200)
  return response.json()
}

test.before(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pignus-security-'))
  fs.copyFileSync(path.join(root, 'data', 'backups', 'agenda-tecnica-before-professional-test-fixes-20260811.db'), path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const roles = [
    { id: 'qa-employees-role', code: 'qa-employees', name: 'QA Empleados', description: 'Prueba', permissions: { employees: true } },
    { id: 'qa-settings-role', code: 'qa-settings', name: 'QA Configuración', description: 'Prueba', permissions: { settings: true } },
    { id: 'qa-weekly-role', code: 'qa-weekly', name: 'QA Semanal', description: 'Prueba', permissions: { weekly: true } }
  ]
  roles.forEach(role => upsertJson(db, 'roles', 'id', role))
  const employees = [
    { id: 'qa-admin', firstName: 'QA', lastName: 'Admin', name: 'QA Admin', roleId: 1, role: 'Administrador', email: 'qa-admin@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-employees', firstName: 'QA', lastName: 'Empleados', name: 'QA Empleados', roleId: 'qa-employees-role', role: 'QA Empleados', email: 'qa-employees@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-settings', firstName: 'QA', lastName: 'Configuración', name: 'QA Configuración', roleId: 'qa-settings-role', role: 'QA Configuración', email: 'qa-settings@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-weekly', firstName: 'QA', lastName: 'Semanal', name: 'QA Semanal', roleId: 'qa-weekly-role', role: 'QA Semanal', email: 'qa-weekly@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-tech', firstName: 'QA', lastName: 'Técnico', name: 'QA Técnico', roleId: 3, role: 'Técnico', email: 'qa-tech@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') }
  ]
  employees.forEach(employee => upsertJson(db, 'employees', 'id', employee))
  const history = db.prepare('SELECT id, data FROM work_history').all().map(row => ({ id: row.id, record: JSON.parse(row.data) }))
  const alarmService = db.prepare('SELECT data FROM services').all().map(row => JSON.parse(row.data)).find(service => service.code === 'alarm-installation')
  const groups = new Map()
  history.filter(({ record }) => String(record.serviceId) === String(alarmService.id)).forEach(item => { const month = item.record.date.slice(0, 7); groups.set(month, [...(groups.get(month) || []), item]) })
  const selected = [...groups.entries()].find(([, records]) => records.length >= 2)
  assert.ok(selected, 'Se necesitan dos alarmas del mismo mes para probar el filtro.')
  const [month, records] = selected
  const assigned = { ...records[0].record, technicianIds: [...new Set([...(records[0].record.technicianIds || []), 'qa-tech'])] }
  db.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify(assigned), records[0].id)
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('qa_export_month', month)
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('qa_export_included', assigned.client)
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('qa_export_excluded', records[1].record.client)
  db.close()
  serverProcess = spawn(process.execPath, ['server.cjs'], { cwd: root, env: { ...process.env, PIGNUS_PORT: String(port), PIGNUS_HOST: '127.0.0.1', PIGNUS_DATA_DIR: temporaryDirectory }, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitForServer()
})

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = new Promise(resolve => serverProcess.once('exit', resolve))
    serverProcess.kill()
    await exited
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 9) throw error; await new Promise(resolve => setTimeout(resolve, 100)) }
  }
})

test('protege rutas y agrega cabeceras de seguridad', async () => {
  const response = await api('/api/state')
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/)
})

test('sirve la aplicación compilada y conserva aisladas las rutas API', async () => {
  const page = await api('/')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(await page.text(), /<div id="root"><\/div>/)

  const missingApi = await api('/api/ruta-inexistente')
  assert.equal(missingApi.status, 404)
  assert.match(missingApi.headers.get('content-type'), /application\/json/)
})

test('un gestor de empleados no puede elevar privilegios', async () => {
  const cookie = await login('qa-employees@pignus.test')
  let current = await state(cookie)
  const administrator = current.employees.find(employee => String(employee.roleId) === '1')
  administrator.roleId = 3
  administrator.role = 'Técnico'
  current.roles.find(role => String(role.id) === '1').permissions = {}
  let response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  current = await state(cookie)
  assert.equal(String(current.employees.find(employee => employee.id === administrator.id).roleId), '1')
  assert.equal(current.roles.find(role => String(role.id) === '1').permissions.audit, true)
  current.employees.push({ id: 'rogue-admin', firstName: 'Rogue', lastName: 'Admin', name: 'Rogue Admin', roleId: 1, role: 'Administrador', email: 'rogue@pignus.test', phone: '', status: 'Activo', password: 'Prueba1234' })
  response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 403)
})

test('un permiso de configuración no permite alterar roles protegidos', async () => {
  const cookie = await login('qa-settings@pignus.test')
  let current = await state(cookie)
  current.roles.find(role => role.id === 'qa-settings-role').code = 'administrator'
  current.roles.find(role => role.id === 'qa-settings-role').permissions = { audit: true, settings: true, employees: true }
  const response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  current = await state(cookie)
  assert.equal(current.roles.find(role => role.id === 'qa-settings-role').code, 'qa-settings')
})

test('separa permisos de agenda semanal y diaria', async () => {
  const cookie = await login('qa-weekly@pignus.test')
  let current = await state(cookie)
  const originalDate = current.agenda.date
  const weeklyKey = '2099-01-05'
  current.agenda.date = '2099-01-01'
  current.agenda.teams = []
  current.agenda.weekly = { ...(current.agenda.weekly || {}), [weeklyKey]: { teams: [] } }
  const response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  current = await state(cookie)
  assert.equal(current.agenda.date, originalDate)
  assert.ok(current.agenda.weekly[weeklyKey])
})

test('rechaza escrituras con una revisión antigua', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const original = await state(cookie)
  const first = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(original) })
  assert.equal(first.status, 200)
  const stale = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(original) })
  assert.equal(stale.status, 409)
})

test('revoca inmediatamente una sesión al desactivar el empleado', async () => {
  const adminCookie = await login('qa-admin@pignus.test')
  const employeeCookie = await login('qa-settings@pignus.test')
  const current = await state(adminCookie)
  current.employees.find(employee => employee.id === 'qa-settings').status = 'Inactivo'
  const update = await api('/api/state', adminCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(update.status, 200)
  assert.equal((await api('/api/state', employeeCookie)).status, 401)
})

test('la exportación técnica contiene solamente trabajos asignados', async () => {
  const cookie = await login('qa-tech@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'), { readOnly: true })
  const preference = key => db.prepare('SELECT value FROM preferences WHERE key = ?').get(key).value
  const month = preference('qa_export_month'), included = preference('qa_export_included'), excluded = preference('qa_export_excluded')
  db.close()
  const response = await api(`/api/history/export?month=${month}&category=all`, cookie)
  assert.equal(response.status, 200)
  const report = await response.text()
  assert.ok(report.includes(included))
  assert.ok(!report.includes(excluded))
})

test('limpia solamente la agenda diaria mediante endpoint dedicado', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const before = await state(cookie)
  const response = await api('/api/agenda/daily/clear', cookie, { method: 'POST' })
  assert.equal(response.status, 200)
  const after = await state(cookie)
  assert.deepEqual(after.agenda.weekly, before.agenda.weekly)
  assert.equal(after.agenda.teams.length, 1)
  assert.equal(after.agenda.teams[0].tasks.length, 0)
})

test('rechaza cuerpos excesivos sin derribar la API', async () => {
  const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(60_000), password: 'Prueba1234' }) })
  assert.equal(response.status, 400)
  assert.equal((await api('/api/state')).status, 401)
})

test('normaliza como pendiente un servicio nuevo sin estado', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const current = await state(cookie)
  const source = current.history[0]
  const id = `qa-history-without-status-${Date.now()}`
  current.history.unshift({ ...source, id, status: undefined })
  const response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  const saved = await state(cookie)
  assert.equal(saved.history.find(record => record.id === id).status, 'Pendiente')
})

test('registra de forma confiable quién creó y quién actualizó un servicio', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  let current = await state(administratorCookie)
  const base = current.history[0]
  const id = `trace-${Date.now()}`
  current.history.push({
    ...base,
    id,
    sourceTaskId: id,
    detail: 'Servicio de prueba de trazabilidad',
    status: 'Pendiente',
    createdBy: { id: 'falso', name: 'Usuario falso', role: 'Administrador', at: new Date().toISOString() }
  })
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  current = await state(administratorCookie)
  let record = current.history.find(item => item.id === id)
  assert.equal(record.createdBy.name, 'QA Admin')
  assert.equal(record.lastUpdatedBy.name, 'QA Admin')

  current.employees.find(employee => employee.id === 'qa-settings').status = 'Activo'
  current.roles.find(role => role.id === 'qa-settings-role').permissions = { settings: true, history: true }
  response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  const settingsCookie = await login('qa-settings@pignus.test')
  current = await state(settingsCookie)
  record = current.history.find(item => item.id === id)
  record.detail = 'Detalle actualizado por otra sesión'
  response = await api('/api/state', settingsCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  current = await state(administratorCookie)
  record = current.history.find(item => item.id === id)
  assert.equal(record.createdBy.name, 'QA Admin')
  assert.equal(record.lastUpdatedBy.name, 'QA Configuración')
})

test('elimina copias de una misma tarea sin confundir servicios distintos', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'uno', tasks: [{ historyId: 'work-1', taskId: 'task-1', client: 'CLIENTE A' }, { historyId: 'work-1', taskId: 'task-1', client: 'CLIENTE A' }] },
    { teamId: 'dos', tasks: [{ historyId: 'work-2', taskId: 'task-2', client: 'CLIENTE A' }] }
  ])
  assert.equal(teams[0].tasks.length, 1)
  assert.equal(teams[1].tasks.length, 1)
})
