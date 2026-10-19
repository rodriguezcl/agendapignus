// Real components, synthetic subscribers and intercepted network. No business writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const geometry = require('./lib/modal-geometry.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/visual-qa/subscriber-map')
fs.mkdirSync(out, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import {createRoot} from 'react-dom/client';
${cssImports}
const subscribers=Array.from({length:36},(_,i)=>({customerId:'map-'+i,kind:'subscriber',account:'PIG-'+(8000+i),name:i===0?'ABONADO DE PRUEBA':'ABONADO '+String(i).padStart(2,'0'),street:'Dirección de prueba '+i,locality:i<20?'Córdoba - B° CENTRO':'Villa Allende - B° GOLF',fields:{'Ubicación de la cuenta':((-31.416+Math.floor(i/6)*.008)+','+(-64.183+i%6*.008))}}));
subscribers[1].fields=subscribers[0].fields;
subscribers.push({customerId:'pending',kind:'subscriber',account:'PIG-8990',name:'PENDIENTE PRUEBA',street:'Calle sin coordenadas',locality:'Córdoba',fields:{}});
subscribers.push({customerId:'docta',kind:'subscriber',account:'PIG-8991',name:'DOCTA PRUEBA',street:'Manzana 28 Lote 1',locality:'Córdoba - Docta',fields:{}});
subscribers.push({customerId:'nobu',kind:'subscriber',account:'PIG-8992',name:'NOBU PRUEBA',locality:'Nobu Town',fields:{'Ubicación de la cuenta':'-31.36,-64.26'}});
subscribers.push({customerId:'duplicate',kind:'subscriber',account:'PIG-8000',name:'DUPLICADO',fields:{'Ubicación de la cuenta':'-31.416,-64.183'}});
subscribers.push({customerId:'client',kind:'client',account:'CLI-99',name:'NO MOSTRAR'});
function MapReview(){const [detail,setDetail]=useState(null);const theme=new URLSearchParams(location.search).get('theme');return <div className="app-shell" data-theme={theme}><main><header className="topbar"><div className="page-heading"><h1>Mapa</h1><div id="module-description-slot"/></div></header><section className="content"><SubscriberMap customers={subscribers} onOpenCustomer={setDetail}/></section></main>{detail&&<CustomerDetail customer={detail} close={()=>setDetail(null)}/>}</div>}
const theme=new URLSearchParams(location.search).get('theme');document.body.dataset.theme=theme;document.documentElement.dataset.theme=theme;
createRoot(document.getElementById('root')).render(<MapReview/>);`
const bundle = buildSync({ stdin: { contents: "import './style.css';\n" + fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8') + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '')
;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), results = []
  try {
    for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
      const page = await context.newPage(), errors = [], requests = []; let failTiles = false
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000)
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url()); requests.push({ url: request.url(), method: request.method() })
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="root"></div><script src="/qa.js"></script>' })
        if (url.pathname === '/qa.js') return route.fulfill({ contentType: 'text/javascript', body: js })
        if (url.pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.hostname === 'tile.openstreetmap.org') {
          if (failTiles) return route.abort()
          if (process.env.MAP_LIVE_TILES === '1') return route.continue()
          return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e7e0"/><path d="M0 50h256M0 180h256M50 0v256M180 0v256" stroke="white" stroke-width="12"/><text x="70" y="125" fill="#777" font-size="11">Mapa de prueba</text></svg>' })
        }
        return route.fulfill({ json: {} })
      })
      await page.goto(`https://map-review.test/review?theme=${theme}`)
      await page.locator('.leaflet-heatmap-layer').waitFor()
      assert.equal(await page.locator('.subscriber-map-metrics article strong').first().innerText(), '39')
      assert.equal(await page.locator('.subscriber-map-metrics article strong').nth(3).innerText(), '1')
      assert.equal(await page.locator('.subscriber-map-canvas img.leaflet-tile').first().getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin')
      await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].some(img => img.complete && img.naturalWidth))
      await page.screenshot({ path: path.join(out, `heat-${width}-${theme}.png`), fullPage: true })
      assert(await page.locator('.leaflet-heatmap-layer').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)))
      await page.getByRole('button', { name: 'Puntos por abonado', exact: true }).click()
      assert.equal(await page.locator('.subscriber-map-pin').count(), 37)
      await page.locator('.subscriber-map-pin').filter({ hasText: /^2$/ }).click()
      await page.locator('.subscriber-map-popup').getByRole('button', { name: /PIG-8000/ }).click()
      assert.equal(await page.locator('.subscriber-map-pin.is-selected').count(), 1)
      assert.equal(await page.locator('.subscriber-map-pin.is-selected').innerText(), '2')
      await page.getByRole('button', { name: 'Ver ficha del abonado' }).click()
      await geometry(page, `map-customer-${width}-${theme}`)
      await page.locator('.customer-detail-modal .close-modal').click()
      await page.locator('.subscriber-map-results li button').filter({ hasText: 'PIG-8002' }).click()
      const highlighted = page.locator('.subscriber-map-pin.is-selected')
      assert.equal(await highlighted.count(), 1)
      assert.match(await highlighted.getAttribute('title'), /PIG-8002/)
      assert.equal(await highlighted.getAttribute('aria-pressed'), 'true')
      assert.equal(await highlighted.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(124, 58, 237)')
      assert.equal(await page.locator('.subscriber-map-pin').filter({ hasText: /^2$/ }).getAttribute('aria-pressed'), 'false')
      await highlighted.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(out, 'selected-'+width+'-'+theme+'.png') })
      await page.getByRole('button', { name: 'Cerrar selección' }).click()
      assert.equal(await highlighted.count(), 0)
      await page.getByLabel('Zona', { exact: false }).selectOption('docta')
      assert.equal(await page.locator('.subscriber-map-pin').count(), 1)
      assert.equal(await page.locator('.subscriber-map-pin.is-approximate').count(), 1)
      await page.locator('.subscriber-map-results li button').click()
      assert.equal(await page.locator('.subscriber-map-pin.is-approximate.is-selected').count(), 1)
      await page.getByRole('button', { name: 'Mapa de calor', exact: true }).click()
      assert.equal(await page.locator('.subscriber-map-pin.is-selected').count(), 0)
      await page.getByRole('button', { name: 'Puntos por abonado', exact: true }).click()
      assert.equal(await page.locator('.subscriber-map-pin.is-selected').count(), 1)
      await page.getByRole('button', { name: 'Limpiar filtros' }).click()
      await page.getByRole('button', { name: 'Revisar ubicaciones' }).click()
      await page.getByText('Las cuentas de este filtro todavía no tienen coordenadas utilizables.', { exact: false }).waitFor()
      assert.equal(await page.locator('.subscriber-map-pin').count(), 0)
      await page.getByRole('button', { name: 'Limpiar filtros' }).click()
      await page.getByLabel('Buscar abonado').fill('PIG-8992')
      assert.equal(await page.locator('.subscriber-map-results li').count(), 1)
      await page.locator('.subscriber-map-results li button').click()
      assert.equal(await page.locator('.subscriber-map-pin.is-approximate.is-selected').count(), 1)
      assert.match(await page.locator('.subscriber-map-selection').innerText(), /ubicación genérica.*exacta.*no determinada/)
      await page.getByRole('button', { name: 'Ver ficha del abonado' }).click()
      assert.match(await page.locator('.customer-detail-modal iframe').getAttribute('src'), /-31.4612923%2C-64.3059628/)
      await page.locator('.customer-detail-modal .close-modal').click()
      await page.screenshot({ path: path.join(out, 'nobu-'+width+'-'+theme+'.png'), fullPage: true })

      await page.getByRole('button', { name: 'Limpiar filtros' }).click()
      await page.screenshot({ path: path.join(out, `points-${width}-${theme}.png`), fullPage: true })
      const bounds = await page.evaluate(() => ({ w: innerWidth, scroll: document.documentElement.scrollWidth }))
      assert(bounds.scroll <= bounds.w + 1, `Horizontal overflow at ${width}`)
      failTiles = true
      await page.locator('.leaflet-control-zoom-in').click()
      await page.getByRole('alert').filter({ hasText: 'No se pudo cargar' }).waitFor()
      failTiles = false
      await page.getByRole('button', { name: 'Reintentar mapa' }).click()
      await page.getByRole('alert').filter({ hasText: 'No se pudo cargar' }).waitFor({ state: 'detached' })
      assert.deepEqual(errors, [])
      assert.equal(requests.some(request => request.method !== 'GET'), false)
      assert.equal(requests.filter(request => request.url.includes('tile.openstreetmap.org')).some(request => /PIG-|ABONADO/.test(request.url)), false)
      results.push({ width, theme, passed: true }); await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
