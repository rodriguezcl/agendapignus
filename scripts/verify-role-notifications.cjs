// Real application and authorization projection; synthetic data and intercepted HTTP only.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const { visibleStateForUser, userForEmployee } = require('../api/_lib/core.cjs')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/role-notifications')
fs.mkdirSync(output, { recursive: true })
const today = '2026-10-20'
const flagNames = ['collections', 'reservations', 'pendingToday', 'confirmation', 'rescheduling', 'overdue', 'insurance', 'softguard', 'passwordRequests']
const permissions = (...keys) => ({ __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const built = buildSync({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx';\n${cssImports}\ncreateRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, outdir: 'out', format: 'iife',
  external: ['/logo-pignus.png', '/pignus-owl-white.svg'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' },
  loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent'
})
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'

function fixture(scenario) {
  const full = permissions('weekly.view', 'history.view', 'records.read', 'records.financial', 'collections.view', 'vehicles.view', 'vehicle.insurance.read', 'accounts.view', 'employees.requests.read')
  const selected = scenario === 'collections' ? permissions('collections.view', 'records.financial')
    : scenario === 'password' ? permissions('employees.view', 'employees.requests.read')
      : ['operator', 'assigned'].includes(scenario) ? permissions('weekly.view', 'records.read')
        : full
  if (scenario === 'disabled') for (const name of flagNames) selected[`notifications.${name}`] = false
  if (scenario === 'assigned') selected['scope.services.read.assigned'] = true
  const role = { id: 'qa-role', code: 'qa-role', name: scenario === 'operator' ? 'Operador' : 'Rol de prueba', permissions: selected }
  const administrator = { id: 'qa-administrator', code: 'administrator', name: 'Administrador', permissions: permissions() }
  const employee = { id: 'qa-user', firstName: 'Usuario', lastName: 'Prueba', name: 'Usuario Prueba', email: 'usuario@example.test', roleId: ['admin', 'settings'].includes(scenario) ? administrator.id : role.id, role: ['admin', 'settings'].includes(scenario) ? administrator.name : role.name, status: 'Activo', technicalEnabled: false }
  const base = { date: today, time: '08:30', scheduledTime: '08:30', teamId: 'qa-team', teamName: 'Equipo de prueba', technicianIds: [employee.id], technicians: [employee.name], customerId: 'qa-customer', service: 'Instalación de alarma', serviceId: 'qa-service', status: 'Pendiente' }
  const history = [
    { ...base, id: 'qa-collection', client: 'PIG-9001 COBRANZA DE PRUEBA', status: 'Completado', amount: '119020', paymentMethod: 'Transferencia' },
    { ...base, id: 'qa-reservation-own', date: '2026-10-21', client: 'RESERVA PROPIA DE PRUEBA', subscriberReservation: true },
    { ...base, id: 'qa-reservation-other', date: '2026-10-21', client: 'RESERVA AJENA DE PRUEBA', subscriberReservation: true, technicianIds: ['qa-other'], technicians: ['Otra persona'] },
    { ...base, id: 'qa-today', client: 'GESTIÓN DE HOY' },
    { ...base, id: 'qa-confirmation', date: '2026-10-22', client: 'CONFIRMACIÓN DE PRUEBA', awaitingConfirmation: true },
    { ...base, id: 'qa-rescheduling', date: '2026-10-19', client: 'REPROGRAMACIÓN DE PRUEBA', status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada' },
    { ...base, id: 'qa-overdue', date: '2026-10-19', client: 'PENDIENTE ANTERIOR' },
    { ...base, id: 'qa-advance', time: '15:00', scheduledTime: '15:00', client: 'ADELANTO DE PRUEBA', advanceRequest: { status: 'pending', requestedByName: employee.name, requestedAt: '2026-10-20T14:00:00Z' } }
  ]
  const team = { id: 'qa-team', teamId: 'qa-team', label: 'Equipo de prueba', name: 'Equipo de prueba', memberIds: [employee.id], members: [employee.name], tasks: [] }
  const weekly = { _monthlyTeams: { '2026-10': { teams: [team], confirmed: true } } }
  for (const day of new Set(history.map(record => record.date))) weekly[day] = { teams: [{ ...team, tasks: history.filter(record => record.date === day).map(record => ({ ...record, id: `task-${record.id}`, historyId: record.id })) }] }
  return {
    revision: 1, roles: [administrator, role, { id: 'qa-empty', code: 'qa-empty', name: 'Rol sin acceso', permissions: permissions() }], employees: [employee],
    services: [{ id: 'qa-service', name: 'Instalación de alarma', code: 'alarm-installation', status: 'Activo', estimatedMinutes: 60 }],
    customers: [
      { customerId: 'qa-customer', account: 'PIG-9001', name: 'CUENTA DE PRUEBA', status: 'Activo', kind: 'subscriber' },
      { customerId: 'qa-converted', account: 'CLI-9001', name: 'CUENTA DE PRUEBA', convertedFromAccount: 'PIG-9001', status: 'Activo', kind: 'client' }
    ],
    vehicles: [{ id: 'qa-vehicle', brand: 'Renault', model: 'Kangoo', plate: 'QA123AB', insuranceExpiresOn: '2026-10-19' }],
    history, agenda: { date: today, teams: weekly[today].teams, weekly }
  }
}

async function inspectCount(page) {
  const rows = await page.locator('.notification-item').count()
  const label = `Notificaciones: ${rows} aviso${rows === 1 ? '' : 's'} activo${rows === 1 ? '' : 's'}`
  assert.equal(await page.locator('.notification-toggle').getAttribute('aria-label'), label)
  assert.equal((await page.locator('.notification-header p').innerText()).trim(), label.replace('Notificaciones: ', ''))
  assert.equal(await page.locator('.notification-badge').count(), rows ? 1 : 0)
  if (rows) assert.equal(await page.locator('.notification-badge').innerText(), String(rows))
  return rows
}

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const results = []
  try {
    for (const width of (process.env.PERMISSION_WIDTHS || '1440,390').split(',').map(Number)) {
      for (const scenario of (process.env.NOTIFICATION_SCENARIOS || 'admin,operator,collections,disabled,assigned,password,settings').split(',')) {
        const page = await browser.newPage({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
        const state = fixture(scenario), errors = [], writes = []
        let statusLoads = 0
        const actor = () => userForEmployee(state.employees[0], state.roles)
        const projection = () => visibleStateForUser(state, actor())
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => errors.push(error.message))
        await page.clock.setFixedTime(new Date(`${today}T12:00:00-03:00`))
        await page.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url())
          if (url.hostname !== 'role-notifications.test') return route.abort()
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
          if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
          if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
          if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { active: true } })
          if (request.method() !== 'GET') { writes.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 403, json: { error: 'Unexpected write in read-only fixture' } }) }
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: actor(), state: projection() } })
          if (url.pathname === '/api/auth/session-status') { statusLoads++; return route.fulfill({ json: { active: true, sessionUser: actor() } }) }
          if (url.pathname === '/api/state') return route.fulfill({ json: projection() })
          if (url.pathname === '/api/state/revision') return route.fulfill({ json: { revision: state.revision } })
          if (url.pathname === '/api/auth/password-reset-requests') return route.fulfill({ json: { requests: [{ id: 'qa-password', email: 'acceso@example.test', requestedAt: '2026-10-20T14:00:00Z' }] } })
          if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { holidays: [], days: [], requests: [], attachments: [], records: [] } })
          return route.abort()
        })
        await page.goto('http://role-notifications.test/')
        await page.locator('.topbar').waitFor()
        if (scenario === 'settings') {
          if (width < 760) await page.locator('.sidebar-toggle').click()
          await page.locator('.sidebar nav').getByRole('button', { name: 'Configuración', exact: true }).click()
          await page.locator('.role-picker').getByRole('button', { name: 'Rol sin acceso', exact: true }).click()
          await page.locator('.role-module-picker select').selectOption('notifications')
          assert.equal(await page.locator('.role-capability').count(), 9)
          for (const name of flagNames) {
            const row = page.locator('.role-capability').filter({ has: page.locator(`[id="role-permission-notifications.${name}"]`) })
            assert.equal(await row.getByRole('checkbox').isDisabled(), true, `${name} requires its reading permissions`)
            assert.equal(await row.getByRole('checkbox').isChecked(), false)
            assert(await row.locator('.role-permission-detail p').count(), `${name} explains its unmet dependency`)
          }
        } else if (scenario === 'disabled') {
          if (await page.locator('.notification-toggle').count()) {
            await page.locator('.notification-toggle').click()
            assert.equal(await inspectCount(page), 0)
          }
          assert.equal(await page.locator('.notification-badge').count(), 0)
        } else {
          const bell = page.locator('.notification-toggle')
          await bell.click()
          if (['admin', 'password'].includes(scenario)) await page.getByTitle('Abrir: Solicitud de cambio de contraseña', { exact: true }).waitFor()
          const count = await inspectCount(page)
          const notice = title => page.getByTitle(`Abrir: ${title}`, { exact: true })
          if (scenario === 'admin') {
            for (const title of ['Cobranza pendiente de pago', 'Reserva pendiente de vincular con un PIG', 'Seguro vehicular desactualizado', 'Solicitud de cambio de contraseña', 'Solicitud para adelantar servicio']) assert(await notice(title).count(), `Administrator receives ${title}`)
            for (const title of ['Pendientes de gestión:', 'Pendientes de confirmación:', 'Pendientes de reprogramación:', 'Pendientes de días anteriores:', 'Pendiente de verificación en SoftGuard:']) assert(await page.getByTitle(new RegExp(`^Abrir: ${title}`)).count(), `Administrator receives ${title}`)
          } else if (scenario === 'collections') {
            assert.equal(count, 1)
            assert.equal(await page.locator('.sidebar nav').getByRole('button', { name: 'Menú principal', exact: true }).count(), 0)
            await notice('Cobranza pendiente de pago').click()
            await page.getByRole('heading', { name: 'Detalle de cobranza', exact: true }).waitFor()
            assert.equal((await page.locator('.topbar .page-heading h1').innerText()).trim(), 'Cobranzas')
            assert.equal(await page.getByRole('button', { name: 'Confirmar pago', exact: true }).count(), 0)
          } else if (scenario === 'operator' || scenario === 'assigned') {
            assert.equal(await notice('Cobranza pendiente de pago').count(), 0)
            assert.equal(await notice('Seguro vehicular desactualizado').count(), 0)
            assert.equal(await notice('Solicitud de cambio de contraseña').count(), 0)
            const copies = await page.locator('.notification-copy').allTextContents()
            assert(copies.some(text => text.includes('RESERVA PROPIA DE PRUEBA')))
            assert.equal(copies.some(text => text.includes('RESERVA AJENA DE PRUEBA')), scenario !== 'assigned')
            assert.equal(await notice('Reserva pendiente de vincular con un PIG').count(), scenario === 'assigned' ? 1 : 2)
            await page.getByTitle(/^Abrir: Pendientes de gestión:/).click()
            await page.locator('.notification-action-modal').waitFor()
            assert.equal((await page.locator('.topbar .page-heading h1').innerText()).trim(), 'Agenda semanal', 'Pending notice does not navigate to unauthorized history')
            await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).click()
            await bell.click()
            assert.equal(await inspectCount(page), count, 'Opening an informational notice does not resolve it')
            await notice('Reserva pendiente de vincular con un PIG').first().click()
            assert.equal((await page.locator('.topbar .page-heading h1').innerText()).trim(), 'Agenda semanal')
          } else if (scenario === 'password') {
            assert.equal(count, 1)
            await notice('Solicitud de cambio de contraseña').click()
            await page.locator('.notification-action-modal').waitFor()
            assert.equal(await page.getByRole('button', { name: 'Marcar resuelta', exact: true }).count(), 0)
            state.roles.find(role => role.id === 'qa-role').permissions['notifications.passwordRequests'] = false
            state.revision++
            await page.evaluate(() => window.dispatchEvent(new Event('focus')))
            await page.locator('.notification-action-modal').waitFor({ state: 'hidden' })
            assert(statusLoads > 0, 'Session refresh delivered the revocation')
            if (await bell.count()) {
              await bell.click()
              assert.equal(await inspectCount(page), 0)
            }
            assert.equal(await page.locator('.notification-badge').count(), 0)
          }
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scenario}/${width} has no horizontal overflow`)
        assert.deepEqual(errors, [], `${scenario}/${width} has no browser exceptions`)
        assert.deepEqual(writes, [], `${scenario}/${width} does not write when reading, opening or configuring a draft`)
        await page.screenshot({ path: path.join(output, `${scenario}-${width}.png`), fullPage: true })
        results.push({ scenario, width, errors: errors.length, writes: writes.length, statusLoads })
        console.log(`PASS notifications ${scenario}/${width}`)
        await page.close({ runBeforeUnload: false })
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
