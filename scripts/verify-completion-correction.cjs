const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const out = path.resolve('tmp/visual-qa/completion-correction'); fs.mkdirSync(out, { recursive: true })
const appStyles = [...fs.readFileSync('src/App.jsx', 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => `import './src/${m[1].replace(/^\.\//, '')}';`).join('\n')
const styles = [...fs.readFileSync('src/main.jsx', 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => `import './src/${m[1].replace(/^\.\//, '')}';${m[1] === './style.css' ? '\n' + appStyles : ''}`).join('\n')
buildSync({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{HistoryManagementDetail}from'./src/features/history/presentation/HistoryManagementDetail.jsx';
import{PermissionsProvider}from'./src/presentation/contexts/permissions-context.jsx';${styles}
const user={id:'admin',name:'Administración',roleCode:'administrator'};
const record={id:'qa',client:'PIG-7065 CLIENTE DE PRUEBA',date:'2026-10-27',time:'09:30',status:'Pendiente',serviceId:'alarm',service:'Instalación de alarma',serviceTypes:[{id:'alarm',name:'Instalación de alarma'},{id:'other',name:'Otro service'}],technicians:['Técnico de prueba'],technicalStatus:'Reprogramación solicitada',workCompletion:{at:'v1',items:[{id:'alarm',name:'Instalación de alarma',status:'pending'},{id:'other',name:'Otro service',status:'pending'}]}};
document.body.classList.toggle('dark',location.search.includes('dark'));
createRoot(document.getElementById('root')).render(<PermissionsProvider user={user}><HistoryManagementDetail record={record} customers={[]} services={record.serviceTypes} employees={[]} authUser={user} close={()=>{window.modalClosed=true}} setHistory={()=>{}} persistHistoryRecord={async(base,next,correction)=>{window.submitted={base,correction}}}/></PermissionsProvider>);
` }, outfile: path.join(out, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', external: ['/pignus-owl-white.svg', '/logo-pignus.png'], logLevel: 'silent' })
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const [width, theme] of [[1280, 'light'], [390, 'light'], [360, 'dark']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.route('**/*', route => {
        const u = new URL(route.request().url())
        if (['/fixture.js', '/fixture.css'].includes(u.pathname)) return route.fulfill({ path: path.join(out, u.pathname.slice(1)), contentType: u.pathname.endsWith('css') ? 'text/css' : 'application/javascript' })
        if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { items: [], attachments: [] } })
        if (u.pathname !== '/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>' })
      })
      await page.goto(`https://correction.test/?theme=${theme}`)
      await page.getByRole('button', { name: 'Corregir resultado', exact: true }).click()
      const confirm = page.getByRole('button', { name: 'Confirmar corrección y completar', exact: true })
      assert(await confirm.isDisabled())
      await page.getByRole('checkbox', { name: 'Instalación de alarma', exact: true }).check()
      await page.getByRole('checkbox', { name: 'Otro service', exact: true }).check()
      await page.getByRole('textbox', { name: 'Motivo de la corrección *', exact: true }).fill('Se verificó que todos los trabajos fueron realizados; reprogramación marcada por error.')
      await confirm.click()
      assert.equal(await page.evaluate(() => Boolean(window.submitted)), false)
      await page.locator('#zone-1-name').fill('Puerta principal')
      await page.getByRole('combobox', { name: 'Atributo de zona 1', exact: true }).selectOption('Demorada')
      await page.getByRole('combobox', { name: 'Sensor de zona 1', exact: true }).selectOption('Magnético cableado')
      await page.getByRole('heading', { name: 'Corregir resultado', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(out, `${width}-${theme}.png`), fullPage: true })
      const overflow = await page.locator('.modal').evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 2).length)
      assert.equal(overflow, 0)
      await confirm.click(); await page.waitForFunction(() => Boolean(window.submitted))
      const saved = await page.evaluate(() => window.submitted)
      assert.deepEqual(saved.correction.completedIds, ['alarm', 'other'])
      assert.equal(saved.correction.alarmZones.length, 1)
      assert.equal(saved.base.technicalStatus, 'Reprogramación solicitada')
      assert.equal(await page.evaluate(() => window.modalClosed), true)
      assert.deepEqual(errors, []); console.log('PASS', width, theme); await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })

