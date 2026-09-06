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

function createFixtureDatabase(databasePath) {
  const db = new DatabaseSync(databasePath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE roles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE employees (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE services (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE work_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE customers (account TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE agendas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `)
  const allPermissions = { dashboard: true, weekly: true, agenda: true, history: true, accounts: true, employees: true, services: true, settings: true, audit: true }
  ;[
    { id: 1, code: 'administrator', name: 'Administrador', description: 'Administración de prueba', permissions: allPermissions },
    { id: 2, code: 'coordinator', name: 'Coordinador', description: 'Coordinación de prueba', permissions: { dashboard: true, weekly: true, agenda: true, history: true, accounts: true } },
    { id: 3, code: 'technician', name: 'Técnico', description: 'Técnico de prueba', permissions: { dashboard: true, agenda: true } }
  ].forEach(role => upsertJson(db, 'roles', 'id', role))
  const services = [
    { id: 'qa-alarm', code: 'alarm-installation', category: 'installation', name: 'Instalación de alarma', description: 'Alta de prueba', status: 'Activo' },
    { id: 'qa-retirement', code: 'equipment-retirement', category: 'service', name: 'Retiro de equipo', description: 'Baja de prueba', status: 'Activo' },
    { id: 'qa-service', code: 'technical-service', category: 'service', name: 'Service técnico', description: 'Servicio de prueba', status: 'Activo' }
  ]
  services.forEach(service => upsertJson(db, 'services', 'id', service))
  const customers = [
    { customerId: 'qa-customer-a', kind: 'subscriber', account: 'PIG-9001', name: 'CLIENTE INCLUIDO QA', street: 'Calle QA 100', address: 'Calle QA 100', locality: 'Córdoba', province: 'Córdoba', phone: '3510000001', type: 'Residencial', fields: {} },
    { customerId: 'qa-customer-b', kind: 'subscriber', account: 'PIG-9002', name: 'CLIENTE EXCLUIDO QA', street: 'Calle QA 200', address: 'Calle QA 200', locality: 'Córdoba', province: 'Córdoba', phone: '3510000002', type: 'Residencial', fields: {} }
  ]
  customers.forEach(customer => upsertJson(db, 'customers', 'account', customer))
  const baseHistory = { date: '2096-03-10', time: '09:00', serviceId: 'qa-alarm', service: 'Instalación de alarma', installationZone: 'residencial', technicians: [], technicianIds: [], status: 'Completado', team: 'Equipo 1' }
  ;[
    { ...baseHistory, id: 'qa-history-included', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'CLIENTE INCLUIDO QA', address: 'Calle QA 100', phone: '3510000001' },
    { ...baseHistory, id: 'qa-history-excluded', date: '2096-03-11', team: 'Equipo 2', customerId: 'qa-customer-b', clientAccount: 'PIG-9002', client: 'CLIENTE EXCLUIDO QA', address: 'Calle QA 200', phone: '3510000002' }
  ].forEach(record => upsertJson(db, 'work_history', 'id', record))
  upsertJson(db, 'agendas', 'id', { id: 'current', date: '2096-03-12', teams: [{ teamId: 'qa-team', memberIds: [], members: [], tasks: [] }], weekly: { '2096-03-12': { teams: [] } } })
  db.prepare('INSERT INTO preferences (key, value) VALUES (?, ?), (?, ?), (?, ?)').run('state_revision', '0', 'theme', 'light', 'vehicles', JSON.stringify([{ id: 'qa-vehicle', brand: 'Ford', model: 'Ka', year: 2024, mileage: 1000, plate: 'QA123AA', insuranceExpiresOn: '2099-12-31' }]))
  db.close()
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
  const databasePath = path.join(temporaryDirectory, 'agenda-tecnica.db')
  createFixtureDatabase(databasePath)
  const db = new DatabaseSync(databasePath)
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
  const publicDirectory = path.join(temporaryDirectory, 'public')
  fs.mkdirSync(publicDirectory)
  fs.writeFileSync(path.join(publicDirectory, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>')
  serverProcess = spawn(process.execPath, ['server.cjs'], { cwd: root, env: { ...process.env, PIGNUS_PORT: String(port), PIGNUS_HOST: '127.0.0.1', PIGNUS_DATA_DIR: temporaryDirectory, PIGNUS_PUBLIC_DIR: publicDirectory }, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitForServer()
  // La reconstrucción inicial agrupa técnicos por equipos mensuales. Restauramos
  // un segundo registro sin asignación para probar el filtro de exportación sin
  // depender de datos operativos ni del estado previo de una instalación real.
  const normalizedDb = new DatabaseSync(databasePath)
  const excludedRow = normalizedDb.prepare('SELECT data FROM work_history WHERE id = ?').get(records[1].id)
  const excludedRecord = JSON.parse(excludedRow.data)
  normalizedDb.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify({ ...excludedRecord, technicians: [], technicianIds: [] }), records[1].id)
  normalizedDb.close()
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

test('el seguro vehicular sólo se carga como administrador y se descarga con sesión técnica', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const technicianCookie = await login('qa-tech@pignus.test')
  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}`
  let response = await api('/api/vehicle-insurance/qa-vehicle', technicianCookie, { method: 'POST', body: JSON.stringify({ fileName: 'seguro.pdf', pdf }) })
  assert.equal(response.status, 403)
  const before = await state(administratorCookie)
  const vehicle = before.vehicles.find(item => item.id === 'qa-vehicle')
  response = await api('/api/vehicle-insurance/qa-vehicle', administratorCookie, { method: 'POST', body: JSON.stringify({ fileName: 'seguro-qa.pdf', pdf, vehicle, insuranceExpiresOn: '2099-12-31', revision: before.revision }) })
  assert.equal(response.status, 200)
  const uploaded = await response.json()
  assert.equal(uploaded.vehicle.insuranceFileName, 'seguro-qa.pdf')
  assert.equal(uploaded.vehicle.insuranceExpiresOn, '2099-12-31')
  const persisted = await state(administratorCookie)
  assert.equal(persisted.vehicles.find(item => item.id === 'qa-vehicle').insuranceFileName, 'seguro-qa.pdf')
  const staleUpload = await api('/api/vehicle-insurance/qa-vehicle', administratorCookie, { method: 'POST', body: JSON.stringify({ fileName: 'seguro-no-debe-guardarse.pdf', pdf, vehicle, insuranceExpiresOn: '2099-12-31', revision: before.revision }) })
  assert.equal(staleUpload.status, 409)
  response = await api('/api/vehicle-insurance/qa-vehicle', technicianCookie)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition'), /seguro-qa\.pdf/)
  response = await api('/api/vehicle-insurance/qa-vehicle', null)
  assert.equal(response.status, 401)
})

test('completar un control vehicular almacena la foto y permite volver a consultarla', async () => {
  const technicianCookie = await login('qa-tech@pignus.test')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const record = { id: 'qa-vehicle-control-photo', date: today, time: '00:00', client: 'Ford Ka · QA123AA', service: 'Control semanal de vehículo', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'], vehicleControl: true, vehicleId: 'qa-vehicle', vehicleMileageAtScheduling: 1000 }
  const databasePath = path.join(temporaryDirectory, 'agenda-tecnica.db')
  const setupDb = new DatabaseSync(databasePath)
  upsertJson(setupDb, 'work_history', 'id', record)
  setupDb.close()
  const photoBytes = Buffer.from('foto-interior-qa')
  const response = await api('/api/technician/status', technicianCookie, { method: 'POST', body: JSON.stringify({ recordId: record.id, type: 'Completado', observation: '', vehicleMileage: 1001, vehiclePhoto: `data:image/jpeg;base64,${photoBytes.toString('base64')}` }) })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.record.vehiclePhotoUrl, `/api/vehicle-control/photo/${record.id}`)
  const photoResponse = await api(payload.record.vehiclePhotoUrl, technicianCookie)
  assert.equal(photoResponse.status, 200)
  assert.equal(photoResponse.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), photoBytes)
  const verificationDb = new DatabaseSync(databasePath)
  const storedPhoto = verificationDb.prepare('SELECT vehicle_id, mime_type, length(photo_data) AS bytes FROM vehicle_control_photos WHERE record_id = ?').get(record.id)
  assert.equal(storedPhoto.vehicle_id, 'qa-vehicle')
  assert.equal(storedPhoto.mime_type, 'image/jpeg')
  assert.equal(storedPhoto.bytes, photoBytes.length)
  const vehicles = JSON.parse(verificationDb.prepare("SELECT value FROM preferences WHERE key = 'vehicles'").get().value)
  assert.equal(vehicles.find(item => item.id === 'qa-vehicle').mileage, 1001)
  verificationDb.prepare('DELETE FROM vehicle_control_photos WHERE record_id = ?').run(record.id)
  verificationDb.prepare('DELETE FROM work_history WHERE id = ?').run(record.id)
  verificationDb.prepare("UPDATE preferences SET value = ? WHERE key = 'vehicles'").run(JSON.stringify(vehicles.map(item => item.id === 'qa-vehicle' ? { ...item, mileage: 1000 } : item)))
  verificationDb.close()
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

test('gestiona solicitudes de contraseña únicamente para administradores', async () => {
  let response = await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ email: 'inexistente@pignus.test', password: 'Prueba1234' }) })
  assert.equal(response.status, 404)
  assert.match((await response.json()).error, /no está dado de alta/i)

  response = await api('/api/auth/password-reset-requests', null, { method: 'POST', body: JSON.stringify({ email: 'inexistente@pignus.test' }) })
  assert.equal(response.status, 404)
  assert.match((await response.json()).error, /contacto con un Administrador/i)

  response = await api('/api/auth/password-reset-requests', null, { method: 'POST', body: JSON.stringify({ email: 'QA-TECH@PIGNUS.TEST' }) })
  assert.equal(response.status, 200)
  response = await api('/api/auth/password-reset-requests', null, { method: 'POST', body: JSON.stringify({ email: 'qa-tech@pignus.test' }) })
  assert.equal(response.status, 200)

  const nonAdministratorCookie = await login('qa-employees@pignus.test')
  response = await api('/api/auth/password-reset-requests', nonAdministratorCookie)
  assert.equal(response.status, 403)

  const administratorCookie = await login('qa-admin@pignus.test')
  response = await api('/api/auth/password-reset-requests', administratorCookie)
  assert.equal(response.status, 200)
  let payload = await response.json()
  const matching = payload.requests.filter(request => request.email === 'qa-tech@pignus.test')
  assert.equal(matching.length, 1, 'Las solicitudes repetidas deben consolidarse por correo.')

  response = await api('/api/auth/password-reset-requests', administratorCookie, { method: 'DELETE', body: JSON.stringify({ id: matching[0].id }) })
  assert.equal(response.status, 200)
  response = await api('/api/auth/password-reset-requests', administratorCookie)
  payload = await response.json()
  assert.equal(payload.requests.some(request => request.email === 'qa-tech@pignus.test'), false)
})

test('el último ingreso invalida cualquier sesión anterior del mismo correo', async () => {
  const firstCookie = await login('qa-tech@pignus.test')
  let statusResponse = await api('/api/auth/session-status', firstCookie)
  assert.equal(statusResponse.status, 200)
  let statusPayload = await statusResponse.json()
  assert.deepEqual(Object.keys(statusPayload).sort(), ['active', 'expiresAt'])
  assert.equal(statusPayload.active, true)

  const activityResponse = await api('/api/auth/activity', firstCookie, { method: 'POST' })
  assert.equal(activityResponse.status, 200)
  assert.match(activityResponse.headers.get('set-cookie'), /Max-Age=1800/)

  const secondCookie = await login('qa-tech@pignus.test')
  assert.notEqual(firstCookie, secondCookie)
  const displaced = await api('/api/auth/session-status', firstCookie)
  assert.equal(displaced.status, 401)
  const payload = await displaced.json()
  assert.equal(payload.code, 'SESSION_ENDED')
  assert.match(payload.error, /otro dispositivo|vencido/i)
  statusResponse = await api('/api/auth/session-status', secondCookie)
  statusPayload = await statusResponse.json()
  assert.equal(statusPayload.active, true)
})

test('el ingreso y la recuperación de sesión entregan el estado inicial sin una segunda carga', async () => {
  const loginResponse = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa-admin@pignus.test', password: 'Prueba1234' }) })
  assert.equal(loginResponse.status, 200)
  const loginPayload = await loginResponse.json()
  assert.equal(loginPayload.user.email, 'qa-admin@pignus.test')
  assert.ok(Array.isArray(loginPayload.state.history))
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0]
  const sessionResponse = await api('/api/auth/session', cookie)
  assert.equal(sessionResponse.status, 200)
  const sessionPayload = await sessionResponse.json()
  assert.equal(sessionPayload.state.revision, loginPayload.state.revision)
  assert.ok(sessionPayload.state.agenda)
  const logoutResponse = await api('/api/auth/logout', cookie, { method: 'POST', body: JSON.stringify({ discardDailyAgenda: false }) })
  assert.equal(logoutResponse.status, 200)
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
  const conflict = await stale.json()
  assert.equal(conflict.code, 'STATE_REVISION_CONFLICT')
  assert.equal(Number.isInteger(conflict.revision), true)
})

test('fusiona dos escrituras concurrentes sobre registros diferentes', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const baseline = await state(cookie)
  const left = { ...baseline, base: baseline, services: [...baseline.services, { id: 'qa-concurrent-left', name: 'Servicio concurrente izquierdo', description: '', estimatedMinutes: 60, status: 'Activo' }] }
  const right = { ...baseline, base: baseline, services: [...baseline.services, { id: 'qa-concurrent-right', name: 'Servicio concurrente derecho', description: '', estimatedMinutes: 60, status: 'Activo' }] }

  const responses = await Promise.all([
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(left) }),
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(right) })
  ])
  assert.deepEqual(responses.map(response => response.status), [200, 200])

  const persisted = await state(cookie)
  const concurrentIds = persisted.services.filter(service => String(service.id).startsWith('qa-concurrent-')).map(service => service.id)
  assert.equal(concurrentIds.length, 2)
})

test('rechaza dos escrituras concurrentes sobre el mismo campo', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const baseline = await state(cookie)
  const target = baseline.services.find(service => service.id === 'qa-service')
  const update = description => ({ ...baseline, base: baseline, services: baseline.services.map(service => service.id === target.id ? { ...service, description } : service) })

  const responses = await Promise.all([
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(update('Cambio concurrente A')) }),
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(update('Cambio concurrente B')) })
  ])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
  const conflict = await responses.find(response => response.status === 409).json()
  assert.equal(conflict.code, 'STATE_WRITE_CONFLICT')
  assert.match(conflict.conflictPath, /services\[id:qa-service\]\.description/)
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

test('el historial contextual del técnico es de solo lectura y registra quién informó', async () => {
  const cookie = await login('qa-tech@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const records = [
    { id: 'qa-tech-current', date: today, time: '00:00', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] },
    { id: 'qa-tech-empty-observation', date: today, time: '00:00', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] },
    { id: 'qa-tech-context', date: '2095-01-10', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Completado', technicianIds: ['otro-tecnico'], technicians: ['Otro Técnico'], technicalObservation: 'Revisar magnético.' },
    { id: 'qa-tech-private', date: '2095-01-10', customerId: 'qa-customer-b', clientAccount: 'PIG-9002', client: 'PIG-9002 CLIENTE EXCLUIDO QA', service: 'Service técnico', status: 'Completado', technicianIds: ['otro-tecnico'], technicians: ['Otro Técnico'] }
  ]
  records.forEach(record => upsertJson(db, 'work_history', 'id', record))
  db.close()

  const visible = await state(cookie)
  assert.ok(visible.history.some(record => record.id === 'qa-tech-current'))
  assert.ok(visible.history.some(record => record.id === 'qa-tech-context'))
  assert.equal(visible.history.some(record => record.id === 'qa-tech-private'), false)
  assert.deepEqual(visible.customers, [])

  // Conserva la misma sesión: simula que Administración agrega un servicio
  // después de que el técnico ya abrió su agenda.
  const addedDuringSession = { id: 'qa-tech-added-during-session', date: today, time: '14:30', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] }
  const liveUpdateDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  upsertJson(liveUpdateDb, 'work_history', 'id', addedDuringSession)
  liveUpdateDb.close()
  const refreshedDuringSession = await state(cookie)
  assert.ok(refreshedDuringSession.history.some(record => record.id === addedDuringSession.id))

  const futureVehicleControl = { id: 'qa-tech-future-vehicle-control', date: '2999-08-29', time: '15:30', client: 'Ford Ka · QA123AA', service: 'Control semanal de vehículo', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'], vehicleControl: true, vehicleId: 'qa-vehicle' }
  const vehicleControlDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  upsertJson(vehicleControlDb, 'work_history', 'id', futureVehicleControl)
  vehicleControlDb.close()
  try {
    const earlyVehicleControl = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: futureVehicleControl.id, type: 'Completado', observation: '', vehicleMileage: 1, vehiclePhoto: 'data:image/jpeg;base64,YQ==' }) })
    assert.equal(earlyVehicleControl.status, 409)
    assert.match((await earlyVehicleControl.json()).error, /se habilita el/i)
  } finally {
    const cleanupDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
    cleanupDb.prepare('DELETE FROM work_history WHERE id = ?').run(futureVehicleControl.id)
    cleanupDb.close()
  }

  const withoutObservation = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-empty-observation', type: 'Completado', observation: '   ' }) })
  assert.equal(withoutObservation.status, 400)
  assert.match((await withoutObservation.json()).error, /observación es obligatoria/i)

  const response = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-current', type: 'Completado', observation: 'Trabajo completado; revisar magnético en la próxima visita.' }) })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.record.technicalReportedById, 'qa-tech')
  assert.equal(payload.record.technicalReportedByName, 'QA Técnico')
  assert.match(payload.record.technicalObservation, /revisar magnético/i)

  const repeated = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-current', type: 'Completado', observation: 'Trabajo completado; revisar magnético en la próxima visita.' }) })
  assert.equal(repeated.status, 200)
  const repeatedPayload = await repeated.json()
  assert.equal(repeatedPayload.record.technicalReportedAt, payload.record.technicalReportedAt)

  const forbidden = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-context', type: 'Completado', observation: 'No autorizado' }) })
  assert.equal(forbidden.status, 403)
})

test('ordena las instalaciones por fecha en Excel y PDF', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const alarmService = db.prepare('SELECT data FROM services').all().map(row => JSON.parse(row.data)).find(service => service.code === 'alarm-installation')
  assert.ok(alarmService)
  const base = { serviceId: alarmService.id, service: alarmService.name, installationZone: 'docta', address: 'Dirección QA', phone: '3510000000', technicians: ['QA Técnico'], technicianIds: ['qa-tech'], status: 'Completado' }
  const testRecords = [
    { ...base, id: 'qa-installation-oldest', date: '2097-04-01', time: '10:00', client: 'INSTALACIÓN ANTIGUA QA' },
    { ...base, id: 'qa-installation-newest-late', date: '2097-04-03', time: '15:00', client: 'INSTALACIÓN RECIENTE TARDE QA' },
    { ...base, id: 'qa-installation-middle', date: '2097-04-02', time: '09:00', client: 'INSTALACIÓN INTERMEDIA QA' },
    { ...base, id: 'qa-installation-newest-early', date: '2097-04-03', time: '08:00', client: 'INSTALACIÓN RECIENTE TEMPRANO QA' }
  ]
  testRecords.forEach(record => upsertJson(db, 'work_history', 'id', record))
  db.close()

  const excelResponse = await api('/api/history/export?month=2097-04&category=docta', cookie)
  assert.equal(excelResponse.status, 200)
  const report = await excelResponse.text()
  const positions = testRecords.map(record => report.indexOf(record.client))
  assert.ok(positions.every(position => position >= 0))
  assert.ok(positions[3] < positions[1], 'En una misma fecha, la hora más temprana debe aparecer primero.')
  assert.ok(positions[0] < positions[2] && positions[2] < positions[3], 'Las fechas deben aparecer desde la más antigua hasta la más reciente.')

  const pdfResponse = await api('/api/history/export?month=2097-04&category=docta&format=pdf', cookie)
  assert.equal(pdfResponse.status, 200)
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf')
  const pdf = Buffer.from(await pdfResponse.arrayBuffer())
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')

  const cleanupDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  cleanupDb.prepare(`DELETE FROM work_history WHERE id IN (${testRecords.map(() => '?').join(', ')})`).run(...testRecords.map(record => record.id))
  cleanupDb.close()
})

test('exporta en Excel únicamente las bajas completadas del mes solicitado', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const retirement = db.prepare('SELECT data FROM services').all().map(row => JSON.parse(row.data)).find(service => String(service.name || '').toLocaleLowerCase('es-AR').includes('retiro de equipo'))
  assert.ok(retirement)
  const base = { date: '2098-05-12', serviceId: retirement.id, service: retirement.name, address: 'Dirección QA', phone: '3510000000', technicians: ['QA Técnico'], technicianIds: ['qa-tech'], detail: 'Retiro de prueba', team: 'Equipo 1' }
  upsertJson(db, 'work_history', 'id', { ...base, id: 'qa-retirement-export-complete', client: 'BAJA COMPLETADA QA', status: 'Completado' })
  upsertJson(db, 'work_history', 'id', { ...base, id: 'qa-retirement-export-pending', client: 'BAJA PENDIENTE QA', status: 'Pendiente' })
  db.close()
  const response = await api('/api/history/export?month=2098-05&category=retirements', cookie)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition') || '', /bajas-servicio-2098-05\.xls/)
  const report = await response.text()
  const pdfResponse = await api('/api/history/export?month=2098-05&category=retirements&format=pdf', cookie)
  assert.equal(pdfResponse.status, 200)
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf')
  assert.match(pdfResponse.headers.get('content-disposition') || '', /bajas-servicio-2098-05\.pdf/)
  const pdf = Buffer.from(await pdfResponse.arrayBuffer())
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
  const cleanupDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  cleanupDb.prepare('DELETE FROM work_history WHERE id IN (?, ?)').run('qa-retirement-export-complete', 'qa-retirement-export-pending')
  cleanupDb.close()
  assert.ok(report.includes('BAJA COMPLETADA QA'))
  assert.ok(!report.includes('BAJA PENDIENTE QA'))
  assert.ok(report.includes('PIGNUS · Gestión operativa'))
  assert.ok(report.includes('class="text-value contact"'))
  assert.ok(!report.includes('<th>Equipo</th>'))
  assert.ok(!report.includes('<th>Detalle</th>'))
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

test('conserva únicamente el autor original de carga de un servicio', async () => {
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
  assert.equal(record.lastUpdatedBy, undefined)

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
  assert.equal(record.lastUpdatedBy, undefined)
})

test('limita la auditoría almacenada y visible a los últimos 100 registros', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const current = await state(administratorCookie)
  current.services.push(...Array.from({ length: 105 }, (_, index) => ({ id: `qa-audit-service-${index}`, code: `qa-audit-service-${index}`, name: `Servicio de auditoría ${index}`, description: 'Prueba del límite', category: 'service', status: 'Activo' })))
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  response = await api('/api/audit?limit=500', administratorCookie)
  assert.equal(response.status, 200)
  const records = (await response.json()).records
  assert.equal(records.length, 100)
  assert.equal(Object.hasOwn(records[0], 'before'), false)
  assert.equal(Object.hasOwn(records[0], 'after'), false)
  const detailResponse = await api(`/api/audit/${encodeURIComponent(records[0].id)}`, administratorCookie)
  assert.equal(detailResponse.status, 200)
  assert.equal((await detailResponse.json()).record.id, records[0].id)
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM audit_log').get().total, 100)
  db.close()
})

test('rechaza clientes nuevos sin dirección y completa abonados importados', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  let current = await state(administratorCookie)
  current.customers.push({ customerId: 'qa-client-incomplete', kind: 'client', account: 'CLI-9998', name: 'CLIENTE INCOMPLETO', street: '', address: '', locality: '', province: '', phone: '', type: '', fields: {} })
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 400)

  current = await state(administratorCookie)
  current.customers.push({ customerId: 'qa-client-without-contact', kind: 'client', account: 'CLI-9997', name: 'CLIENTE SIN CONTACTO', street: 'Calle QA 100', address: 'Calle QA 100', locality: '', province: '', phone: '', type: '', fields: {} })
  response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 400)

  current = await state(administratorCookie)
  current.customers.push({ customerId: 'qa-subscriber-incomplete', kind: 'subscriber', account: 'PIG-999998', name: '', street: '', address: '', locality: '', province: '', phone: '', type: '', fields: {} })
  response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  current = await state(administratorCookie)
  const imported = current.customers.find(customer => customer.customerId === 'qa-subscriber-incomplete')
  assert.equal(imported.name, '-')
  assert.equal(imported.street, '-')
  assert.equal(imported.address, '-')
  assert.equal(imported.phone, '-')
})

test('mantiene vinculados los históricos cuando una baja convierte PIG en CLI', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  let current = await state(administratorCookie)
  const customerId = 'qa-converted-customer'
  const originalAccount = 'PIG-999997'
  const base = current.history[0]
  const retirement = current.services.find(service => String(service.name).toLocaleLowerCase('es-AR').includes('retiro de equipo'))
  assert.ok(retirement)
  current.customers.push({ customerId, kind: 'subscriber', account: originalAccount, name: 'CLIENTE CONVERTIDO QA', street: 'Calle QA 123', address: 'Calle QA 123', locality: '', province: '', phone: '3515550101', type: 'Residencial', fields: {} })
  current.history.push(
    { ...base, id: 'qa-before-conversion', date: '2020-01-01', time: '10:00', customerId, clientAccount: originalAccount, client: `${originalAccount} CLIENTE CONVERTIDO QA`, status: 'Completado' },
    { ...base, id: 'qa-retirement-conversion', date: '2020-01-01', time: '10:00', customerId, clientAccount: originalAccount, client: `${originalAccount} CLIENTE CONVERTIDO QA`, serviceId: retirement.id, service: retirement.name, status: 'Completado' }
  )
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200)
  current = await state(administratorCookie)
  const converted = current.customers.find(customer => customer.customerId === customerId)
  assert.equal(converted.kind, 'client')
  assert.equal(converted.convertedFromAccount, originalAccount)
  for (const id of ['qa-before-conversion', 'qa-retirement-conversion']) {
    const record = current.history.find(item => item.id === id)
    assert.equal(record.customerId, customerId)
    assert.equal(record.clientAccount, converted.account)
    assert.match(record.client, new RegExp(`^${converted.account}`))
  }
  assert.equal(current.customers.filter(customer => customer.name === 'CLIENTE CONVERTIDO QA').length, 1)
})

test('la importación requiere permiso, pide una revisión vigente y el administrador puede deshacerla', async () => {
  const weeklyCookie = await login('qa-weekly@pignus.test')
  let response = await api('/api/customers/import', weeklyCookie, { method: 'POST', body: JSON.stringify({ revision: 0, customers: [] }) })
  assert.equal(response.status, 403)

  const administratorCookie = await login('qa-admin@pignus.test')
  const before = await state(administratorCookie)
  response = await api('/api/customers/import', administratorCookie)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).canUndo, false)
  const importedCustomer = { customerId: 'qa-import-reversible', kind: 'subscriber', account: 'PIG-999999', name: 'IMPORTACIÓN REVERSIBLE QA', street: 'Calle QA 999', address: 'Calle QA 999', locality: 'Córdoba', province: 'Córdoba', phone: '3519999999', type: 'Residencial', fields: {} }
  response = await api('/api/customers/import', administratorCookie, { method: 'POST', body: JSON.stringify({ revision: before.revision, customers: [...before.customers, importedCustomer] }) })
  assert.equal(response.status, 200)
  assert.ok((await state(administratorCookie)).customers.some(customer => customer.customerId === importedCustomer.customerId))
  response = await api('/api/customers/import', administratorCookie)
  assert.equal((await response.json()).canUndo, true)

  response = await api('/api/customers/import', administratorCookie, { method: 'DELETE' })
  assert.equal(response.status, 200)
  assert.ok(!(await state(administratorCookie)).customers.some(customer => customer.customerId === importedCustomer.customerId))
  response = await api('/api/customers/import', administratorCookie)
  assert.equal((await response.json()).canUndo, false)
})

test('elimina copias de una misma tarea sin confundir servicios distintos', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'uno', tasks: [{ historyId: 'work-1', taskId: 'task-1', client: 'CLIENTE A' }, { historyId: 'work-1', taskId: 'task-1', client: 'CLIENTE A' }] },
    { teamId: 'dos', tasks: [{ historyId: 'work-2', taskId: 'task-2', client: 'CLIENTE A' }] }
  ])
  assert.equal(teams[0].tasks.length, 1)
  assert.equal(teams[1].tasks.length, 1)
})

test('unifica una visita aunque una copia haya perdido el historyId', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-3', tasks: [
      { historyId: 'work-pig-6844', taskId: 'task-pig-6844', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5', client: 'PIG-6844 AGUSTIN ROSETTI' },
      { taskId: 'task-pig-6844', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5', client: 'PIG-6844 AGUSTIN ROSETTI' }
    ] }
  ])
  assert.equal(teams[0].tasks.length, 1)
  assert.equal(teams[0].tasks[0].historyId, 'work-pig-6844')
})

test('unifica copias regeneradas de una misma visita pero conserva otro horario', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-3', tasks: [
      { taskId: 'task-original', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5' },
      { taskId: 'task-regenerated', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5' },
      { taskId: 'task-other-time', time: '16:00', customerId: 'customer-pig-6844', serviceId: 'service-5' }
    ] }
  ])
  assert.deepEqual(teams[0].tasks.map(task => task.time), ['14:00', '16:00'])
})

test('fusiona tarjetas duplicadas del mismo equipo sin perder sus servicios', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-3', label: 'Equipo 3', memberIds: [3], members: ['Santos Diaz'], tasks: [{ historyId: 'work-1', client: 'CLIENTE A' }] },
    { teamId: 'equipo-2', label: 'Equipo 2', memberIds: [2], members: ['Leonardo Rivadero'], tasks: [] },
    { teamId: 'equipo-3', label: 'Equipo 3', memberIds: [3], members: ['Santos Diaz'], tasks: [{ historyId: 'work-2', client: 'CLIENTE B' }] }
  ])
  assert.equal(teams.length, 2)
  assert.deepEqual(teams[0].tasks.map(task => task.historyId), ['work-1', 'work-2'])
  assert.deepEqual(teams[0].members, ['Santos Diaz'])
})

test('conserva un solo horario disponible por equipo al normalizar', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-1', label: 'Equipo 1', tasks: [
      { taskId: 'slot-a', time: '08:30', client: '', service: '' },
      { taskId: 'slot-b', time: '08:30', client: '', service: '' },
      { taskId: 'slot-c', time: '13:00', client: '', service: '' }
    ] }
  ])
  assert.deepEqual(teams[0].tasks.map(task => task.time), ['08:30', '13:00'])
})
