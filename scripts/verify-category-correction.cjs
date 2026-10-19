// Real application shell and synthetic, intercepted API only. No production data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/visual-qa/category-correction')
fs.mkdirSync(out, { recursive: true })
const shared = fs.readFileSync(path.join(root, 'scripts/verify-admin-theme.cjs'), 'utf8')
const fixtures = shared.slice(shared.indexOf('const themeReviewUser ='), shared.indexOf('const themeReviewNavigation ='))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `import {createRoot} from 'react-dom/client';
${cssImports}
${fixtures}
const records=[{...themeReviewHistory[0], id:'category-1', date:'2026-10-14', serviceId:'retirement-qa', service:'Retiro de equipo', serviceTypes:[{id:'retirement-qa',name:'Retiro de equipo'}], status:'Completado', technicalStatus:'Completado', technicalObservation:'Trabajo realizado', completedAt:'2026-10-14T15:00:00Z', client:'CLIENTE MUDANZA QA'}];
themeReviewServices.push({id:'retirement-qa',name:'Retiro de equipo',status:'Activo'}, {id:'other-qa',name:'Otro service QA',status:'Activo'});
const params=new URLSearchParams(location.search), reader=params.get('reader')==='true';
const user=reader?{...themeReviewUser,id:'reader',roleCode:'collections-reader',role:'Consulta cobranzas',roleId:'r-reader',permissions:{collections:true}}:themeReviewUser;
window.__user=user;
window.__seed={revision:1,roles:[...themeReviewRoles,{id:'r-reader',code:'collections-reader',name:'Consulta cobranzas',permissions:{collections:true}}],employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:records,agenda:{date:'2026-10-14',teams:[],weekly:{}},preferences:{}};
localStorage.setItem('pignus-theme-account:'+user.id,params.get('theme')||'light');
createRoot(document.getElementById('root')).render(<App/>);`
const bundle = buildSync({ stdin: { contents: "import './style.css';\n" + fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8') + '\n' + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, ''), js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script src="/qa.js"></script></body></html>'
;(async () => {
  const { correctServiceCategory } = await import('../src/domain/history/category-correction.mjs')
  const { prepareCategoryCorrection } = require('../api/_lib/category-correction.cjs')
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), results = []
  try {
    for (const [width, theme, reader] of [[1440, 'light', false], [390, 'dark', false]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage(), errors = [], commands = []
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
      await page.clock.install({ time: new Date('2026-10-14T16:00:00-03:00') })
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
        if (url.pathname === '/api/history/category-correction') {
          const input = route.request().postDataJSON(); commands.push(input)
          if (fail) return route.fulfill({ status: 503, json: { error: 'Fallo simulado: intentá nuevamente.' } })
          let result;try { result = prepareCategoryCorrection(state, input, user, correctServiceCategory) } catch(error) { return route.fulfill({status:error.statusCode||400,json:{error:error.message}}) }
          result.state.revision = state.revision + 1
          await page.evaluate(next => { window.__seed = next }, result.state)
          return route.fulfill({ json: { ok: true, revision: result.state.revision, state: result.state } })
        }
        return route.fulfill({ json: { requests: [], holidays: [], days: [], records: [] } })
      })
      await page.goto(`https://collections-qa.test/review?theme=${theme}&reader=${reader}`)
      await page.locator('.app-shell').waitFor()
      if (width < 800) await page.locator('.sidebar-toggle').click()
      await page.getByRole('button',{name:'Historial',exact:true}).click()
      await page.getByRole('button',{name:'Gestionar',exact:true}).first().click()
      await page.getByRole('button',{name:'Corregir categoría',exact:true}).click()
      const modal=page.getByRole('dialog',{name:'Corregir categoría',exact:true})
      await modal.locator('.service-types-trigger').click()
      await modal.getByRole('checkbox',{name:'Retiro de equipo',exact:true}).uncheck()
      await modal.getByRole('checkbox',{name:'Otro service QA',exact:true}).check()
      await modal.getByLabel('Motivo de la corrección').fill('Mudanza: mantiene el servicio')
      await page.screenshot({path:path.join(out,'modal-'+width+'.png')})
      assert.ok(await modal.evaluate(el=>el.scrollWidth <= el.clientWidth+2),'sin desborde del modal')
      await modal.getByRole('button',{name:'Guardar corrección',exact:true}).click()
      await modal.waitFor({state:'hidden'})
      assert.equal(commands.length,1)
      const saved=await page.evaluate(()=>window.__seed.history[0])
      assert.equal(saved.service,'Otro service QA');assert.equal(saved.status,'Completado')
      assert.equal(saved.technicalObservation,'Trabajo realizado')
      assert.deepEqual(errors,[])
      results.push({width,theme,ok:true})
      await context.close()
    }
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results))
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
