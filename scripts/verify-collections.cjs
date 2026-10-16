// Real application shell and synthetic, intercepted API only. No production data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/visual-qa/collections')
fs.mkdirSync(out, { recursive: true })
const shared = fs.readFileSync(path.join(root, 'scripts/verify-admin-theme.cjs'), 'utf8')
const fixtures = shared.slice(shared.indexOf('const themeReviewUser ='), shared.indexOf('const themeReviewNavigation ='))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `import {createRoot} from 'react-dom/client';
${cssImports}
${fixtures}
const records=[{...themeReviewHistory[0], id:'pay-1', date:'2026-10-14', amount:'15000', paymentMethod:'Efectivo'}, {...themeReviewHistory[2], id:'pay-2', date:'2026-10-15', amount:'25000', paymentMethod:'Transferencia'}, {...themeReviewHistory[0],id:'old',date:'2026-10-13',amount:'20000',paymentMethod:'Efectivo'}];
records[0].createdBy={id:'original-author',name:'Iván Rousselot',role:'Administrador',at:'2026-10-14T12:00:00Z'};
delete records[1].createdBy;
records.push({...records[0],id:'cancelled',status:'Cancelado',amount:'90000'}, {...records[0],id:'cancelled-corrected',status:'Cancelado',amount:'80000',collection:{status:'pending',events:[]}});
const params=new URLSearchParams(location.search), reader=params.get('reader')==='true';
const user=reader?{...themeReviewUser,id:'reader',roleCode:'collections-reader',role:'Consulta cobranzas',roleId:'r-reader',permissions:{collections:true}}:themeReviewUser;
window.__user=user;
window.__seed={revision:1,roles:[...themeReviewRoles,{id:'r-reader',code:'collections-reader',name:'Consulta cobranzas',permissions:{collections:true}}],employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:records,agenda:{date:'2026-10-14',teams:[],weekly:{}},preferences:{}};
localStorage.setItem('pignus-theme-account:'+user.id,params.get('theme')||'light');
createRoot(document.getElementById('root')).render(<App/>);`
const bundle = buildSync({ stdin: { contents: "import './style.css';\n" + fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8') + '\n' + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css' }, logLevel: 'silent' })
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, ''), js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script src="/qa.js"></script></body></html>'
;(async () => {
  const { manageCollection } = await import('../src/domain/collections/collections.mjs')
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), results = []
  try {
    for (const [width, theme, reader] of [[1440, 'light', false], [390, 'dark', false], [390, 'light', true]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage(), errors = [], commands = []
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
      await page.clock.install({ time: new Date('2026-10-14T23:58:00-03:00') })
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/qa.js') return route.fulfill({ contentType: 'text/javascript', body: js })
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: html })
        if (!url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 })
        const { state, user, fail } = await page.evaluate(() => ({ state: window.__seed, user: window.__user, fail: window.__fail }))
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user } })
        if (url.pathname === '/api/state/revision') return route.fulfill({ json: { revision: state.revision } })
        if (url.pathname === '/api/state') return route.fulfill({ json: state })
        if (url.pathname === '/api/collections/manage') {
          const input = route.request().postDataJSON(); commands.push(input)
          if (fail) return route.fulfill({ status: 503, json: { error: 'Fallo simulado: intentá nuevamente.' } })
          const result = manageCollection(state, input, user)
          result.state.revision = state.revision + 1
          await page.evaluate(next => { window.__seed = next }, result.state)
          return route.fulfill({ json: { ok: true, revision: result.state.revision, state: result.state } })
        }
        return route.fulfill({ json: { requests: [], holidays: [], days: [], records: [] } })
      })
      await page.goto(`https://collections-qa.test/review?theme=${theme}&reader=${reader}`)
      await page.locator('.app-shell').waitFor()
      await page.getByRole('button', { name: /^Notificaciones:/ }).click()
      const notices = page.locator('.notification-item').filter({ hasText: 'Cobranza pendiente de pago' })
      assert.equal(await notices.count(), 1, 'Sólo la cobranza de hoy genera aviso; la futura espera su fecha')
      await notices.first().click()
      await page.getByRole('dialog', { name: reader ? 'Detalle de cobranza' : 'Gestionar cobranza', exact: true }).waitFor()
      assert.equal(await page.locator('.topbar h1').innerText(), 'Cobranzas')
      assert.equal(await page.locator('.collections-table tbody tr').count(), 2, 'La cobranza futura sigue disponible en el módulo')
      assert.match(await page.locator('.collections-summary article').first().innerText(), /40\.000,00/, 'Los servicios cancelados no suman al saldo pendiente')
      const modal = page.locator('.catalog-editor-modal')
      const owner = modal.getByRole('region', { name: 'Responsable de cobranza', exact: true })
      assert.equal(await owner.locator('strong').innerText(), 'Iván Rousselot', 'La responsabilidad corresponde al autor original del servicio')
      const geometry = await modal.boundingBox()
      assert.ok(geometry.width <= Math.min(720, width - 20), JSON.stringify(geometry))
      await page.screenshot({ path: path.join(out, `modal-${width}-${theme}-${reader}.png`), fullPage: true })
      if (reader) {
        assert.equal(await modal.getByRole('button', { name: 'Confirmar pago', exact: true }).count(), 0)
      } else {
        const amountInput = modal.getByLabel(/^Monto/)
        assert.equal(await amountInput.inputValue(), '15.000,00')
        for (const entered of ['626376.50', '626376,50', '626.376,50']) {
          await amountInput.focus()
          await amountInput.fill(entered)
          await modal.getByLabel('Observación (opcional)').click()
          assert.equal(await amountInput.inputValue(), '626.376,50')
        }
        await amountInput.focus()
        await amountInput.fill('12,345')
        await modal.getByRole('button', { name: 'Guardar corrección', exact: true }).click()
        await modal.getByRole('alert').filter({ hasText: 'máximo de dos decimales' }).waitFor()
        assert.equal(commands.length, 0, 'Un monto inválido no se envía al servidor')
        await amountInput.focus()
        await amountInput.fill(width === 1440 ? '14500.50' : '14500,50')
        await modal.getByRole('combobox', { name: /^Forma de pago/ }).selectOption('Transferencia')
        await modal.getByLabel('Observación (opcional)').fill('Transferencia verificada por administración')
        await page.evaluate(() => { window.__fail = true })
        await modal.getByRole('button', { name: 'Guardar corrección', exact: true }).click()
        await modal.getByRole('alert').filter({ hasText: 'Fallo simulado' }).waitFor()
        assert.equal(await amountInput.inputValue(), '14.500,50')
        assert.equal(commands[0].amount, '14500.5', 'El servidor recibe el valor canónico, sin separadores de miles')
        await page.evaluate(() => { window.__fail = false })
        await modal.getByRole('button', { name: 'Guardar corrección', exact: true }).click()
        await modal.waitFor({ state: 'detached' })
        assert.equal(await page.evaluate(() => window.__seed.history[0].collection.status), 'pending')
        await page.locator('.collections-table button').first().click()
        await modal.getByRole('button', { name: 'Confirmar pago', exact: true }).click()
        await modal.waitFor({ state: 'detached' })
        assert.equal(await page.evaluate(() => window.__seed.history[0].collection.status), 'confirmed')
        assert.equal(await page.evaluate(() => window.__seed.history[0].collection.events.length), 2)
        await page.getByRole('button', { name: /^Notificaciones:/ }).click()
        assert.equal(await notices.count(), 0, 'La confirmación resuelve el aviso y la cobranza futura aún no notifica')
        await page.getByRole('button', { name: 'Cerrar notificaciones', exact: true }).click()
        await page.getByRole('combobox', { name: /^Estado del pago/ }).selectOption('confirmed')
        assert.equal(await page.locator('.collections-table tbody tr').count(), 1)
        await page.locator('.collections-table button').first().click()
        await modal.getByText('Pago confirmado', { exact: true }).last().waitFor()
        assert.equal(await owner.locator('strong').innerText(), 'Iván Rousselot', 'Confirmar o rectificar no cambia al responsable original')
        assert.match(await modal.locator('.collection-trace').innerText(), /Datos rectificados/)
        assert.match(await modal.locator('.collection-trace').innerText(), /15\.000,00/)
      }
      await modal.getByRole('button', { name: 'Cerrar edición', exact: true }).click()
      await modal.waitFor({ state: 'detached' })
      await page.clock.fastForward(3 * 60000)
      await page.getByRole('button', { name: /^Notificaciones:/ }).click()
      assert.equal(await notices.count(), reader ? 2 : 1, 'Al cambiar el día se activa automáticamente la cobranza del 15/10')
      await notices.last().click()
      await modal.waitFor()
      assert.equal(await owner.locator('strong').innerText(), 'Autor original no disponible', 'No se atribuyen servicios antiguos al usuario actual')
      await modal.getByRole('button', { name: 'Cerrar edición', exact: true }).click()
      await modal.waitFor({ state: 'detached' })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sin desborde horizontal')
      await page.screenshot({ path: path.join(out, `list-${width}-${theme}-${reader}.png`), fullPage: true })
      assert.deepEqual(errors, [])
      results.push({ width, theme, reader, geometry, commands: commands.map(input => input.action), passed: true })
      await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
