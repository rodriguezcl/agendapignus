/* Integration checks against the real App, with synthetic fixtures and every
   request intercepted. This never contacts or modifies production data. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const inspectModalGeometry = require('./lib/modal-geometry.cjs')

const root = path.resolve(__dirname, '..')
const production = process.env.CHROME_PRODUCTION === '1'
const output = path.join(root, `tmp/visual-qa/admin-chrome${production ? '-production' : ''}`)
fs.mkdirSync(output, { recursive: true })
const fixtureSource = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const fixtureStart = fixtureSource.indexOf('const themeReviewUser =')
const fixtureEnd = fixtureSource.indexOf('const themeReviewNavigation =')
assert(fixtureStart > 0 && fixtureEnd > fixtureStart, 'Shared visual fixture constants were not found')
const fixtureData = fixtureSource.slice(fixtureStart, fixtureEnd)
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const seedScript = `
${fixtureData}
themeReviewHistory.push(
  {...themeReviewHistory[1],id:'chrome-today',date:'2026-10-13',time:'14:00',scheduledTime:'14:00',client:'CLIENTE PENDIENTE DE HOY'},
  {...themeReviewHistory[1],id:'chrome-reservation',date:'2026-10-14',time:'11:00',scheduledTime:'11:00',customerId:null,client:'RESERVA DE PRUEBA',subscriberReservation:true,reservationName:'RESERVA DE PRUEBA',form:'Completo',formEmail:'reserva@example.test'}
);
for (const record of themeReviewHistory.filter(record => record.id.startsWith('chrome-'))) {
  const team = themeReviewWeekly[record.date]?.teams.find(team => (team.teamId || team.id) === record.teamId);
  if (team) team.tasks.push({...record,id:'task-'+record.id,historyId:record.id});
}
window.__themeSeed = {revision:1,roles:themeReviewRoles,employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:themeReviewHistory,agenda:{date:'2026-10-13',teams:themeReviewTeams,weekly:themeReviewWeekly}};
window.__themeUser = themeReviewUser;
if (!localStorage.getItem('pignus-theme-account:admin-review')) localStorage.setItem('pignus-theme-account:admin-review','light');
`
const fixture = `
import { createRoot } from 'react-dom/client';
${cssImports}
${seedScript}
createRoot(document.getElementById('root')).render(<App/>);
`
// Keep the same CSS ordering as main.jsx, including the first legacy import.
const built = buildSync({ stdin: { contents: "import './style.css';\n" + source + '\n' + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, jsx: 'automatic', bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const auditRecord = { id: 'chrome-audit', at: '2026-10-13T12:00:00Z', action: 'Modificó servicio', entity: 'Servicio', entityId: 'chrome-today', user: { name: 'Administración Pignus', email: 'administracion@example.test' }, before: { time: '08:30' }, after: { time: '14:00' } }
const html = production
  ? fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8').replace('</head>', `<script>${seedScript}</script></head>`)
  : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/review.css"></head><body><div id="root"></div><script src="/review.js"></script></body></html>'
const widths = (process.env.CHROME_WIDTHS || '1440,768,390').split(',').map(Number)
const checkNotifications = process.env.CHROME_NOTIFICATIONS !== '0'
const results = []

async function measureMenuSnapshotWork(page) {
  await page.evaluate(() => {
    const original = JSON.stringify
    window.__snapshotMeasurement = { calls: 0, characters: 0, restore: () => { JSON.stringify = original } }
    JSON.stringify = function (value, ...options) {
      const result = original.call(this, value, ...options)
      if (value?.agenda && Array.isArray(value.history) && Array.isArray(value.customers) && Array.isArray(value.employees)) {
        window.__snapshotMeasurement.calls++
        window.__snapshotMeasurement.characters += result.length
      }
      return result
    }
  })
  try {
    // An even number preserves the original expanded/collapsed state.
    for (let i = 0; i < 10; i++) await page.locator('.sidebar-toggle').click()
    return await page.evaluate(() => {
      const { calls, characters } = window.__snapshotMeasurement
      return { interactions: 10, fullStateSerializations: calls, serializedCharacters: characters }
    })
  } finally {
    await page.evaluate(() => { window.__snapshotMeasurement.restore(); delete window.__snapshotMeasurement })
  }
}

async function ready(page) {
  await page.locator('.app-shell .sidebar-toggle').waitFor()
  await page.locator('.content .stats-grid').first().waitFor()
}
async function navigate(page, label, width) {
  if (width <= 640 && !(await page.locator('.sidebar').evaluate(el => el.classList.contains('open')))) await page.locator('.sidebar-toggle').click()
  await page.locator('.sidebar nav').getByRole('button', { name: label, exact: true }).click()
  await page.waitForFunction(expected => document.querySelector('.sidebar nav [aria-current="page"]')?.getAttribute('aria-label') === expected, label)
  assert.equal(await page.locator('.topbar').count(), 1, `${label} must retain one shared header`)
  assert.equal(await page.locator('.topbar .sidebar-toggle').count(), 1)
  assert.equal(await page.locator('.topbar-fullscreen').count(), 1)
}
async function capture(page, label, theme) {
  // React's theme attribute can update just before the browser paints its colors.
  await page.waitForFunction(expected => {
    const header = document.querySelector('.topbar')
    if (!header) return false
    const rgb = getComputedStyle(header).backgroundColor.match(/[\d.]+/g).map(Number).slice(0, 3)
    return expected === 'light' ? Math.min(...rgb) > 230 : Math.max(...rgb) < 75 && Math.max(...rgb) - Math.min(...rgb) < 5
  }, theme)
  const metrics = await page.evaluate(() => {
    const bg = selector => getComputedStyle(document.querySelector(selector)).backgroundColor.match(/[\d.]+/g).map(Number).slice(0, 3)
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, sidebar: bg('.sidebar'), topbar: bg('.topbar'), theme: document.querySelector('.app-shell').dataset.theme }
  })
  assert.equal(metrics.theme, theme)
  assert(metrics.scrollWidth <= metrics.width + 2, `${label}: viewport overflow ${metrics.scrollWidth}/${metrics.width}`)
  assert(Math.max(...metrics.sidebar) < 90, `${label}: sidebar must stay dark (${metrics.sidebar.join(',')})`)
  if (theme === 'light') assert(Math.min(...metrics.topbar) > 230, `${label}: light header must stay light`)
  else assert(Math.max(...metrics.topbar) < 75 && Math.max(...metrics.topbar) - Math.min(...metrics.topbar) < 5, `${label}: dark header must be neutral (${metrics.topbar.join(',')})`)
  await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true })
}
async function notifications(page, width, theme) {
  const toggle = page.locator('.notification-toggle')
  await toggle.waitFor()
  assert.equal(await page.locator('.notification-badge').textContent(), '2', 'The two active causes must produce two notifications')
  await toggle.click()
  const panel = page.getByRole('dialog', { name: 'Notificaciones', exact: true })
  await panel.waitFor()
  assert.equal(await panel.locator('.notification-item').count(), 2)
  const bounds = await panel.boundingBox()
  assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, 'Notification panel must fit the viewport')
  await capture(page, `notifications-${theme}-${width}`, theme)
  await page.keyboard.press('Escape')
  assert.equal(await panel.count(), 0)
  assert.equal(await toggle.evaluate(el => el === document.activeElement), true)
  assert.equal(await page.locator('.notification-badge').textContent(), '2', 'Opening notices must not mark their causes resolved')
  await toggle.click()
  await page.locator('.notification-close').click()
  assert.equal(await panel.count(), 0)
  await toggle.click()
  await page.locator('.content').click({ position: { x: 8, y: 800 } })
  assert.equal(await panel.count(), 0, 'Outside click closes notifications')
  await toggle.click()
  await panel.locator('.notification-item').filter({ hasText: 'Pendientes de gestión' }).click()
  await page.waitForFunction(() => document.querySelector('.sidebar nav [aria-current="page"]')?.getAttribute('aria-label') === 'Historial')
  assert.equal(await panel.count(), 0)
  await page.getByText('CLIENTE PENDIENTE DE HOY', { exact: false }).first().waitFor()
  await toggle.click()
  await page.keyboard.press('Escape')
  await navigate(page, 'Menú principal', width)
  assert.equal(await panel.count(), 0)
  assert.equal(await page.locator('.notification-badge').textContent(), '2')
}

async function inspectTechnicalReportDisclosure(page) {
  const reports = page.locator('.weekly-board .agenda-report-disclosure')
  const first = reports.first()
  await first.waitFor()
  for (const report of await reports.all()) {
    assert.equal(await report.locator('summary .report-show:visible').count(), 1, 'A closed technical report must show one opening label')
    assert.equal(await report.locator('summary .report-hide:visible').count(), 0, 'A closed technical report must hide its closing label')
  }
  await first.locator('summary').click()
  assert.equal(await first.evaluate(node => node.open), true)
  assert.equal(await first.locator('summary .report-show:visible').count(), 0, 'An open technical report must hide its opening label')
  assert.equal(await first.locator('summary .report-hide:visible').count(), 1, 'An open technical report must show one closing label')
  await first.locator('summary').click()
  assert.equal(await first.evaluate(node => node.open), false)
  assert.equal(await first.locator('summary .report-show:visible').count(), 1)
  assert.equal(await first.locator('summary .report-hide:visible').count(), 0)
}

async function inspectDeferredScreens(page, width) {
  const screens = [
    ['Agenda semanal', '.weekly-board'],
    ['Historial', '.history-row'],
    ['Abonados y clientes', '.account-row'],
    ['Empleados', '.employee-row'],
    ['Tipo de servicio', '.service-row'],
    ['Vehículos', '.vehicle-row'],
    ['Configuración', '.roles-card']
  ]
  const controls = async label => {
    const surfaces = await page.locator('.content input:not([type="checkbox"]):not([type="radio"]), .content select, .content textarea, .modal input:not([type="checkbox"]):not([type="radio"]), .modal select').evaluateAll(nodes =>
      nodes.filter(node => node.getClientRects().length).map(node => ({ name: node.className || node.tagName, color: getComputedStyle(node).backgroundColor })))
    for (const surface of surfaces) {
      const rgba = surface.color.match(/[\d.]+/g)?.map(Number) || []
      if (rgba.length === 4 && rgba[3] === 0) continue
      const rgb = rgba.slice(0, 3)
      assert(Math.max(...rgb) < 95 && Math.max(...rgb) - Math.min(...rgb) < 12, `${label}: late CSS changed a dark form surface: ${surface.name} ${surface.color}`)
    }
  }
  for (let index = 0; index < screens.length; index++) {
    const [label, selector] = screens[index]
    await navigate(page, label, width)
    await page.locator(selector).first().waitFor()
    // Weekly is deliberately first: its shared styles must work on a cold load
    // without visiting the daily agenda or history first.
    if (label === 'Agenda semanal') await inspectTechnicalReportDisclosure(page)
    await controls(label)
    await capture(page, `module-${index}-dark-${width}`, 'dark')
    if (label === 'Agenda semanal') {
      await page.getByRole('button', { name: 'Equipos del mes', exact: true }).click()
      const dialog = page.locator('.monthly-teams-modal').first()
      await dialog.waitFor()
      await controls('Equipos del mes')
      await capture(page, `monthly-dialog-dark-${width}`, 'dark')
      await dialog.locator('.modal-close').click()
      await dialog.waitFor({ state: 'hidden' })
      await page.locator('.week-day').nth(1).getByRole('button', { name: 'Agregar servicio', exact: true }).first().click()
      const serviceDialog = page.locator('.weekly-task-modal').first()
      await serviceDialog.waitFor()
      await controls('Nuevo servicio')
      await inspectModalGeometry(page, 'Nuevo servicio')
      await capture(page, `service-dialog-dark-${width}`, 'dark')
      await serviceDialog.locator('.close-modal,.modal-close').first().click()
      await serviceDialog.waitFor({ state: 'hidden' })
    }
  }
  await navigate(page, 'Menú principal', width)
  await ready(page)
}

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const errors = [], writes = []
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install({ time: new Date('2026-10-13T12:00:00-03:00') })
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== 'admin-chrome.test') return route.abort()
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: html })
        if (production && (url.pathname.startsWith('/assets/') || url.pathname === '/version.json')) {
          const file = path.resolve(root, 'dist', '.' + url.pathname)
          const directory = path.resolve(root, 'dist') + path.sep
          if (!file.startsWith(directory) || !fs.existsSync(file)) return route.abort()
          const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'application/json'
          return route.fulfill({ contentType: type, body: fs.readFileSync(file) })
        }
        if (url.pathname === '/review.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/review.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/logo-pignus.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'public/logo-pignus.png')) })
        if (url.pathname.startsWith('/api/')) {
          // Session activity is expected during interaction; fulfill it locally.
          if (url.pathname === '/api/auth/activity' && request.method() === 'POST') return route.fulfill({ json: { ok: true } })
          if (request.method() !== 'GET') { writes.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 403, json: { error: 'Read-only integration review' } }) }
          const seed = await page.evaluate(() => ({ user: window.__themeUser, state: window.__themeSeed }))
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: seed })
          if (url.pathname === '/api/state') return route.fulfill({ json: seed.state })
          if (url.pathname.includes('revision')) return route.fulfill({ json: { revision: 1 } })
          if (url.pathname === '/api/audit') return route.fulfill({ json: { records: [auditRecord] } })
          if (url.pathname.includes('weather')) return route.fulfill({ json: { days: [] } })
          return route.fulfill({ json: { requests: [], holidays: [], attachments: [] } })
        }
        return route.abort()
      })
      await page.goto('http://admin-chrome.test/review')
      await ready(page)
      const snapshotWork = width > 640 ? await measureMenuSnapshotWork(page) : null
      await capture(page, `expanded-light-${width}`, 'light')
      if (width > 640) {
        const expanded = await page.locator('.sidebar').boundingBox()
        await page.getByRole('button', { name: 'Contraer menú lateral', exact: true }).click()
        await page.getByRole('button', { name: 'Expandir menú lateral', exact: true }).waitFor()
        const collapsed = await page.locator('.sidebar').boundingBox()
        assert(collapsed.width <= 80 && collapsed.width < expanded.width, 'Desktop menu must collapse to an icon rail')
        assert.equal(await page.evaluate(() => localStorage.getItem('pignus-sidebar-collapsed')), 'true')
        await navigate(page, 'Auditoría', width)
        await navigate(page, 'Centro de ayuda', width)
        await page.reload()
        await ready(page)
        await page.getByRole('button', { name: 'Expandir menú lateral', exact: true }).waitFor()
        assert((await page.locator('.sidebar').boundingBox()).width <= 80, 'Collapsed choice must survive reload')
        await capture(page, `collapsed-light-${width}`, 'light')
        await page.getByRole('button', { name: 'Expandir menú lateral', exact: true }).click()
      } else {
        await page.getByRole('button', { name: 'Abrir menú lateral', exact: true }).click()
        await page.locator('.sidebar.open').waitFor()
        await capture(page, `drawer-light-${width}`, 'light')
        await page.keyboard.press('Escape')
        assert.equal(await page.locator('.sidebar.open').count(), 0)
        assert.equal(await page.locator('.sidebar-toggle').evaluate(el => el === document.activeElement), true)
        await navigate(page, 'Auditoría', width)
        assert.equal(await page.locator('.sidebar.open').count(), 0)
        await navigate(page, 'Centro de ayuda', width)
        assert.equal(await page.locator('.sidebar.open').count(), 0)
        await navigate(page, 'Menú principal', width)
      }
      await page.locator('.theme-toggle').click()
      await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.theme === 'dark')
      await capture(page, `expanded-dark-${width}`, 'dark')
      await page.reload()
      await ready(page)
      assert.equal(await page.locator('.app-shell').getAttribute('data-theme'), 'dark', 'Theme must persist across reload')
      if (production) await inspectDeferredScreens(page, width)
      const fullscreen = page.getByRole('button', { name: 'Entrar en pantalla completa', exact: true })
      await fullscreen.click()
      await page.getByRole('button', { name: 'Salir de pantalla completa', exact: true }).waitFor()
      assert(await page.evaluate(() => document.fullscreenElement === document.documentElement))
      await page.evaluate(() => document.exitFullscreen())
      await fullscreen.waitFor()
      if (checkNotifications) await notifications(page, width, 'dark')
      await page.locator('.theme-toggle').click()
      await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.theme === 'light')
      if (checkNotifications) await notifications(page, width, 'light')
      assert.deepEqual(writes, [], 'Navigation and chrome must not write business data')
      assert.deepEqual(errors, [], 'No uncaught browser errors')
      console.log(`Real App chrome passed at ${width}px: sidebar, navigation, persistence, theme, fullscreen${checkNotifications ? ', notifications' : ''}.`)
      results.push({ width, notifications: checkNotifications, snapshotWork, errors, writes })
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
