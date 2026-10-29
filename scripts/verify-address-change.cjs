// Real components, synthetic accounts, all network requests intercepted.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/address-change-qa')
fs.mkdirSync(out, { recursive: true })
const shared = fs.readFileSync(path.join(root, 'scripts/verify-admin-theme.cjs'), 'utf8')
const fixtures = shared.slice(shared.indexOf('const themeReviewUser ='), shared.indexOf('const themeReviewNavigation ='))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `import {createRoot} from 'react-dom/client';
${cssImports}
${fixtures}
const record={...themeReviewHistory[1],id:'move',sourceTaskId:'move-task',date:'2026-10-29',serviceId:'address-change',service:'Cambio de domicilio',serviceTypes:[{id:'address-change',name:'Cambio de domicilio'}],newAddress:'San Martín 2500, Córdoba',detail:'Retirar y reinstalar el mismo equipo.',estimatedMinutes:120};
const team={...themeReviewTeams[0],tasks:[{...record,historyId:record.id,taskId:record.sourceTaskId}]};
window.__user=themeReviewUser;
window.__seed={revision:1,roles:themeReviewRoles,employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:[],reviews:[],history:[record],agenda:{date:'2026-10-29',teams:[team],weekly:{'2026-10-29':{teams:[team]}}},preferences:{}};
localStorage.setItem('pignus-theme-account:'+themeReviewUser.id,new URLSearchParams(location.search).get('theme')||'light');
createRoot(document.getElementById('root')).render(<App/>);`
const bundle = buildSync({ stdin: { contents: "import './style.css';\n" + fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8') + '\n' + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, ''), js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script src="/qa.js"></script></body></html>'
;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); const line = /qa\.js:(\d+):/.exec(error.stack)?.[1]; if (line) console.error(js.split('\n').slice(Number(line)-3,Number(line)+2).join('\n')) }); page.setDefaultTimeout(15000)
      await page.clock.install({ time: new Date('2026-10-29T08:00:00-03:00') })
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/qa.js') return route.fulfill({ contentType: 'text/javascript', body: js })
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: html })
        if (!url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 })
        const { state, user } = await page.evaluate(() => ({ state: window.__seed, user: window.__user }))
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user } })
        if (url.pathname === '/api/state/revision') return route.fulfill({ json: { revision: state.revision } })
        if (url.pathname === '/api/state') return route.fulfill({ json: state })
        return route.fulfill({ json: { requests: [], holidays: [], days: [], records: [], notifications: [], items: [] } })
      })
      await page.goto(`https://address-change-qa.test/review?theme=${theme}`)
      await page.locator('.app-shell').waitFor()
      await page.waitForTimeout(700)
      if (width < 800) await page.locator('.sidebar-toggle').click()
      await page.getByRole('button', { name: 'Historial', exact: true }).click({ force: true })
      await page.getByRole('button', { name: 'Gestionar', exact: true }).first().click()
      const modal = page.locator('.history-detail')
      await modal.getByText('Domicilio nuevo · instalación', { exact: true }).waitFor()
      await modal.getByRole('button', { name: 'Editar datos', exact: true }).click()
      assert.equal(await modal.getByLabel('Domicilio actual', { exact: true }).inputValue(), 'Av. Colón 1200')
      const destination = modal.getByLabel('Domicilio nuevo')
      assert.equal(await destination.inputValue(), 'San Martín 2500, Córdoba')
      await destination.fill('Destino corregido 300, Córdoba')
      assert.equal(await destination.inputValue(), 'Destino corregido 300, Córdoba')
      assert.ok(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'modal sin desborde horizontal')
      await page.screenshot({ path: path.join(out, `history-${width}.png`) })
      await page.reload()
      await page.locator('.app-shell').waitFor()
      await page.waitForTimeout(700)
      if (width < 800) await page.locator('.sidebar-toggle').click()
      await page.getByRole('button', { name: 'Agenda semanal', exact: true }).click({ force: true })
      await page.locator('[data-day="2026-10-29"] .week-task-summary').first().click()
      const weekly = page.locator('.weekly-task-modal')
      assert.equal(await weekly.getByLabel('Domicilio actual').inputValue(), 'Av. Colón 1200')
      assert.equal(await weekly.getByLabel('Domicilio nuevo').inputValue(), 'San Martín 2500, Córdoba')
      await weekly.getByLabel('Domicilio nuevo').fill('Destino semanal 400, Córdoba')
      assert.ok(await weekly.evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'agenda sin desborde horizontal')
      await weekly.getByLabel('Domicilio nuevo').scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(out, `weekly-${width}.png`) })
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ width, theme, fields: 'current and new address visible; new address editable', overflow: false }))
      await context.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
