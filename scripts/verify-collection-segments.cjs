/* Browser review with synthetic collections only. All requests are intercepted;
   the Argentina clock, permissions, amounts and pagination are deterministic. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tmp/visual-qa/collection-segments')
fs.mkdirSync(out, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
  .map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './App.jsx';
import Collections from './components/Collections.jsx';
import {PermissionsProvider} from './presentation/contexts/permissions-context.jsx';
import policy from '../api/_lib/permission-catalog.cjs';
${cssImports}
const permissionSet=ids=>({__catalogV2:true,...Object.fromEntries(policy.CATALOG.map(item=>[item.id,ids.includes(item.id)]))});
const read=['collections.view','records.financial','collections.timeline'];
const users={
  reader:{id:'segment-reader',roleCode:'segment-reader',role:'Consulta',permissions:permissionSet(read)},
  assigned:{id:'segment-assigned',roleCode:'segment-assigned',role:'Asignados',permissions:{...permissionSet(read),'scope.services.read.assigned':true}},
  noFinancial:{id:'segment-no-financial',roleCode:'segment-no-financial',role:'Sin importes',permissions:permissionSet(['collections.view'])},
  technical:{id:'segment-technical',roleCode:'segment-technical',role:'Técnico',permissions:permissionSet(['technical.view','records.read'])}
};
const record=(id,date,amount,assigned=false,confirmed=false)=>({
  id,date,amount:String(amount),client:'CLIENTE SINTÉTICO '+id,time:'08:30',status:'Completado',
  service:'Servicio de alarma',paymentMethod:'Efectivo',technicianIds:[assigned?'segment-assigned':'segment-other'],
  technicians:['Colaborador sintético'],
  ...(confirmed?{collection:{status:'confirmed',confirmedAt:'2026-10-18T15:00:00Z',confirmedBy:{id:'segment-author',name:'Autor sintético'},events:[]}}:{})
});
const seed=()=>[
  record('MATCH-old','2026-10-14',100.1,true),record('MATCH-today','2026-10-20',200.2),
  record('current-paid','2026-10-19',300.3,true,true),
  record('MATCH-future','2026-10-21',400.4,true),record('future-paid','2026-10-22',500.5,false,true),
  {...record('journey','2026-10-18',600.6,true),status:'Cancelado',serviceJourney:{id:'journey',index:1,total:2}},
  {...record('journey-next','2026-10-25',600.6),status:'Pendiente',serviceJourney:{id:'journey',index:2,total:2}},
  {...record('cancelled','2026-10-20',700.7),status:'Cancelado'},
  record('untracked','2026-10-13',800.8)
];
const bulk=()=>['current','future'].flatMap((group)=>Array.from({length:30},(_,index)=>
  record(group+'-'+String(index).padStart(2,'0'),group==='current'?'2026-10-20':'2026-10-21',(group==='current'?100:200)+index,true)));
function Harness({theme,revision,scenario}) {
  const [access,setAccess]=useState('reader'),[openRequest,setOpenRequest]=useState(null);
  const [history]=useState(scenario==='bulk'?bulk:seed);
  window.setSegmentAccess=setAccess;window.openSegmentRequest=setOpenRequest;
  const handled=useCallback(()=>setOpenRequest(null),[]);
  const notice=useCallback(message=>window.__segmentNotices.push(message),[]);
  const save=useCallback(async input=>{window.__segmentWrites.push(input);throw new Error('Read-only QA never writes');},[]);
  return <PermissionsProvider user={users[access]}><div className="app-shell" data-theme={theme} data-qa-revision={revision} data-qa-access={access}>
    <aside className="sidebar"><div className="qa-brand">PIGNUS</div><nav><button className="active">Cobranzas</button></nav><div className="sidebar-bottom">Prueba · Datos sintéticos</div></aside>
    <main><header className="topbar"><div className="page-heading"><h1>Cobranzas</h1><div id="module-description-slot"/></div></header><section className="content">
      <Collections history={history} canManage={false} onSave={save} openRequest={openRequest} onOpenRequestHandled={handled} setNotice={notice}/>
    </section></main></div></PermissionsProvider>;
}
const host=createRoot(document.getElementById('root'));let revision=0;
window.renderSegmentReview=(theme='light',scenario='base')=>{
  window.__segmentWrites=[];window.__segmentNotices=[];document.body.classList.toggle('dark',theme==='dark');
  const next=++revision;host.render(<Harness key={next} revision={next} theme={theme} scenario={scenario}/>);return next;
};
window.renderSegmentReview(new URLSearchParams(location.search).get('theme')||'light');
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
const widths = (process.env.SEGMENT_WIDTHS || '1440,390,320').split(',').map(Number)
const themes = (process.env.SEGMENT_THEMES || 'light,dark').split(',')
const segment = (page, id) => page.locator(`.collections-segment[data-segment="${id}"]`)
const rows = (page, id) => segment(page, id).locator('tbody tr')
const numericMoney = text => Number(text.replace(/[^\d,-]/g, '').replace(',', '.'))

async function snapshot(page, id) {
  const node = segment(page, id)
  return {
    count: Number((await node.locator('.collections-segment-total strong').innerText()).match(/\d+/)[0]),
    total: numericMoney(await node.locator('.collections-segment-total span').innerText()),
    pending: numericMoney(await node.locator('[data-status="pending"] dd strong').innerText()),
    pendingCount: Number((await node.locator('[data-status="pending"] small').innerText()).match(/\d+/)[0]),
    confirmed: numericMoney(await node.locator('[data-status="confirmed"] dd strong').innerText()),
    confirmedCount: Number((await node.locator('[data-status="confirmed"] small').innerText()).match(/\d+/)[0]),
    rows: await rows(page, id).locator('td:nth-child(2) > strong').allTextContents()
  }
}
async function assertSummary(page, id, expected, message) {
  const value = await snapshot(page, id)
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, value[key]])), expected, message)
}
async function assertRowIds(page, id, expected, message) {
  assert.deepEqual((await snapshot(page, id)).rows.map(value => value.replace('CLIENTE SINTÉTICO ', '')), expected, message)
}
async function render(page, theme, scenario = 'base') {
  const revision = await page.evaluate(([theme, scenario]) => window.renderSegmentReview(theme, scenario), [theme, scenario])
  await page.waitForFunction(value => document.querySelector('.app-shell')?.dataset.qaRevision === String(value), revision)
}
async function access(page, value) {
  await page.evaluate(value => window.setSegmentAccess(value), value)
  await page.waitForFunction(value => document.querySelector('.app-shell')?.dataset.qaAccess === value, value)
}
async function openRequest(page, request) {
  await page.evaluate(request => window.openSegmentRequest(request), request)
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), new RegExp(`CLIENTE SINTÉTICO ${request.id}`))
  return dialog
}
async function close(page) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Cerrar edición', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
}
async function geometry(page, name) {
  const value = await page.evaluate(() => ({
    viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
    segments: [...document.querySelectorAll('.collections-segment')].map(node => {
      const rect = node.getBoundingClientRect()
      return { id: node.dataset.segment, left: rect.left, right: rect.right, width: rect.width, top: rect.top, bottom: rect.bottom,
        summaryWidth: node.querySelector('.collections-segment-summary').scrollWidth,
        summaryClientWidth: node.querySelector('.collections-segment-summary').clientWidth,
        tableWidth: node.querySelector('.collections-table-wrap').scrollWidth,
        tableClientWidth: node.querySelector('.collections-table-wrap').clientWidth,
        columns: [...node.querySelectorAll('thead th')].map(cell => { const bounds = cell.getBoundingClientRect(); return { left: bounds.left, width: bounds.width } }) }
    })
  }))
  assert(value.pageWidth <= value.viewport + 1, `${name}: page has no horizontal overflow`)
  for (const node of value.segments) {
    assert(node.left >= -1 && node.right <= value.viewport + 1, `${name}: ${node.id} fits viewport`)
    assert(node.summaryWidth <= node.summaryClientWidth + 1, `${name}: ${node.id} summary does not overflow`)
    if (value.viewport <= 640) assert(node.tableWidth <= node.tableClientWidth + 1, `${name}: ${node.id} mobile rows do not scroll horizontally`)
  }
  assert(Math.abs(value.segments[0].left - value.segments[1].left) <= 1, `${name}: segment left edges align`)
  assert(Math.abs(value.segments[0].right - value.segments[1].right) <= 1, `${name}: segment right edges align`)
  assert(value.segments[0].bottom <= value.segments[1].top, `${name}: segments are separate stacked sections`)
  if (value.viewport > 850) value.segments[0].columns.forEach((column, index) => {
    const other = value.segments[1].columns[index]
    assert(Math.abs(column.left - other.left) <= 1 && Math.abs(column.width - other.width) <= 1, `${name}: column ${index + 1} aligns across both tables`)
  })
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true })
  return value
}

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  try {
    for (const width of widths) for (const theme of themes) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width <= 640, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage(), errors = [], externalRequests = []
      page.setDefaultTimeout(15000)
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install({ time: new Date('2026-10-20T23:58:00-03:00') })
      await context.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.origin !== 'https://segments-qa.test') { externalRequests.push(url.origin); return route.abort() }
        if (url.pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/qa.js') return route.fulfill({ contentType: 'text/javascript', body: js })
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: html })
        return route.fulfill({ status: 204 })
      })
      await page.goto(`https://segments-qa.test/review?theme=${theme}`)
      await page.locator('.collections-segment[data-segment="future"]').waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Actuales y anteriores', exact: true }).count(), 1)
      assert.equal(await page.getByRole('heading', { name: 'Futuras', exact: true }).count(), 1)
      assert.equal(await page.locator('.collections-filters').count(), 1, 'Both sections share one filter set')
      await assertSummary(page, 'current', { count: 2, total: 300.3, pending: 300.3, pendingCount: 2, confirmed: 0, confirmedCount: 0 }, 'Pending default: today and older are current')
      await assertSummary(page, 'future', { count: 2, total: 1001, pending: 1001, pendingCount: 2, confirmed: 0, confirmedCount: 0 }, 'Future pending includes one collection for the first active journey')
      const status = page.getByRole('combobox', { name: /^Estado del pago/ })
      const search = page.getByLabel('Buscar', { exact: true })
      const from = page.getByLabel('Servicio desde', { exact: true }), through = page.getByLabel('Servicio hasta', { exact: true })
      await status.selectOption('all')
      await assertRowIds(page, 'current', ['MATCH-old', 'current-paid', 'MATCH-today'], 'Current chronological order includes today')
      await assertRowIds(page, 'future', ['MATCH-future', 'future-paid', 'journey'], 'Prepaid stays future and cancelled owner follows its first active journey')
      await assertSummary(page, 'current', { count: 3, total: 600.6, pending: 300.3, confirmed: 300.3, confirmedCount: 1 }, 'Current all-state subtotals')
      await assertSummary(page, 'future', { count: 3, total: 1501.5, pending: 1001, confirmed: 500.5, confirmedCount: 1 }, 'Future all-state subtotals')
      assert.match(await rows(page, 'future').filter({ hasText: 'CLIENTE SINTÉTICO future-paid' }).innerText(), /Confirmado · anticipado/)
      assert.match(await rows(page, 'future').filter({ hasText: 'CLIENTE SINTÉTICO journey' }).innerText(), /25\/10\/2026/)
      const fullGeometry = await geometry(page, `all-${width}-${theme}`)

      await search.fill('MATCH')
      await assertSummary(page, 'current', { count: 2, total: 300.3 }, 'Search filters current subtotal')
      await assertSummary(page, 'future', { count: 1, total: 400.4 }, 'Search filters future subtotal')
      await search.fill('')
      await status.selectOption('confirmed')
      await assertSummary(page, 'current', { count: 1, total: 300.3, pending: 0, confirmed: 300.3 }, 'Confirmed filter applies to current')
      await assertSummary(page, 'future', { count: 1, total: 500.5, pending: 0, confirmed: 500.5 }, 'Confirmed filter preserves future prepayments')
      await status.selectOption('all')
      await from.fill('2026-10-20'); await through.fill('2026-10-22')
      await assertSummary(page, 'current', { count: 1, total: 200.2 }, 'Range filters current dates')
      await assertSummary(page, 'future', { count: 2, total: 900.9 }, 'Range uses effective date and excludes later journey')
      await search.fill('no-synthetic-match')
      for (const id of ['current', 'future']) {
        await assertSummary(page, id, { count: 0, total: 0, pending: 0, pendingCount: 0, confirmed: 0, confirmedCount: 0 }, 'Empty filters reset all amounts and quantities')
        assert.equal(await segment(page, id).locator('.empty-state').count(), 1, 'Each empty section retains its own explanation')
        assert.equal(await rows(page, id).count(), 0)
      }
      await geometry(page, `empty-${width}-${theme}`)
      await openRequest(page, { id: 'future-paid' })
      assert.equal(await search.inputValue(), '')
      assert.equal(await from.inputValue(), '')
      assert.equal(await through.inputValue(), '')
      assert.equal(await status.inputValue(), 'all')
      assert.equal(await rows(page, 'future').filter({ hasText: 'CLIENTE SINTÉTICO future-paid' }).count(), 1, 'ID request exposes the matching future row')
      await close(page)

      await access(page, 'assigned')
      await assertSummary(page, 'current', { count: 2, total: 400.4, pending: 100.1, confirmed: 300.3 }, 'Current totals respect assigned read scope')
      await assertSummary(page, 'future', { count: 1, total: 400.4, pending: 400.4, confirmed: 0 }, 'Future totals require both owner and effective-journey scope')
      assert(!/MATCH-today|future-paid|CLIENTE SINTÉTICO journey/.test(await page.locator('.collections-page').innerText()), 'Out-of-scope rows are absent')
      await access(page, 'reader')
      await openRequest(page, { id: 'future-paid' })
      await access(page, 'assigned')
      assert.equal(await page.getByRole('dialog').count(), 0, 'Scope revocation closes an already open out-of-scope future payment')
      await openRequest(page, { id: 'MATCH-future' })
      await access(page, 'noFinancial')
      assert.equal(await page.getByRole('dialog').count(), 0, 'Financial revocation closes the editor')
      assert.equal(await page.locator('.collections-segment,.collections-table').count(), 0, 'Financial revocation removes all rows and totals')
      assert(!/CLIENTE SINTÉTICO/.test(await page.locator('.collections-page').innerText()))
      await access(page, 'technical')
      assert.equal(await page.locator('.collections-segment,.collections-table').count(), 0, 'Technical-only access does not reveal collection segments')

      await render(page, theme, 'bulk')
      const current = segment(page, 'current'), future = segment(page, 'future')
      await assertSummary(page, 'current', { count: 30, total: 3435, pending: 3435, pendingCount: 30 }, 'Current subtotal covers all pages')
      await assertSummary(page, 'future', { count: 30, total: 6435, pending: 6435, pendingCount: 30 }, 'Future subtotal covers all pages')
      assert.equal(await rows(page, 'current').count(), 25)
      assert.equal(await rows(page, 'future').count(), 25)
      await current.getByRole('button', { name: 'Siguiente', exact: true }).click()
      assert.equal(await rows(page, 'current').count(), 5)
      assert.equal(await rows(page, 'future').count(), 25, 'Current page navigation leaves the future page intact')
      await future.getByRole('button', { name: 'Siguiente', exact: true }).click()
      assert.equal(await rows(page, 'future').count(), 5)
      assert.equal(await current.locator('.collections-pagination > span').innerText(), '2 de 2', 'Future navigation preserves current page 2')
      await assertSummary(page, 'current', { total: 3435 }, 'Current totals do not shrink to page 2')
      await assertSummary(page, 'future', { total: 6435 }, 'Future totals do not shrink to page 2')
      await search.fill('0')
      assert.equal(await rows(page, 'current').count(), 12)
      assert.equal(await rows(page, 'future').count(), 12)
      assert.equal(await page.locator('.collections-pagination').count(), 0, 'Common filtering updates both page counts')
      await search.fill('')
      assert.equal(await rows(page, 'current').count(), 25, 'Clearing filters resets current page')
      assert.equal(await rows(page, 'future').count(), 25, 'Clearing filters resets future page')
      await status.selectOption('all')
      await current.getByRole('button', { name: 'Siguiente', exact: true }).click()
      await openRequest(page, { id: 'future-29' })
      assert.equal(await rows(page, 'future').filter({ hasText: 'CLIENTE SINTÉTICO future-29' }).count(), 1, 'Notification opens a future record beyond the first page and exposes its row')
      assert.equal(await future.locator('.collections-pagination > span').innerText(), '2 de 2')
      assert.equal(await current.locator('.collections-pagination > span').innerText(), '2 de 2', 'ID navigation preserves the other page when common filters are unchanged')
      await close(page)
      await future.getByRole('button', { name: 'Anterior', exact: true }).click()
      assert.equal(await rows(page, 'future').count(), 25, 'Closing the modal leaves pagination operable')

      await render(page, theme)
      await status.selectOption('all')
      await page.clock.fastForward(3 * 60_000)
      await page.waitForFunction(() => document.querySelector('[data-segment="current"] .collections-segment-total strong')?.textContent.startsWith('4 '))
      await assertSummary(page, 'current', { count: 4, total: 1001, pending: 700.7, confirmed: 300.3 }, 'At Argentina midnight tomorrow becomes current automatically')
      await assertSummary(page, 'future', { count: 2, total: 1101.1, pending: 600.6, confirmed: 500.5 }, 'Rollover leaves later dates and future prepayments in future')
      assert.deepEqual(await page.evaluate(() => window.__segmentWrites), [], 'Segment browsing never sends mutations')
      assert.deepEqual(await page.evaluate(() => window.__segmentNotices), [], 'Valid navigation produces no unavailable-record warnings')
      assert.deepEqual(errors, [], 'No browser runtime errors')
      assert.deepEqual(externalRequests, [], 'No remote services or production data are accessed')
      results.push({ width, theme, passed: true, geometry: fullGeometry, checks: ['dates', 'prepaid', 'journey', 'common-filters', 'filtered-totals', 'empty', 'scope', 'pagination', 'deep-link', 'midnight'] })
      console.log(`Collection segments ${width}/${theme}: passed`)
      await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    console.log(`Collection segments: ${results.length} viewport/theme cases passed; no writes or browser errors.`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
