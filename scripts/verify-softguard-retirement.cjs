/* Real App with intercepted HTTP, synthetic customers and an in-memory server.
   No production services, customer records or external SoftGuard are accessed. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const policy = require('../api/_lib/permission-catalog.cjs')
const retirement = require('../api/_lib/softguard-retirement.cjs')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tmp/visual-qa/softguard-retirement')
fs.mkdirSync(out, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
  .map(match => `import '${match[1]}';`).join('\n')
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const built = buildSync({
  stdin: { contents: `import './style.css';\n${source}\nimport {createRoot} from 'react-dom/client';\n${cssImports}\ncreateRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, outdir: 'out', format: 'iife',
  external: ['/logo-pignus.png', '/pignus-owl-white.svg'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' },
  loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent'
})
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '')
const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script src="/qa.js"></script></body></html>'
const widths = (process.env.SOFTGUARD_WIDTHS || '1440,390,320').split(',').map(Number)
const themes = (process.env.SOFTGUARD_THEMES || 'light,dark').split(',')
const NOW = '2026-10-20T15:00:00Z'
const grants = ['dashboard.view', 'accounts.view', 'notifications.softguard']
const permissionSet = (mode = 'writer') => ({ __catalogV2: true, ...Object.fromEntries(policy.CATALOG.map(item => [item.id, grants.includes(item.id) || mode === 'writer' && item.id === 'customers.softguard.resolve'])), ...(mode === 'cctv' ? { 'scope.customers.read.cctv': true } : {}) })
const user = { id: 'softguard-qa', name: 'Responsable sintético', email: 'softguard@example.test', roleId: 'r-softguard-qa', role: 'Seguimiento SoftGuard', roleCode: 'softguard-qa' }
const customer = (id, account, previousAccount, date, extra = {}) => ({ customerId: id, kind: 'client', account, convertedFromAccount: previousAccount, name: `CLIENTE SINTÉTICO ${id}`, type: 'Cliente de servicio', subscriptionEndedAt: date, ...extra })
const seed = () => ({
  revision: 1, employees: [], services: [], history: [], vehicles: [], preferences: {},
  roles: [{ id: user.roleId, code: user.roleCode, name: user.role, permissions: permissionSet() }],
  customers: [
    customer('retired-a', 'CLI-9001', 'PIG-8001', '2026-10-20T03:00:00Z', { cctvService: true }),
    customer('retired-b', 'CLI-9002', 'PIG-8002', '2026-10-20T14:00:00Z'),
    customer('historic', 'CLI-9003', 'PIG-8003', '2026-10-20T02:59:00Z'),
    customer('undated', 'CLI-9004', 'PIG-8004', undefined),
    customer('not-pig', 'CLI-9005', 'CLI-8005', '2026-10-20T14:00:00Z'),
    { customerId: 'active', kind: 'subscriber', account: 'PIG-8006', name: 'ABONADO SINTÉTICO ACTIVO' }
  ],
  agenda: { date: '2026-10-20', teams: [], weekly: {} }
})
const notices = page => page.locator('.notification-item').filter({ hasText: 'Baja pendiente en SoftGuard' })
const reminder = page => page.locator('.softguard-retirement-reminder')
async function openBell(page) {
  const toggle = page.locator('.notification-toggle')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.getByRole('dialog', { name: 'Notificaciones', exact: true }).waitFor()
}
async function openNotice(page, account) {
  await openBell(page)
  await notices(page).filter({ hasText: account }).click()
  await reminder(page).waitFor()
  assert.match(await reminder(page).innerText(), new RegExp(account))
  return page.locator('.notification-action-modal')
}
async function closeNotice(page) {
  await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).click()
  await page.locator('.notification-action-modal').waitFor({ state: 'detached' })
}
async function assertGeometry(page, name) {
  const geometry = await page.locator('.notification-action-modal').evaluate(node => {
    const bounds = node.getBoundingClientRect()
    return { left: bounds.left, right: bounds.right, width: bounds.width, viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, contentWidth: node.scrollWidth, clientWidth: node.clientWidth }
  })
  assert(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, `${name}: modal fits viewport`)
  assert(geometry.pageWidth <= geometry.viewport + 1, `${name}: no page overflow`)
  assert(geometry.contentWidth <= geometry.clientWidth + 1, `${name}: no dialog horizontal scroll`)
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true })
  return geometry
}

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  try {
    for (const width of widths) for (const theme of themes) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width <= 640, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const errors = [], commands = [], unexpectedMutations = [], remoteRequests = []
      let state = seed(), fail = false, failRefresh = false, releasePost = null, holdPost = false, postHeld = null, stateReads = 0
      const subject = () => ({ ...user, permissions: state.roles[0].permissions })
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(theme => localStorage.setItem('pignus-theme-account:softguard-qa', theme), theme)
      await page.clock.install({ time: new Date(NOW) })
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== 'https://softguard-retirement.test') { remoteRequests.push(url.origin); return route.abort() }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/qa.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { ok: true } })
        if (url.pathname === '/api/customers/softguard-retirement' && request.method() === 'POST') {
          const input = request.postDataJSON()
          commands.push(structuredClone(input))
          if (holdPost) await new Promise(resolve => { releasePost = resolve; postHeld?.() })
          if (fail) return route.fulfill({ status: 503, json: { error: 'Fallo simulado: la baja continúa pendiente.' } })
          try {
            const result = retirement.resolveSoftguardRetirement(state, input, subject(), NOW)
            state = { ...result.state, revision: state.revision + 1 }
            return route.fulfill({ json: { ok: true, customer: result.after, revision: state.revision, state } })
          } catch (error) { return route.fulfill({ status: error.statusCode || 400, json: { error: error.message } }) }
        }
        if (request.method() !== 'GET') { unexpectedMutations.push({ method: request.method(), path: url.pathname }); return route.fulfill({ status: 403, json: { error: 'Unexpected fixture mutation' } }) }
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: subject(), state } })
        if (url.pathname === '/api/state/revision') return route.fulfill({ json: { revision: state.revision } })
        if (url.pathname === '/api/state') {
          stateReads++
          if (failRefresh) return route.fulfill({ status: 503, json: { error: 'Fallo simulado al actualizar la información.' } })
          return route.fulfill({ json: { ...state, sessionUser: subject() } })
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { requests: [], holidays: [], attachments: [], days: [], records: [] } })
        return route.fulfill({ status: 204 })
      })
      const refresh = async mode => {
        state = { ...state, revision: state.revision + 1, roles: [{ ...state.roles[0], permissions: permissionSet(mode) }] }
        await page.evaluate(() => globalThis.__pignusRefreshRemoteState())
        await page.waitForFunction(expected => JSON.stringify(globalThis.__pignusCurrentUser?.permissions) === JSON.stringify(expected), state.roles[0].permissions)
      }
      await page.goto('https://softguard-retirement.test/')
      await page.locator('.dashboard-overview').waitFor()
      await openBell(page)
      assert.equal(await notices(page).count(), 2, 'New retirements notify without requiring a duplicate imported PIG')
      const initialNotices = await notices(page).allTextContents()
      assert(initialNotices.some(text => text.includes('PIG-8001') && text.includes('CLI-9001')))
      assert(initialNotices.some(text => text.includes('PIG-8002') && text.includes('CLI-9002')))
      assert(!/PIG-8003|PIG-8004|CLI-8005|PIG-8006/.test(initialNotices.join(' ')), 'Historic, undated and non-retirement customers do not create new pending notices')
      let dialog = await openNotice(page, 'PIG-8001')
      const confirm = () => reminder(page).locator('.softguard-retirement-submit')
      const checkbox = () => reminder(page).getByRole('checkbox', { name: /Verifiqué que la cuenta PIG-8001 fue dada de baja en SoftGuard/ })
      assert(await confirm().isDisabled(), 'Manual verification must be acknowledged before saving')
      const geometry = await assertGeometry(page, `pending-${width}-${theme}`)
      await closeNotice(page)
      await openBell(page)
      assert.equal(await notices(page).count(), 2, 'Opening and closing a notice never resolves its cause')
      assert.equal(commands.length, 0)

      await refresh('reader')
      dialog = await openNotice(page, 'PIG-8001')
      assert.equal(await confirm().count(), 0, 'Read permission does not grant manual resolution')
      assert.equal(await reminder(page).getByRole('checkbox').count(), 0)
      await assertGeometry(page, `readonly-${width}-${theme}`)
      await closeNotice(page)
      await refresh('cctv')
      await openBell(page)
      assert.equal(await notices(page).count(), 1, 'Current customer scope filters the notice list')
      assert.match(await notices(page).innerText(), /PIG-8001/)
      await refresh('writer')
      dialog = await openNotice(page, 'PIG-8002')
      await refresh('cctv')
      await page.locator('.notification-action-modal').waitFor({ state: 'detached' })
      await openBell(page)
      assert.equal(await notices(page).count(), 1, 'Narrowing scope removes an already open inaccessible notice')
      await refresh('writer')
      dialog = await openNotice(page, 'PIG-8001')
      await checkbox().check()
      await refresh('reader')
      assert.equal(await confirm().count(), 0, 'Revocation removes a checked mutation action without remounting the application')
      assert.equal(commands.length, 0)
      await closeNotice(page)
      await refresh('writer')
      dialog = await openNotice(page, 'PIG-8001')
      await checkbox().check()
      fail = true
      await confirm().click()
      await reminder(page).getByRole('alert').filter({ hasText: 'Fallo simulado' }).waitFor()
      assert.equal(retirement.pendingSoftguardRetirements(state.customers).length, 2, 'A failed save keeps server state pending')
      assert(await checkbox().isChecked(), 'Retry preserves the explicit acknowledgement')
      assert(await confirm().isEnabled(), 'Failure unlocks the action for retry')
      assert.equal(commands.length, 1)
      assert.deepEqual(Object.keys(commands[0]).sort(), ['base', 'customerId'])
      assert.equal(commands[0].customerId, 'retired-a')
      assert.deepEqual(commands[0].base, retirement.softguardRetirementBase(state.customers.find(item => item.customerId === 'retired-a')), 'Command carries the immutable retirement base')
      await assertGeometry(page, `failure-${width}-${theme}`)
      await closeNotice(page)
      await openBell(page)
      assert.equal(await notices(page).count(), 2, 'Closing after a failed save leaves the notice active')
      await openNotice(page, 'PIG-8001')
      assert(!(await checkbox().isChecked()), 'Reopening requires a fresh manual acknowledgement')
      await checkbox().check()
      fail = false; holdPost = true
      const requestHeld = new Promise(resolve => { postHeld = resolve })
      const beforeRefresh = stateReads
      await confirm().click()
      await requestHeld
      await page.waitForFunction(() => document.querySelector('.softguard-retirement-reminder button')?.disabled)
      assert(await confirm().isDisabled(), 'In-flight command is disabled to prevent duplicate resolution')
      assert(await checkbox().isDisabled(), 'In-flight acknowledgement cannot change')
      assert(await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).isDisabled(), 'In-flight resolution cannot lose its progress by closing the modal')
      assert.equal(commands.length, 2)
      assert.deepEqual(commands[1], commands[0], 'Retry uses the same customer and base')
      assert(releasePost, 'Synthetic request is waiting for the server')
      holdPost = false; releasePost()
      await dialog.waitFor({ state: 'detached' })
      await openBell(page)
      assert.equal(await notices(page).count(), 1, 'Successful resolution removes only the chosen retirement notice')
      assert.match(await notices(page).innerText(), /PIG-8002/)
      assert(stateReads > beforeRefresh, 'Success refreshes authoritative server state')
      assert.equal(retirement.pendingSoftguardRetirements(state.customers).length, 1)
      await page.reload()
      await page.locator('.dashboard-overview').waitFor()
      await openBell(page)
      assert.equal(await notices(page).count(), 1, 'Resolution survives a full reload and is not local dismissal state')
      assert.match(await notices(page).innerText(), /PIG-8002/)
      assert.equal(commands.length, 2, 'Refresh and reload never repeat the mutation')

      await page.getByRole('button', { name: 'Cerrar notificaciones', exact: true }).click()
      if (width <= 640) await page.locator('.sidebar-toggle').click()
      await page.locator('.sidebar nav').getByRole('button', { name: 'Abonados y clientes', exact: true }).click()
      await page.getByRole('button', { name: 'Ver ficha de CLI-9001', exact: true }).click()
      const detail = page.getByRole('dialog', { name: 'Ficha de CLIENTE SINTÉTICO RETIRED-A', exact: true })
      await detail.waitFor()
      const resolution = detail.locator('.softguard-retirement-resolution')
      assert.match(await resolution.innerText(), /Responsable sintético/)
      assert.equal(await resolution.locator('time').getAttribute('datetime'), NOW, 'Customer detail exposes the persisted completion date')
      assert.equal(await detail.locator('.softguard-retirement-submit').count(), 0, 'Resolved customer detail cannot resolve the same retirement again')
      await detail.locator('.close-modal').click()
      await detail.waitFor({ state: 'detached' })
      await openNotice(page, 'PIG-8002')
      await reminder(page).getByRole('checkbox').check()
      failRefresh = true
      await confirm().click()
      await reminder(page).getByRole('alert').filter({ hasText: 'La baja quedó registrada' }).waitFor()
      assert.equal(commands.length, 3)
      assert.equal(retirement.pendingSoftguardRetirements(state.customers).length, 0, 'Successful POST is persisted even if the subsequent GET fails')
      assert.equal(await confirm().innerText(), 'Reintentar actualización')
      assert(await reminder(page).getByRole('checkbox').isDisabled(), 'Persisted acknowledgement cannot be changed while refreshing')
      failRefresh = false
      await confirm().click()
      await page.locator('.notification-action-modal').waitFor({ state: 'detached' })
      assert.equal(commands.length, 3, 'Retrying a failed GET never repeats the successful POST')
      await openBell(page)
      assert.equal(await notices(page).count(), 0, 'Successful refresh removes the final resolved notice')
      await page.reload()
      await page.locator('.app-shell').waitFor()
      await openBell(page)
      assert.equal(await notices(page).count(), 0, 'Both resolutions remain complete after another full reload')
      assert.deepEqual(unexpectedMutations, [], 'Only the dedicated resolution command was submitted')
      assert.deepEqual(errors, [], 'No browser runtime errors')
      assert.deepEqual(remoteRequests, [], 'All traffic stays within the synthetic intercepted origin')
      results.push({ width, theme, passed: true, geometry, commands: commands.length, checks: ['cutoff', 'identity', 'close-keeps-pending', 'reader', 'scope', 'revocation', 'failure', 'retry', 'busy', 'refresh', 'reload', 'completion-metadata', 'refresh-retry-no-duplicate-post'] })
      console.log(`SoftGuard retirement ${width}/${theme}: passed`)
      await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    console.log(`SoftGuard retirement: ${results.length} responsive/theme cases passed; no external traffic or unexpected writes.`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
