// UX regressions run through the real App. All HTTP traffic is intercepted.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tmp/visual-qa/ux-audit-fixes')
fs.mkdirSync(out, { recursive: true })
const fixtureSource = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const data = fixtureSource.slice(fixtureSource.indexOf('const themeReviewUser ='), fixtureSource.indexOf('const themeReviewNavigation ='))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => `import '${m[1]}';`).join('\n')
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const fixture = `
import {createRoot} from 'react-dom/client';
import {installRequiredFeedback} from './presentation/components/forms/required-feedback.mjs';
${cssImports}
${data}
window.__seed={revision:1,roles:themeReviewRoles,employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:themeReviewHistory,agenda:{date:'2026-10-13',teams:themeReviewTeams,weekly:themeReviewWeekly}};
window.__user=themeReviewUser;
installRequiredFeedback();
createRoot(document.getElementById('root')).render(<App/>);
`
const built = buildSync({ stdin: { contents: `import './style.css';\n${source}\n${fixture}`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const js = built.outputFiles.find(f => f.path.endsWith('.js')).text
const css = built.outputFiles.find(f => f.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/review.css"></head><body><div id="root"></div><script src="/review.js"></script></body></html>'
async function navigate(page, label, width) {
  if (width <= 640 && !(await page.locator('.sidebar').evaluate(element => element.classList.contains('open')))) await page.locator('.sidebar-toggle').click()
  const group = ['Colaboradores', 'Flota', 'Tipos de servicio'].includes(label) ? 'Recursos'
    : ['Configuración', 'Auditoría'].includes(label) ? 'Administración' : null
  if (group) {
    const toggle = page.locator('.sidebar nav').getByRole('button', { name: group, exact: true })
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  }
  await page.locator('.sidebar nav').getByRole('button', { name: label, exact: true }).click()
  await page.waitForFunction(label => document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label') === label, label)
}
async function textContrast(locator) {
  return locator.evaluate(element => {
    const rgb = v => (v.match(/[\d.]+/g) || []).map(Number)
    const lum = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0)
    let bg = [255, 255, 255], chain = []
    for (let p = element; p; p = p.parentElement) chain.unshift(rgb(getComputedStyle(p).backgroundColor))
    for (const c of chain) { const a = c[3] ?? 1; if (c.length >= 3) bg = bg.map((v, i) => c[i] * a + v * (1 - a)) }
    const values = [lum(rgb(getComputedStyle(element).color)), lum(bg)].sort((a, b) => b - a)
    return (values[0] + .05) / (values[1] + .05)
  })
}
async function screenshot(page, name) { await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true }) }
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const results = []
  try {
    for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(9000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(theme => localStorage.setItem('pignus-theme-account:admin-review', theme), theme)
      await page.clock.install({ time: new Date('2026-10-13T12:00:00-03:00') })
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== 'ux-fixes.test') return route.abort()
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/review.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/review.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/logo-pignus.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'public/logo-pignus.png')) })
        if (url.pathname.startsWith('/api/')) {
          if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { ok: true } })
          if (request.method() !== 'GET') return route.fulfill({ status: 503, json: { error: 'Fallo simulado. Reintentá.' } })
          const { user, state } = await page.evaluate(() => ({ user: window.__user, state: window.__seed }))
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user, state } })
          if (url.pathname === '/api/state') return route.fulfill({ json: state })
          if (url.pathname.includes('revision')) return route.fulfill({ json: { revision: 1 } })
          return route.fulfill({ json: { requests: [], holidays: [], attachments: [], days: [], records: [] } })
        }
        return route.abort()
      })
      await page.goto('http://ux-fixes.test/review')
      await page.locator('.dashboard-overview').waitFor()
      assert.equal(await page.locator('.app-shell').getAttribute('data-theme'), theme)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Dashboard fits ${width}/${theme}`)
      for (const value of await page.locator('.zone-summary > div > b, .projection-variation.positive').all()) {
        assert(await textContrast(value) >= 4.5, 'Dashboard value contrast')
      }
      await screenshot(page, `dashboard-${theme}-${width}`)
      if (width <= 640) {
        await page.locator('.sidebar-toggle').click()
        await page.waitForFunction(() => document.querySelector('.sidebar').contains(document.activeElement))
        for (let i = 0; i < 14; i++) {
          await page.keyboard.press('Tab')
          assert(await page.locator('.sidebar').evaluate(element => element.contains(document.activeElement)), 'Drawer owns focus')
        }
        assert(await page.locator('.sidebar-session').isVisible(), 'Mobile identity available')
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.activeElement?.matches('.sidebar-toggle') && !document.querySelector('.app-shell > main').inert)
      }
      await page.locator('.logout-button').click()
      const confirmation = page.locator('.confirm-modal')
      await confirmation.waitFor()
      assert((await confirmation.boundingBox()).width <= 420, 'Short confirmation width')
      await screenshot(page, `confirmation-${theme}-${width}`)
      await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await navigate(page, 'Configuración', width)
      await page.locator('.workday-settings').waitFor()
      await screenshot(page, `settings-${theme}-${width}`)
      await navigate(page, 'Colaboradores', width)
      assert(await page.locator('.employee-row .status').first().isVisible(), 'Employee status available at every width')
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Employees fit ${width}`)
      await screenshot(page, `employees-${theme}-${width}`)
      await navigate(page, 'Tipos de servicio', width)
      await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
      for (const label of await page.locator('.service-duration-field > span, .service-duration-inputs small, .system-service-chip').all()) {
        if (await label.isVisible()) assert(await textContrast(label) >= 4.5, 'Service label contrast')
      }
      await screenshot(page, `service-form-${theme}-${width}`)
      await page.keyboard.press('Escape')
      await navigate(page, 'Flota', width)
      await page.locator('.vehicle-row .row-actions button').first().click()
      const plateInput = page.locator('.vehicle-form').getByLabel('Matrícula', { exact: false })
      const currentPlate = await plateInput.inputValue()
      const otherPlate = await page.evaluate(current => window.__seed.vehicles.find(vehicle => vehicle.plate !== current).plate, currentPlate)
      await plateInput.fill(otherPlate)
      await page.locator('.vehicle-form').getByRole('button', { name: 'Guardar cambios', exact: true }).click()
      const notice = page.locator('.notice[data-tone="error"]')
      await notice.waitFor()
      assert.equal(await notice.getAttribute('role'), 'alert')
      assert(await notice.locator('span > svg').isVisible(), 'Error icon remains visible above a modal')
      assert(await textContrast(notice) >= 4.5, 'Error text contrast')
      await screenshot(page, `vehicle-duplicate-${theme}-${width}`)
      assert.deepEqual(errors, [])
      results.push({ width, theme, passed: true })
      await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify({ passed: true, scenarios: results.length, output: out }))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
