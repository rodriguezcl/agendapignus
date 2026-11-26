const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const { hashPassword } = require('../api/_lib/employee-credentials.cjs')

const root = path.resolve(__dirname, '..')
const password = 'Cctv-Synthetic-Test-1234'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const put = (db, table, key, value) => db.prepare(`INSERT OR REPLACE INTO ${table} (${key},data) VALUES (?,?)`).run(String(value[key]), JSON.stringify(value))

// Entirely synthetic data: this helper never reads a real database or secrets.
function createFixtureDatabase(filename) {
  const db = new DatabaseSync(filename)
  try {
    db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE roles(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE services(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE work_history(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE customers(account TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE agendas(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE audit_log(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE reviews(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    `)
    const roles = [
      { id: 'admin-role', code: 'administrator', name: 'Administrador', permissions: { dashboard: true, weekly: true, agenda: true, history: true, accounts: true, employees: true, settings: true } },
      { id: 'supervisor-role', code: 'supervisor', name: 'Supervisor', permissions: { dashboard: true, history: true, accounts: true } },
      { id: 'tech-role', code: 'technician', name: 'Técnico', permissions: { dashboard: true, agenda: true } }
    ]
    for (const role of roles) put(db, 'roles', 'id', role)
    for (const [id, role] of [['admin', roles[0]], ['supervisor', roles[1]], ['tech', roles[2]]]) put(db, 'employees', 'id', {
      id, firstName: 'CCTV', lastName: id, name: `CCTV ${id}`, roleId: role.id, role: role.name,
      email: `${id}@cctv-http.test`, status: 'Activo', passwordHash: hashPassword(password)
    })
    const service = { id: 'camera-service', name: 'Service de cámaras', code: 'camera-service', status: 'Activo', category: 'service', estimatedMinutes: 15 }
    put(db, 'services', 'id', service)
    for (const [id, account, cctvService] of [['a', 'PIG-9901', true], ['b', 'PIG-9902', true], ['off', 'PIG-9903', false]]) put(db, 'customers', 'account', {
      customerId: id, account, cctvService, kind: 'subscriber', type: 'Residencial', name: `CUENTA SINTÉTICA ${id}`, address: 'Calle ficticia 123', street: 'Calle ficticia 123', locality: 'Córdoba', province: 'Córdoba', phone: '3510000000', monthlyFee: 99999, fields: {}
    })
    put(db, 'work_history', 'id', { id: 'assigned-work', customerId: 'a', clientAccount: 'PIG-9901', client: 'PIG-9901 CUENTA SINTÉTICA a', date: '2020-01-07', time: '09:00', estimatedMinutes: service.estimatedMinutes, serviceId: service.id, service: service.name, technicianIds: ['tech'], technicians: ['CCTV tech'], status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Informe sintético', completedAt: '2020-01-07T13:00:00Z', team: 'Equipo 1' })
    put(db, 'agendas', 'id', { id: 'current', date: '2020-01-07', teams: [], weekly: {} })
    db.prepare('INSERT INTO preferences(key,value) VALUES (?,?),(?,?)').run('state_revision', '0', 'vehicles', '[]')
  } finally { db.close() }
}

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test('CCTV HTTP real: permisos, expediente privado, PDF, CAS y reintentos por cuenta', { timeout: 60000 }, async t => {
  const temporaryRoot = path.resolve(root, 'tmp')
  fs.mkdirSync(temporaryRoot, { recursive: true })
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'cctv-http-'))
  const filename = path.join(directory, 'agenda-tecnica.db')
  let processHandle, serverOutput = ''
  try {
    createFixtureDatabase(filename)
    const port = await unusedPort(), origin = `http://127.0.0.1:${port}`
    const publicDirectory = path.join(directory, 'public')
    fs.mkdirSync(publicDirectory); fs.writeFileSync(path.join(publicDirectory, 'index.html'), '<!doctype html><title>CCTV synthetic fixture</title>')
    processHandle = spawn(process.execPath, ['server.cjs'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, NODE_ENV: 'test', PIGNUS_HOST: '127.0.0.1', PIGNUS_PORT: String(port), PIGNUS_DATA_DIR: directory, PIGNUS_PUBLIC_DIR: publicDirectory,
      PIGNUS_SECURE_COOKIE: 'false', TICKETS_MAIL_ENABLED: 'false', PIGNUS_REGISTRATION_ENCRYPTION_KEY: 'synthetic-cctv-http-only-32-character-key',
      TICKETS_MAIL_ENCRYPTION_KEY: 'synthetic-cctv-http-mail-only-key', TICKETS_MAIL_WORKER_SECRET: 'synthetic-cctv-http-worker-only-key'
    } })
    for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-10000) })
    processHandle.on('error', error => { serverOutput += error.message })
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(`${origin}/api/auth/session`, { signal: AbortSignal.timeout(1000) })).status === 401) { ready = true; break } } catch {}
      if (processHandle.exitCode !== null) break
      await pause(100)
    }
    assert.ok(ready, `El servidor sintético no inició. ${serverOutput}`)
    const api = (route, cookie, options = {}) => fetch(`${origin}${route}`, { ...options, signal: AbortSignal.timeout(10000), headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } })
    const login = async id => {
      const response = await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ email: `${id}@cctv-http.test`, password }) })
      assert.equal(response.status, 200, await response.clone().text())
      assert.match(response.headers.get('set-cookie'), /HttpOnly/i)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const [admin, supervisor, tech] = await Promise.all(['admin', 'supervisor', 'tech'].map(login))
    const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    const post = (cookie, input) => api('/api/cctv', cookie, { method: 'POST', body: JSON.stringify(input) })
    const command = (title, expectedVersion = 0) => ({ customerId: 'a', expectedVersion, commandId: crypto.randomUUID(), action: 'addNews', payload: { title, body: 'Observación sintética' } })
    assert.equal((await api('/api/cctv')).status, 401)
    for (const cookie of [admin, supervisor]) {
      const result = await json(await api('/api/cctv', cookie))
      assert.deepEqual(new Set(result.customers.map(customer => customer.customerId)), new Set(['a', 'b']))
      assert.equal(result.capabilities.edit, true)
      assert.equal(result.customers[0].monthlyFee, undefined)
      assert.equal((await json(await api('/api/cctv?customerId=a', cookie))).dossier.version, 0)
      assert.equal((await api('/api/cctv?customerId=off', cookie)).status, 404)
    }
    const techList = await json(await api('/api/cctv', tech))
    assert.deepEqual(techList.customers.map(customer => customer.customerId), ['a'])
    assert.equal(techList.capabilities.edit, false)
    assert.equal(techList.capabilities.download, true)
    assert.equal((await json(await api('/api/cctv?customerId=a', tech))).dossier.version, 0)
    assert.equal((await api('/api/cctv?customerId=b', tech)).status, 404)
    assert.equal((await post(tech, command('No autorizado'))).status, 403)
    assert.equal((await post(null, command('Anónimo'))).status, 401)
    const before = await json(await api('/api/state', admin))
    const pdf = Buffer.from('%PDF-1.4\nSynthetic CCTV document\n%%EOF\n')
    const input = command('Informe del supervisor')
    input.payload.file = { fileName: 'revisión CCTV.pdf', mimeType: 'application/pdf', data: pdf.toString('base64') }
    input.payload.author = { id: 'forged' }
    const created = await json(await post(supervisor, input))
    assert.equal(created.dossier.version, 1)
    assert.equal(created.dossier.news[0].author.id, 'supervisor')
    assert.equal(created.dossier.news[0].file.data, undefined)
    const retried = await json(await post(supervisor, input))
    assert.equal(retried.dossier.news.length, 1)
    assert.equal(retried.dossier.version, 1)
    const attachmentId = created.dossier.news[0].file.id
    for (const cookie of [admin, supervisor, tech]) {
      const response = await api(`/api/cctv/attachments?customerId=a&attachmentId=${attachmentId}`, cookie)
      assert.equal(response.status, 200, await response.clone().text())
      assert.equal(response.headers.get('content-type'), 'application/pdf')
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      assert.match(response.headers.get('content-disposition'), /^attachment;/)
      assert.match(response.headers.get('content-security-policy'), /sandbox/)
      assert.match(response.headers.get('cache-control'), /no-store/)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf)
    }
    for (const cookie of [admin, tech]) assert.equal((await api(`/api/cctv/attachments?customerId=b&attachmentId=${attachmentId}`, cookie)).status, 404)
    const concurrent = await Promise.all([post(admin, command('Sesión A', 1)), post(admin, command('Sesión B', 1))])
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409])
    const conflict = await concurrent.find(response => response.status === 409).json()
    assert.equal(conflict.code, 'CCTV_VERSION_CONFLICT'); assert.equal(conflict.currentVersion, 2)
    const retryAfterOther = await json(await post(supervisor, input))
    assert.equal(retryAfterOther.dossier.version, 2); assert.equal(retryAfterOther.dossier.news.length, 2)
    const after = await json(await api('/api/state', admin))
    assert.equal(after.revision, before.revision, 'El expediente no incrementa la revisión de la agenda')
    assert.equal(JSON.stringify(after).includes(pdf.toString('base64')), false)
    assert.equal(JSON.stringify(after).includes('Informe del supervisor'), false)
    const updateFlag = enabled => {
      const db = new DatabaseSync(filename)
      try { const customer = JSON.parse(db.prepare('SELECT data FROM customers WHERE account=?').get('PIG-9901').data); put(db, 'customers', 'account', { ...customer, cctvService: enabled }) } finally { db.close() }
    }
    updateFlag(false)
    assert.equal((await json(await api('/api/cctv', admin))).customers.some(customer => customer.customerId === 'a'), false)
    assert.equal((await api('/api/cctv?customerId=a', admin)).status, 404)
    assert.equal((await api(`/api/cctv/attachments?customerId=a&attachmentId=${attachmentId}`, tech)).status, 404)
    updateFlag(true)
    assert.equal((await json(await api('/api/cctv?customerId=a', admin))).dossier.version, 2)
    await t.test('el requerimiento comparte el dato de Abonados y clientes y del técnico, y detecta ediciones cruzadas', async () => {
      const key = 'Requiere llave de ingreso'
      const save = (cookie, expectedRequirement, cctvRequirement, customerId = 'a', detail = {}) => api('/api/cctv/requirement', cookie, {
        method: 'POST', body: JSON.stringify({ customerId, expectedRequirement, cctvRequirement, ...detail })
      })
      const accountState = () => api('/api/state', admin).then(json)
      const original = await accountState()
      const customer = original.customers.find(item => item.customerId === 'a')
      const changeFromAccounts = (revision, before, after, existed = true) => api('/api/state', admin, {
        method: 'PATCH', body: JSON.stringify({ revision, operations: [
          { path: ['customers', { key: 'customerId', id: 'a' }, 'cctvRequirement'], existed, exists: true, before, after }
        ] })
      })

      assert.equal((await save(null, '', key)).status, 401)
      assert.equal((await save(tech, '', key)).status, 403)
      assert.equal((await save(supervisor, '', key, 'off')).status, 404)
      assert.equal((await save(supervisor, '', 'Valor desconocido')).status, 400)
      const saved = await json(await save(supervisor, '', key))
      assert.equal(saved.customer.cctvRequirement, key)
      assert.equal(saved.customer.monthlyFee, undefined)
      assert.equal(saved.revision, original.revision + 1)
      const retried = await json(await save(supervisor, '', key))
      assert.equal(retried.revision, saved.revision)
      const current = await accountState()
      assert.deepEqual(current.customers.find(item => item.customerId === 'a'), { ...customer, cctvRequirement: key })
      const technicianView = await json(await api('/api/cctv?customerId=a', tech))
      assert.equal(technicianView.customer.cctvRequirement, key)
      const technical = await json(await api('/api/technician/state', tech))
      assert.equal(technical.history.find(item => item.id === 'assigned-work').customerCctvRequirement, key)

      assert.equal((await changeFromAccounts(original.revision, customer.cctvRequirement, 'Otro', Object.hasOwn(customer, 'cctvRequirement'))).status, 409)
      await json(await changeFromAccounts(current.revision, key, 'Otro'))
      assert.equal((await json(await api('/api/cctv?customerId=a', supervisor))).customer.cctvRequirement, 'Otro')
      const stale = await save(supervisor, key, '')
      assert.equal(stale.status, 409)
      assert.equal((await stale.json()).code, 'CCTV_REQUIREMENT_CONFLICT')
      const detail = 'Coordinar el ingreso con portería.'
      assert.equal((await save(supervisor, 'Otro', 'Otro', 'a', { cctvRequirementDetail: 'x'.repeat(1001) })).status, 400)
      const withDetail = await json(await save(supervisor, 'Otro', 'Otro', 'a', { cctvRequirementDetail: '  ' + detail + '  ' }))
      assert.equal(withDetail.customer.cctvRequirementDetail, detail)
      assert.equal((await accountState()).customers.find(item => item.customerId === 'a').cctvRequirementDetail, detail)
      const assignedService = async () => (await json(await api('/api/technician/state', tech))).history.find(item => item.id === 'assigned-work')
      assert.equal((await assignedService()).customerCctvRequirementDetail, detail)
      assert.equal((await save(supervisor, 'Otro', 'Otro', 'a', { expectedDetail: '', cctvRequirementDetail: 'Cambio desactualizado' })).status, 409)
      const updatedDetail = 'Avisar a portería al llegar.'
      await json(await api('/api/state', admin, {
        method: 'PATCH', body: JSON.stringify({ revision: withDetail.revision, operations: [
          { path: ['customers', { key: 'customerId', id: 'a' }, 'cctvRequirementDetail'], existed: true, exists: true, before: detail, after: updatedDetail }
        ] })
      }))
      assert.equal((await json(await api('/api/cctv?customerId=a', supervisor))).customer.cctvRequirementDetail, updatedDetail)
      assert.equal((await assignedService()).customerCctvRequirementDetail, updatedDetail)
      await json(await save(admin, 'Otro', '', 'a', { expectedDetail: updatedDetail }))
      assert.equal((await assignedService()).customerCctvRequirementDetail, undefined)
      assert.equal((await accountState()).customers.find(item => item.customerId === 'a').cctvRequirementDetail, undefined)
      assert.equal((await accountState()).customers.find(item => item.customerId === 'a').cctvRequirement || '', '')
    })
    const tooLarge = await api('/api/cctv', admin, { method: 'POST', body: JSON.stringify({ ...command('Grande', 2), padding: 'x'.repeat(4_300_001) }) })
    assert.equal(tooLarge.status, 413, await tooLarge.clone().text())
    const malformed = await api('/api/cctv', admin, { method: 'POST', body: '{' })
    assert.equal(malformed.status, 400, await malformed.clone().text())
    assert.equal((await api('/api/cctv', admin, { method: 'DELETE' })).status, 405)
  } finally {
    if (processHandle && processHandle.exitCode === null) {
      const stopped = new Promise(resolve => processHandle.once('exit', resolve))
      processHandle.kill(); await stopped
    }
    // Restrict recursive cleanup to the exact generated fixture beneath tmp.
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot)
    assert.ok(path.basename(directory).startsWith('cctv-http-'))
    for (let attempt = 0; attempt < 10; attempt++) {
      try { fs.rmSync(directory, { recursive: true, force: true }); break }
      catch (error) { if (attempt === 9) throw error; await pause(100) }
    }
  }
})
