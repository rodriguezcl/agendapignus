const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const out = path.resolve('tmp/visual-qa/work-completion'); fs.mkdirSync(out, { recursive: true })
const appStyles = [...fs.readFileSync('src/App.jsx', 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => `import './src/${m[1].replace(/^\.\//, '')}';`).join('\n')
const styles = [...fs.readFileSync('src/main.jsx', 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => `import './src/${m[1].replace(/^\.\//, '')}';${m[1] === './style.css' ? '\n' + appStyles : ''}`).join('\n')
buildSync({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Report from './src/components/TechnicianReportModal.jsx';
import Collections from './src/components/Collections.jsx';
import FollowupSummary from './src/features/followups/FollowupSummary.jsx';
import{ServiceExtraFields}from'./src/features/agenda/presentation/AgendaFields.jsx';
import{PermissionsProvider}from'./src/presentation/contexts/permissions-context.jsx';${styles}
const base={id:'qa',customerId:'c',client:'PIG-6299 CLIENTE DE PRUEBA',date:'2026-10-26',status:'Pendiente',amount:'83160',paymentMethod:'Efectivo',serviceId:4,service:'Service de alarma',serviceTypes:[{id:4,name:'Service de alarma'},{id:5,name:'Service de cámaras'}],hasFollowup:true};
const mode=new URLSearchParams(location.search).get('mode');document.body.classList.toggle('dark',location.search.includes('dark'));
function Fixture(){const[task,setTask]=useState(base);return <PermissionsProvider user={{id:'admin',name:'Administración',roleCode:'administrator'}}>{mode.startsWith('report')?<Report record={{...base,hasFollowup:mode!=='report-new'}} type="Completado" serviceLabel="Alarma + cámaras" onPendingAttachmentsChange={()=>{}} onClose={()=>{}} onSubmit={data=>{window.submitted=data}}/>:mode==='collections'?<Collections history={[{...base,status:'Completado',collectionReview:{reason:'Quedaron cámaras pendientes. Revisá qué importe corresponde a lo realizado.'}}]} canManage onSave={async data=>{window.submitted=data}} setNotice={()=>{}}/>:mode==='planning'?<div className="modal-layer"><section className="modal"><h2>Planificar servicio</h2><ServiceExtraFields className="collection-fields" task={task} service={base.service} onChange={patch=>{setTask(t=>({...t,...patch}));window.patch=patch}}/></section></div>:<div className="modal-layer"><section className="modal"><h2>Detalle del servicio</h2><FollowupSummary record={{...base,workCompletion:{at:'v1',items:[{id:4,name:'Service de alarma',status:'completed'},{id:5,name:'Service de cámaras',status:'pending'}]}}}/></section></div>}</PermissionsProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, outfile: path.join(out, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', external: ['/pignus-owl-white.svg', '/logo-pignus.png'], logLevel: 'silent' })
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const [mode, width, theme] of [['report', 390, 'light'], ['report', 360, 'dark'], ['report-new', 390, 'light'], ['collections', 1280, 'light'], ['collections', 390, 'dark'], ['planning', 390, 'light'], ['planning', 1280, 'light'], ['planning', 390, 'dark'], ['management', 390, 'light']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.route('**/*', async route => {
        const u = new URL(route.request().url())
        if (['/fixture.js', '/fixture.css'].includes(u.pathname)) return route.fulfill({ path: path.join(out, u.pathname.slice(1)), contentType: u.pathname.endsWith('css') ? 'text/css' : 'application/javascript' })
        if (u.pathname === '/api/history/work-completion') return route.fulfill({ json: { report: { at: 'v1', items: [{ id: 4, name: 'Alarma', status: 'completed' }, { id: 5, name: 'Cámaras', status: 'pending' }], management: { at: '2026-10-26T17:00:00Z', byName: 'Administración', note: route.request().postDataJSON().note } } } })
        if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { items: [], attachments: [], candidates: [], duplicateToken: 'test-only' } })
        if (u.pathname !== '/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>' })
      })
      await page.goto(`https://work.test/?mode=${mode}&theme=${theme}`)
      if (mode.startsWith('report')) {
        await page.getByRole('combobox', { name: 'Service de alarma', exact: true }).selectOption('completed')
        assert(await page.getByRole('button', { name: 'Continuar', exact: true }).isDisabled())
        await page.getByRole('combobox', { name: 'Service de cámaras', exact: true }).selectOption('pending')
        if (mode === 'report-new') {
          await page.getByRole('checkbox', { name: 'Solicitar acción / seguimiento' }).check()
          await page.getByRole('combobox', { name: 'Service de cámaras', exact: true }).selectOption('completed')
          assert.equal(await page.getByRole('checkbox', { name: 'Solicitar acción / seguimiento' }).isChecked(), false)
          await page.getByRole('combobox', { name: 'Service de cámaras', exact: true }).selectOption('pending')
        }
        await page.getByRole('textbox', { name: /Observaci/ }).fill('Alarma reparada sin cargo. Cámaras pendientes de nueva visita.')
        await page.screenshot({ path: path.join(out, `${mode}-${width}-${theme}.png`), fullPage: true })
        await page.getByRole('button', { name: 'Continuar', exact: true }).click()
        await page.getByText(/Se registrarán 1 trabajo/).waitFor()
        await page.getByRole('button', { name: 'Sí, confirmar estado' }).click()
        await page.waitForFunction(() => Boolean(window.submitted))
        if (mode === 'report-new') assert.equal((await page.evaluate(() => window.submitted)).followup.type, 'Coordinar visita')
        assert.deepEqual((await page.evaluate(() => window.submitted)).workResults, [{ id: 4, status: 'completed' }, { id: 5, status: 'pending' }])
      } else if (mode === 'collections') {
        await page.getByRole('combobox', { name: 'Estado del pago' }).selectOption('review')
        await page.getByRole('button', { name: /Gestionar cobranza de/ }).click()
        assert.equal(await page.getByRole('button', { name: 'Confirmar pago', exact: true }).count(), 0)
        await page.screenshot({ path: path.join(out, `${mode}-${width}-${theme}.png`), fullPage: true })
        await page.getByRole('button', { name: 'Anular cobranza', exact: true }).click()
        assert(await page.getByRole('button', { name: 'Confirmar anulación' }).isDisabled())
        await page.getByRole('textbox', { name: 'Motivo de la gestión (obligatorio)' }).fill('El importe corresponde a cámaras que no se realizaron.')
        await page.getByRole('button', { name: 'Confirmar anulación' }).click()
        await page.waitForFunction(() => Boolean(window.submitted)); assert.equal((await page.evaluate(() => window.submitted)).action, 'void')
      } else if (mode === 'planning') {
        const total = page.getByRole('textbox', { name: 'Monto total', exact: true })
        assert(await total.evaluate(el => el.readOnly))
        assert.equal(await total.inputValue(), '')
        await page.getByRole('textbox', { name: 'Service de alarma', exact: true }).fill('0')
        assert.equal((await page.evaluate(() => window.patch)).amount, '0')
        const cameras = page.getByRole('textbox', { name: 'Service de cámaras', exact: true })
        for (const value of ['125,50', '125.50']) {
          await cameras.fill(value)
          assert.equal((await page.evaluate(() => window.patch)).amount, '125.5')
          assert.match(await total.inputValue(), /125,50/)
        }
        await page.getByRole('textbox', { name: 'Service de cámaras', exact: true }).fill('83160')
        await page.getByRole('heading').click()
        assert.deepEqual((await page.evaluate(() => window.patch)).serviceCharges, [{ id: 4, amount: '0' }, { id: 5, amount: '83160' }])
        assert.equal((await page.evaluate(() => window.patch)).amount, '83160')
        await total.scrollIntoViewIfNeeded()
        assert((await total.boundingBox()).y > (await cameras.boundingBox()).y)
        await page.screenshot({ path: path.join(out, `${mode}-${width}-${theme}.png`), fullPage: true })
      } else {
        await page.getByRole('button', { name: 'Registrar gestión de pendientes' }).click()
        await page.getByRole('textbox', { name: 'Cómo se gestionaron los pendientes' }).fill('Nueva visita coordinada desde el ticket.')
        await page.getByRole('button', { name: 'Registrar gestión', exact: true }).click()
        await page.getByText('Nueva visita coordinada desde el ticket.', { exact: false }).waitFor()
        await page.screenshot({ path: path.join(out, `${mode}-${width}-${theme}.png`), fullPage: true })
      }
      assert.deepEqual(errors, [])
      const overflow = await page.locator('.modal').evaluateAll(elements => elements.map(el => ({ width: el.clientWidth, scroll: el.scrollWidth })).filter(r => r.scroll > r.width + 2))
      assert.deepEqual(overflow, []); console.log('PASS', mode, width, theme); await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
