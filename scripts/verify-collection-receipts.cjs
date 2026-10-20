/* Receipt UI review against the real collection domain and an in-memory file
   store. All HTTP is intercepted; no production data or storage is accessed. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tmp/visual-qa/collection-receipts')
fs.mkdirSync(out, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
  .map(match => `import '${match[1]}';`).join('\n')
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4s8AAAAASUVORK5CYII=', 'base64')
const pdfFile = name => ({ name, mimeType: 'application/pdf', buffer: pdf })
const imageFile = name => ({ name, mimeType: 'image/png', buffer: png })
const fixture = `
import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './App.jsx';
import Collections from './components/Collections.jsx';
import {PermissionsProvider} from './presentation/contexts/permissions-context.jsx';
import policy from '../api/_lib/permission-catalog.cjs';
${cssImports}
const permissions=ids=>({__catalogV2:true,...Object.fromEntries(policy.CATALOG.map(item=>[item.id,ids.includes(item.id)]))});
const read=['collections.view','records.financial','collections.timeline'];
const users={
  manager:{id:'receipt-manager',roleCode:'receipt-manager',role:'Cobranzas',permissions:permissions([...read,'collections.confirm','collections.amount','collections.method'])},
  confirmer:{id:'receipt-confirmer',roleCode:'receipt-confirmer',role:'Confirmador',permissions:permissions([...read,'collections.confirm'])},
  corrector:{id:'receipt-corrector',roleCode:'receipt-corrector',role:'Corrector',permissions:permissions([...read,'collections.amount','collections.method'])},
  reader:{id:'receipt-reader',roleCode:'receipt-reader',role:'Consulta',permissions:permissions(read)},
  writeAssigned:{id:'receipt-write-assigned',roleCode:'receipt-write-assigned',role:'Gestionar asignados',permissions:{...permissions([...read,'collections.confirm']),'scope.services.write.assigned':true}},
  technical:{id:'receipt-tech',roleCode:'receipt-tech',role:'Técnico',permissions:permissions(['technical.view','records.read','records.financial','service.documents.read'])},
  noFinancial:{id:'receipt-no-financial',roleCode:'receipt-no-financial',role:'Sin importes',permissions:permissions(['collections.view'])},
  assigned:{id:'receipt-assigned',roleCode:'receipt-assigned',role:'Asignados',permissions:{...permissions(read),'scope.services.read.assigned':true}}
};
const record=(id,paymentMethod,collection)=>({
  id,client:'CLIENTE SINTÉTICO '+id,date:'2026-10-20',time:'08:30',status:'Completado',
  service:'Servicio de alarma',amount:'15000',paymentMethod,technicianIds:['receipt-other'],
  technicians:['Técnico sintético'],createdBy:{id:'receipt-author',name:'Autor sintético'},
  ...(collection?{collection}:{})
});
const confirmed={status:'confirmed',confirmedAt:'2026-10-16T12:00:00Z',confirmedBy:{id:'receipt-author',name:'Autor sintético'},events:[]};
const seed=()=>[
  record('cash','Efectivo'),record('transfer','Transferencia'),record('debit','Débito'),record('credit','Crédito'),
  record('historical','Transferencia',structuredClone(confirmed)),record('historical-no-receipt','Transferencia',structuredClone(confirmed)),
  record('confirmed-cash','Efectivo',structuredClone(confirmed)),
  {...record('journey','Transferencia'),status:'Cancelado',technicianIds:['receipt-write-assigned'],serviceJourney:{id:'journey',index:1,total:2}},
  {...record('journey-next','Transferencia'),date:'2026-10-21',status:'Pendiente',serviceJourney:{id:'journey',index:2,total:2}}
];
const NativeReader=window.FileReader;
window.__receiptReaders=[];
window.__receiptObjectUrls=new Set();
const createObjectURL=URL.createObjectURL.bind(URL),revokeObjectURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createObjectURL(blob);window.__receiptObjectUrls.add(url);return url};
URL.revokeObjectURL=url=>{window.__receiptObjectUrls.delete(url);revokeObjectURL(url)};
window.FileReader=class extends NativeReader {
  readAsDataURL(file) {
    if(window.__holdReceiptPreparation) window.__receiptReaders.push(()=>super.readAsDataURL(file));
    else super.readAsDataURL(file);
  }
};
window.releaseReceiptPreparation=()=>{
  window.__holdReceiptPreparation=false;
  for(const read of window.__receiptReaders.splice(0)) read();
};
function Harness({theme,revision}) {
  const [history,setHistory]=useState(seed),[access,setAccess]=useState('manager'),[openRequest,setOpenRequest]=useState(null);
  window.__receiptHistory=history;window.__receiptUser=users[access];
  window.openReceiptRecord=id=>setOpenRequest({id});
  window.setReceiptAccess=setAccess;
  const handled=useCallback(()=>setOpenRequest(null),[]);
  const notice=useCallback(message=>window.__receiptNotices.push(message),[]);
  const save=useCallback(async input=>{
    const response=await fetch('/api/collections/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'No se pudo guardar.');
    setHistory(result.state.history);
  },[]);
  return <PermissionsProvider user={users[access]}>
    <div className="app-shell" data-theme={theme} data-qa-revision={revision} data-qa-access={access}>
      <aside className="sidebar"><div className="qa-brand">PIGNUS</div><nav><button className="active">Cobranzas</button></nav><div className="sidebar-bottom">Prueba · Datos sintéticos</div></aside>
      <main><header className="topbar"><div className="page-heading"><h1>Cobranzas</h1><div id="module-description-slot"/></div></header><section className="content">
        <Collections history={history} canManage onSave={save} openRequest={openRequest} onOpenRequestHandled={handled} setNotice={notice}/>
      </section></main>
    </div>
  </PermissionsProvider>;
}
const host=createRoot(document.getElementById('root'));let revision=0;
window.renderReceiptReview=(theme='light')=>{
  window.__receiptNotices=[];window.__receiptFailure=false;window.__holdReceiptPreparation=false;window.__receiptReaders=[];
  document.body.classList.toggle('dark',theme==='dark');
  const next=++revision;host.render(<Harness key={next} revision={next} theme={theme}/>);return next;
};
window.renderReceiptReview(new URLSearchParams(location.search).get('theme')||'light');
`
const bundle = buildSync({
  stdin: { contents: fixture, loader: 'jsx', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, outdir: 'out', format: 'iife',
  external: ['/logo-pignus.png', '/pignus-owl-white.svg'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' },
  loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent'
})
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '')
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script src="/qa.js"></script></body></html>'
const widths = (process.env.RECEIPT_WIDTHS || '1440,390,320').split(',').map(Number)
const themes = (process.env.RECEIPT_THEMES || 'light,dark').split(',')

async function open(page, id) {
  await page.evaluate(id => window.openReceiptRecord(id), id)
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), new RegExp(`CLIENTE SINTÉTICO ${id}`))
  return dialog
}
async function close(page) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Cerrar edición', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
}
async function setAccess(page, access) {
  await page.evaluate(access => window.setReceiptAccess(access), access)
  await page.waitForFunction(expected => document.querySelector('.app-shell')?.dataset.qaAccess === expected, access)
}
async function savedRecord(page, id) {
  return page.evaluate(id => window.__receiptHistory.find(record => record.id === id), id)
}
async function assertFits(page, name) {
  const geometry = await page.getByRole('dialog').evaluate(dialog => {
    const rect = dialog.getBoundingClientRect()
    return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }
  })
  assert(geometry.scrollWidth <= geometry.viewport + 1, `${name}: no page overflow`)
  assert(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, `${name}: editor fits the viewport`)
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true })
  return geometry
}

;(async () => {
  const { manageCollection } = await import('../src/domain/collections/collections.mjs')
  const { prepareCollectionReceipt, handleCollectionReceipt } = require('../api/_lib/collection-receipts.cjs')
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  try {
    for (const width of widths) for (const theme of themes) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width <= 640, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const errors = [], commands = [], receiptReads = [], externalRequests = [], files = new Map()
      const key = (recordId, receiptId) => `${recordId}:${receiptId}`
      const store = {
        ensure: async () => {},
        get: async (recordId, receiptId) => files.get(key(recordId, receiptId)) || null,
        put: async (recordId, file) => { files.set(key(recordId, file.id), file) }
      }
      page.on('pageerror', error => errors.push(error.message))
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== 'https://receipt-qa.test') { externalRequests.push(request.url()); return route.abort() }
        if (url.pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/qa.js') return route.fulfill({ contentType: 'text/javascript', body: js })
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/api/collections/manage') {
          const input = request.postDataJSON()
          commands.push(input)
          const { history, user, fail } = await page.evaluate(() => ({ history: window.__receiptHistory, user: window.__receiptUser, fail: window.__receiptFailure }))
          if (fail) return route.fulfill({ status: 503, json: { error: 'Fallo simulado: no se guardó el pago ni el archivo.' } })
          try {
            const state = { history, agenda: {} }, now = '2026-10-20T15:00:00Z'
            const prepared = await prepareCollectionReceipt(state, input, user, store, now)
            const result = manageCollection(state, input, user, now, prepared)
            if (prepared.file) await store.put(input.recordId, prepared.file)
            return route.fulfill({ json: { ok: true, state: result.state } })
          } catch (error) {
            console.error(`Synthetic collection command rejected (${input.action}): ${error.message}`)
            return route.fulfill({ status: error.statusCode || 400, json: { error: error.message } })
          }
        }
        const receipt = url.pathname.match(/^\/api\/collections\/([^/]+)\/receipts\/([^/]+)$/)
        if (receipt) {
          receiptReads.push(url.pathname)
          const { history, user } = await page.evaluate(() => ({ history: window.__receiptHistory, user: window.__receiptUser }))
          const headers = {}
          let body
          const response = { setHeader: (key, value) => { headers[key] = String(value) }, end: value => { body = value } }
          try {
            await handleCollectionReceipt({ req: { method: request.method() }, res: response, state: { history, customers: [] }, user, recordId: decodeURIComponent(receipt[1]), receiptId: decodeURIComponent(receipt[2]), store })
            return route.fulfill({ status: response.statusCode, headers, body })
          } catch (error) { return route.fulfill({ status: error.statusCode || 400, json: { error: error.message } }) }
        }
        return route.fulfill({ status: 204 })
      })
      await page.goto(`https://receipt-qa.test/review?theme=${theme}`)
      await page.locator('.collections-page').waitFor()

      let dialog = await open(page, 'cash')
      assert(await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).isEnabled(), 'Cash can be confirmed without a receipt')
      await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal((await savedRecord(page, 'cash')).collection.status, 'confirmed')
      assert.equal(commands.at(-1).receipt, undefined, 'Cash confirmation does not fabricate a receipt')

      for (const id of ['transfer', 'debit', 'credit']) {
        dialog = await open(page, id)
        assert(await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).isDisabled(), `${id}: noncash confirmation requires evidence`)
        assert.equal(await dialog.locator('.collection-receipt-input').getAttribute('multiple'), null, 'Only one receipt can be selected')
        await close(page)
      }

      await setAccess(page, 'corrector')
      dialog = await open(page, 'historical-no-receipt')
      assert.equal(await dialog.locator('.collection-receipt-input,.collection-receipt-camera').count(), 0, 'Correction permission alone does not grant receipt upload')
      await dialog.getByLabel(/^Monto/).focus()
      await dialog.getByLabel(/^Monto/).fill('16000')
      await dialog.getByLabel('Observación (opcional)', { exact: true }).click()
      assert.equal(await dialog.getByLabel(/^Monto/).inputValue(), '16.000,00')
      const historicalCorrection = dialog.getByRole('button', { name: 'Guardar corrección', exact: true })
      assert(await historicalCorrection.isEnabled(), 'Historical amount correction remains possible without inventing old evidence')
      await historicalCorrection.click()
      await dialog.waitFor({ state: 'detached' }).catch(async error => {
        console.error(JSON.stringify({ phase: 'historical-correction', text: await dialog.innerText(), commands: commands.map(input => ({ action: input.action, recordId: input.recordId, amount: input.amount })) }))
        throw error
      })
      const correctedHistorical = await savedRecord(page, 'historical-no-receipt')
      assert.equal(correctedHistorical.amount, '16000')
      assert.equal(correctedHistorical.collection.confirmedAt, '2026-10-16T12:00:00Z')
      assert.equal(correctedHistorical.collection.receipt, undefined)
      await setAccess(page, 'manager')
      dialog = await open(page, 'transfer')
      await dialog.locator('.collection-receipt-input').setInputFiles({ name: 'archivo.txt', mimeType: 'text/plain', buffer: Buffer.from('archivo sintético no válido') })
      await dialog.getByRole('alert').waitFor()
      assert.equal(await dialog.locator('.collection-receipt-draft').count(), 0, 'Invalid format does not become evidence')
      const confirm = dialog.getByRole('button', { name: 'Confirmar pago', exact: true })
      assert(await confirm.isDisabled())
      await page.evaluate(() => { window.__holdReceiptPreparation = true })
      await dialog.locator('.collection-receipt-camera').setInputFiles(imageFile('foto-comprobante.png'))
      await dialog.locator('.collection-receipt-preparing').waitFor()
      assert(await confirm.isDisabled(), 'Confirm is disabled while image processing is pending')
      assert.equal(await dialog.locator('.collection-receipt-camera').getAttribute('capture'), 'environment', 'Camera picker requests the rear camera')
      const beforePrepareCommands = commands.length
      await page.evaluate(() => window.releaseReceiptPreparation())
      await dialog.locator('.collection-receipt-preparing').waitFor({ state: 'detached' })
      await dialog.locator('.collection-receipt-preview').waitFor()
      assert(await confirm.isEnabled())
      assert.equal(commands.length, beforePrepareCommands, 'Preparing a file does not upload or confirm anything')
      const originalPreviewUrl = await dialog.locator('.collection-receipt-review').getAttribute('href')
      assert.match(originalPreviewUrl, /^blob:https:\/\/receipt-qa\.test\//, 'Review link uses a local temporary blob rather than uploading the draft')
      assert.equal(await dialog.locator('.collection-receipt-review').getAttribute('target'), '_blank')
      await dialog.getByRole('button', { name: 'Quitar selección', exact: true }).click()
      assert(await confirm.isDisabled(), 'Removing the draft makes noncash confirmation unavailable again')
      assert.equal(await page.evaluate(url => window.__receiptObjectUrls.has(url), originalPreviewUrl), false, 'Removing a draft revokes its temporary preview URL')
      await dialog.locator('.collection-receipt-input').setInputFiles(imageFile('foto-comprobante.png'))
      await dialog.locator('.collection-receipt-preview').waitFor()
      const retryPreviewUrl = await dialog.locator('.collection-receipt-review').getAttribute('href')
      const geometry = await assertFits(page, `image-ready-${width}-${theme}`)
      await page.evaluate(() => { window.__receiptFailure = true })
      await confirm.click()
      await dialog.getByRole('alert').filter({ hasText: 'Fallo simulado' }).waitFor()
      const failed = commands.at(-1)
      assert.equal(failed.action, 'confirm')
      assert(failed.receipt.data.startsWith('data:image/'), 'Receipt is sent with the confirmation command')
      assert.equal(files.size, 0, 'Failure does not leave an orphan file in the synthetic store')
      assert.notEqual((await savedRecord(page, 'transfer')).collection?.status, 'confirmed')
      assert(await dialog.locator('.collection-receipt-preview').isVisible(), 'Failed save retains the selected receipt')
      assert.equal(await dialog.locator('.collection-receipt-review').getAttribute('href'), retryPreviewUrl, 'Failed save preserves the local full-size review link')
      await page.evaluate(() => { window.__receiptFailure = false })
      await confirm.click()
      await dialog.waitFor({ state: 'detached' })
      const transferred = await savedRecord(page, 'transfer')
      assert.equal(transferred.collection.status, 'confirmed')
      assert.equal(commands.at(-1).receipt.id, failed.receipt.id, 'Retry retains the same selected receipt')
      assert(transferred.collection.receipt?.id, 'Saved record references its persisted receipt')
      assert.equal(files.size, 1)
      assert.equal(await page.evaluate(url => window.__receiptObjectUrls.has(url), retryPreviewUrl), false, 'Closing a saved editor revokes its draft URL')

      await setAccess(page, 'confirmer')
      dialog = await open(page, 'historical')
      const historicalBefore = await savedRecord(page, 'historical')
      await dialog.locator('.collection-receipt-input').setInputFiles(pdfFile('comprobante-historico.pdf'))
      await dialog.locator('.collection-receipt-draft').waitFor()
      await dialog.getByRole('button', { name: 'Adjuntar comprobante', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      const attached = await savedRecord(page, 'historical')
      assert.equal(commands.at(-1).action, 'receipt', 'Historical attachment uses its own receipt action')
      assert.equal(attached.collection.confirmedAt, historicalBefore.collection.confirmedAt, 'Adding evidence does not reconfirm a historical payment')
      assert.equal(attached.amount, historicalBefore.amount)
      const originalReceiptId = attached.collection.receipt.id
      dialog = await open(page, 'historical')
      await dialog.locator('.collection-receipt-input').setInputFiles(pdfFile('comprobante-reemplazado.pdf'))
      await dialog.locator('.collection-receipt-draft').waitFor()
      await dialog.getByRole('button', { name: 'Reemplazar comprobante', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      const replaced = await savedRecord(page, 'historical')
      assert.notEqual(replaced.collection.receipt.id, originalReceiptId)
      assert(replaced.collection.receipts.some(receipt => receipt.id === originalReceiptId), 'Replacing a receipt preserves the former version')
      assert.equal(replaced.collection.confirmedAt, historicalBefore.collection.confirmedAt)
      assert(files.has(key('historical', originalReceiptId)), 'Former receipt remains in private storage')

      await setAccess(page, 'manager')
      dialog = await open(page, 'confirmed-cash')
      await dialog.getByRole('combobox', { name: /^Forma de pago/ }).selectOption('Transferencia')
      const correct = dialog.getByRole('button', { name: 'Guardar corrección', exact: true })
      assert(await correct.isDisabled(), 'Changing a confirmed cash payment to transfer requires a new receipt')
      await dialog.locator('.collection-receipt-input').setInputFiles(pdfFile('cambio-de-medio.pdf'))
      await dialog.locator('.collection-receipt-draft').waitFor()
      assert(await correct.isEnabled())
      await correct.click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal((await savedRecord(page, 'confirmed-cash')).paymentMethod, 'Transferencia')

      await setAccess(page, 'reader')
      dialog = await open(page, 'historical')
      assert.equal(await dialog.locator('.collection-receipt-input,.collection-receipt-camera').count(), 0, 'Readers cannot attach or replace receipts')
      const receiptLinks = dialog.locator('a[href*="/api/collections/historical/receipts/"]')
      assert(await receiptLinks.count() >= 1, 'Authorized readers receive a private receipt link')
      const receiptUrl = await receiptLinks.first().getAttribute('href')
      assert.match(receiptUrl, /^\/api\/collections\/historical\/receipts\//)
      const readResult = await page.evaluate(async url => {
        const response = await fetch(url)
        return { status: response.status, cache: response.headers.get('cache-control'), contentType: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength }
      }, receiptUrl)
      assert.equal(readResult.status, 200)
      assert.equal(readResult.cache, 'private, no-store', 'Private receipts cannot be cached for another role')
      assert.equal(readResult.contentType, 'application/pdf')
      assert.equal(readResult.bytes, pdf.length)
      await assertFits(page, `historical-read-${width}-${theme}`)
      await close(page)
      await setAccess(page, 'writeAssigned')
      dialog = await open(page, 'historical')
      assert.equal(await dialog.locator('.collection-receipt-input,.collection-receipt-camera').count(), 0, 'Receipt upload obeys the write scope even when the payment is readable')
      assert(await dialog.locator('a[href*="/api/collections/historical/receipts/"]').count() >= 1, 'Read access does not imply write access')
      await close(page)
      dialog = await open(page, 'journey')
      assert.equal(await dialog.getAttribute('aria-label'), 'Detalle de cobranza', 'Unassigned effective journey keeps the collection read-only')
      assert.equal(await page.getByRole('button', { name: 'Ver cobranza de CLIENTE SINTÉTICO journey', exact: true }).count(), 1, 'Collection action considers the effective journey write scope')
      assert.equal(await dialog.locator('.collection-receipt-input,.collection-receipt-camera').count(), 0, 'Owner assignment alone does not grant receipt upload for another effective technician')
      assert.equal(await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).count(), 0, 'Owner assignment alone does not grant confirmation')
      await setAccess(page, 'noFinancial')
      assert.equal(await page.getByRole('dialog').count(), 0, 'Revoking financial access removes the open receipt details')
      assert.equal(await page.locator('a[href*="/receipts/"]').count(), 0, 'Revocation removes cached receipt links')
      await setAccess(page, 'technical')
      assert.equal(await page.locator('a[href*="/receipts/"],.collection-receipt-input').count(), 0, 'Technical attachment permissions do not expose receipts')
      await page.evaluate(() => window.openReceiptRecord('historical'))
      assert.equal(await page.locator('a[href*="/receipts/"],.collection-receipt-input').count(), 0, 'Opening a payment request cannot bypass missing collections access')
      assert.equal(await page.evaluate(async url => (await fetch(url)).status, receiptUrl), 403, 'Technical attachment permission cannot read a receipt through its private URL')

      assert.deepEqual(errors, [], 'No runtime errors')
      assert.equal(commands.filter(input => input.action === 'confirm').length, 3, 'Only cash confirmation and transfer failed/retry commands were submitted')
      results.push({
        width, theme, geometry, passed: true,
        commands: commands.map(input => ({ action: input.action, recordId: input.recordId, hasReceipt: Boolean(input.receipt) })),
        storedFiles: files.size, receiptReads, externalRequests, errors
      })
      await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    console.log(`Collection receipts: ${results.length} responsive/theme cases passed, mandatory evidence, atomic retry, historical attachment, replacement and permission revocation verified.`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
