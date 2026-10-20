// UX regressions run through the real App. All HTTP traffic is intercepted.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tmp/visual-qa/notification-actions')
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
window.__seed.history.push({id:'advance-qa',date:'2026-10-13',time:'18:00',client:'Cliente QA',status:'Pendiente',advanceRequest:{status:'pending',requestedByName:'Tecnico QA',requestedAt:'2026-10-13T12:00:00-03:00'}});
window.__seed.customers.push({account:'PIG-1999',name:'Cuenta QA'},{account:'CLI-0999',name:'Cuenta QA',convertedFromAccount:'PIG-1999'});
window.__user=themeReviewUser;
installRequiredFeedback();
createRoot(document.getElementById('root')).render(<App/>);
`
const built = buildSync({ stdin: { contents: `import './style.css';\n${source}\n${fixture}`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const js = built.outputFiles.find(f => f.path.endsWith('.js')).text
const css = built.outputFiles.find(f => f.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/review.css"></head><body><div id="root"></div><script src="/review.js"></script></body></html>'
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Argentina/Buenos_Aires' })
      const errors = []
      let resetResolved = false
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(theme => localStorage.setItem('pignus-theme-account:admin-review', theme), theme)
      await page.clock.install({ time: new Date('2026-10-13T12:00:00-03:00') })
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== 'notification-actions.test') return route.abort()
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/review.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/review.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/logo-pignus.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'public/logo-pignus.png')) })
        if (url.pathname === '/api/auth/password-reset-requests') {
          if (request.method() === 'DELETE') { resetResolved = true; return route.fulfill({ json: { ok: true } }) }
          return route.fulfill({ json: { requests: resetResolved ? [] : [{ id: 'reset-qa', email: 'qa@example.test', requestedAt: '2026-10-13T12:00:00-03:00' }] } })
        }
        if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { ok: true } })
        if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'Unexpected mutation in fixture' } })
        if (url.pathname.startsWith('/api/')) {
          const { user, state } = await page.evaluate(() => ({ user: window.__user, state: window.__seed }))
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user, state } })
          if (url.pathname === '/api/state') return route.fulfill({ json: state })
          if (url.pathname.includes('revision')) return route.fulfill({ json: { revision: 1 } })
          return route.fulfill({ json: { requests: [], holidays: [], attachments: [], days: [], records: [] } })
        }
        return route.abort()
      })
      await page.goto('http://notification-actions.test/')
      await page.locator('.stats-grid').first().waitFor()
      assert.equal(await page.locator('.content :is(.pending-reminder,.subscriber-reservation-reminders,.service-advance-reminders,.password-reset-reminders,.vehicle-insurance-reminders)').count(), 0)
      const bell = page.locator('.notification-toggle')
      await bell.click()
      await page.getByTitle('Abrir: Solicitud de cambio de contraseña', { exact: true }).waitFor()
      const before = await page.locator('.notification-item').count()
      await page.getByTitle('Abrir: Solicitud de cambio de contraseña', { exact: true }).click()
      await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).click()
      await bell.click()
      assert.equal(await page.locator('.notification-item').count(), before, 'Opening a notice does not resolve it')
      await page.getByTitle('Abrir: Solicitud de cambio de contraseña', { exact: true }).click()
      await page.getByRole('button', { name: 'Marcar resuelta', exact: true }).click()
      await page.locator('.notification-action-modal').waitFor({ state: 'hidden' })
      await bell.click()
      assert.equal(await page.locator('.notification-item').count(), before - 1, 'Resolving removes the notice')
      await page.getByTitle('Abrir: Solicitud para adelantar servicio', { exact: true }).click()
      await page.getByRole('button', { name: 'Aprobar adelanto', exact: true }).click()
      await page.getByRole('heading', { name: 'Aprobar adelanto', exact: true }).waitFor()
      await page.locator('.confirm-modal').getByRole('button', { name: 'Cancelar', exact: true }).click()
      await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).click()
      await bell.click()
      await page.getByTitle(/Abrir: Pendiente de verificación en SoftGuard/).click()
      await page.getByRole('dialog', { name: 'Pendiente de verificación en SoftGuard' }).waitFor()
      await page.getByRole('button', { name: 'Cerrar verificación en SoftGuard' }).click()
      await bell.click()
      await page.getByTitle(/Abrir: Pendientes de gestión/).click()
      await page.locator('.topbar .page-heading').getByRole('heading', { name: 'Historial', exact: true }).waitFor()
      if (width <= 640) await page.locator('.sidebar-toggle').click()
      await page.locator('.sidebar nav').getByRole('button', { name: 'Abonados y clientes', exact: true }).click()
      await page.getByRole('button', { name: 'Importar abonados', exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Importar abonados' })
      await modal.waitFor()
      const file = '<table><tr><th>Dealer/Cuenta</th><th>Nombre</th></tr><tr><td>PIG-8999</td><td>Cliente QA</td></tr></table>'
      await modal.locator('input[type=file]').setInputFiles({ name: 'reporte-qa.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(file) })
      await modal.locator('.import-preview').waitFor()
      const box = await modal.boundingBox()
      assert(box.width <= 640 && box.width <= width - 30, 'Import dialog stays compact')
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow')
      await page.screenshot({ path: path.join(out, `import-${theme}-${width}.png`), fullPage: true })
      assert.equal(errors.length, 0, JSON.stringify(errors))
      console.log(`PASS ${theme}/${width}: notification actions, persistence, clean dashboard, compact import`)
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
