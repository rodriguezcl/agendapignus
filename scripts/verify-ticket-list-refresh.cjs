// Synthetic data only. No production endpoints, credentials or writes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/ticket-list-refresh')
fs.mkdirSync(output, { recursive: true })
const cssImports = ['src/App.jsx', 'src/main.jsx'].flatMap(file => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]).map(match => `import '${match[1]}';`).join('\n')
const bundle = buildSync({
  stdin: { contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import Tickets from './features/tickets/Tickets.jsx'; import {PermissionsProvider} from './presentation/contexts/permissions-context.jsx'; ${cssImports}
    function Fixture(){const [revision,setRevision]=useState(0);window.recreatePermissions=()=>setRevision(v=>v+1);return <PermissionsProvider user={{id:'qa-user',roleCode:'administrator',revision}}><div className="app-shell" data-theme="light"><main style={{marginLeft:0,width:'100%'}}><div className="content"><Tickets/></div></main></div></PermissionsProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: 'jsx', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent'
})
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text, css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const baseItems = Array.from({ length: 20 }, (_, n) => ({ id: String(n), number: 100000 + n, title: `Revisión de alarma · Cliente de prueba ${n + 1}`, status: 'Nuevo', priority: 'Media', origin: 'internal', customerName: `Cliente ${n + 1}`, updatedAt: '2026-10-30T14:00:00Z' }))
async function run() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() => {
      window.timeOffset = 0
      const originalNow = Date.now
      Date.now = () => originalNow() + window.timeOffset
      window.poll = () => { window.timeOffset += 61000; window.dispatchEvent(new Event('focus')) }
    })
    const requests = [], errors = []
    let items = baseItems, hold = null, held = null, fail = false
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
      if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
      if (url.pathname === '/api/tickets') {
        requests.push(Object.fromEntries(url.searchParams))
        if (url.searchParams.get('view') === 'metadata') return route.fulfill({ json: { assignees: [], config: { categories: [], areas: [] } } })
        if (hold) { held = true; await hold }
        return route.fulfill(fail ? { status: 503, json: { error: 'Sin conexión de prueba' } } : { json: { items, total: 45, counts: { Nuevo: 45, 'En gestión': 0 }, page: Number(url.searchParams.get('page')), pageSize: 20 } })
      }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://tickets.test/')
    await page.locator('tbody tr').last().waitFor()
    assert.equal(requests.filter(r => r.view === 'list').length, 1)
    assert.equal(requests.find(r => r.view === 'metadata').includeMailStatus, 'false')
    await page.evaluate(() => { window.recreatePermissions(); for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus')) })
    await page.waitForTimeout(200)
    assert.equal(requests.length, 2, 'same permissions and repeated focus must not refetch')
    await page.evaluate(() => {
      window.scrollTo(0, 800)
      window.tableBefore = document.querySelector('tbody')
    })
    const position = await page.evaluate(() => ({ scroll: scrollY, top: document.querySelectorAll('tbody tr')[10].getBoundingClientRect().top }))
    let release
    hold = new Promise(resolve => { release = resolve })
    items = [...baseItems].reverse()
    await page.evaluate(() => window.poll())
    await page.waitForFunction(() => document.querySelector('.tickets-update-bar').textContent.includes('Buscando'))
    assert.equal(await page.locator('tbody tr').count(), 20)
    assert.equal(await page.evaluate(() => document.querySelector('tbody') === window.tableBefore), true)
    assert.equal(held, true, 'background request reached the server')
    release(); hold = null
    await page.getByRole('button', { name: 'Actualizar listado', exact: true }).waitFor()
    assert.ok((await page.locator('tbody tr').first().textContent()).includes('100000'))
    assert.deepEqual(await page.evaluate(() => ({ scroll: scrollY, top: document.querySelectorAll('tbody tr')[10].getBoundingClientRect().top })), position)
    await page.screenshot({ path: path.join(output, 'reading-stable.png'), fullPage: true })
    await page.getByRole('button', { name: 'Actualizar listado', exact: true }).click()
    assert.ok((await page.locator('tbody tr').first().textContent()).includes('100019'))
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await page.getByText('45 tickets · página 2 de 3', { exact: true }).waitFor()
    const before = requests.length
    await page.getByRole('button', { name: /^En gestión/ }).click()
    await page.getByText('45 tickets · página 1 de 3', { exact: true }).waitFor()
    assert.equal(requests.length, before + 1, 'filter resets page in a single request')
    assert.equal(requests.at(-1).page, '1')
    fail = true
    await page.evaluate(() => { window.scrollTo(0, 700); window.poll() })
    await page.getByText('No se pudo actualizar. Se conserva el listado.', { exact: true }).waitFor()
    assert.equal(await page.locator('tbody tr').count(), 20)
    assert.equal(await page.evaluate(() => scrollY), 700)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(output, 'mobile.png') })
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('main,.content,.tickets-page,.tickets-update-bar')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => [el.className,el.getBoundingClientRect().right])), [], 'mobile containers must not overflow horizontally')
    assert.deepEqual(errors, [])
    console.log('PASS: stable rows and scroll during pending/success/error refresh; no repeated requests on context/focus; single page reset; desktop/mobile rendered.')
  } finally { await browser.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
