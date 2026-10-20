/* Dashboard/collections integration with synthetic data and intercepted assets.
   No production session or application writes are used by this browser check. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/dashboard-collections')
fs.mkdirSync(output, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
  .map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import React, {useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './App.jsx';
import Dashboard from './features/dashboard/presentation/Dashboard.jsx';
import Collections from './components/Collections.jsx';
import {PermissionsProvider} from './presentation/contexts/permissions-context.jsx';
import policy from '../api/_lib/permission-catalog.cjs';
${cssImports}
const RealDate = Date;
window.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-10-20T15:00:00Z'])); }
  static now() { return new RealDate('2026-10-20T15:00:00Z').getTime(); }
};
const services=[{id:'alarm-installation',name:'Instalación de alarma',code:'alarm-installation'},{id:'retirement',name:'Retiro de equipo'}];
const record=(id,date,amount,extra={})=>({
  id,date,time:'08:30',status:'Completado',service:'Instalación de alarma',serviceId:'alarm-installation',
  installationZone:'residencial',client:'CLIENTE SINTÉTICO '+id,address:'Dirección de prueba',
  amount:String(amount),paymentMethod:'Transferencia',technicians:['Técnico sintético'],technicianIds:['qa-other'],
  createdBy:{id:'qa-author',name:'Autor sintético'},...extra
});
const records=[
  record('paid','2026-10-14',40000,{technicianIds:['qa-assigned'],collection:{status:'confirmed',confirmedAt:'2026-10-15T15:00:00Z',confirmedBy:{id:'qa-author',name:'Autor sintético'},events:[]}}),
  record('due','2026-10-19',70000),
  record('future','2026-10-25',110000,{status:'Pendiente'}),
  record('before-tracking','2026-09-30',900000),
  record('cancelled','2026-10-20',800000,{status:'Cancelado'}),
  record('november','2026-11-03',130000,{status:'Pendiente'})
];
const scenarios={
  current:records, past:records, future:records, empty:[],
  large:[record('large-paid','2026-10-14',999999999.99,{collection:{status:'confirmed',events:[]}}),record('large-due','2026-10-19',888888888.88),record('large-future','2026-10-25',777777777.77,{status:'Pendiente'})]
};
const permissionSet=ids=>({__catalogV2:true,...Object.fromEntries(policy.CATALOG.map(item=>[item.id,ids.includes(item.id)]))});
const readPermissions=['dashboard.view','records.read','collections.view','records.financial'];
const users={
  administrator:{id:'qa-admin',roleCode:'administrator',role:'Administrador',permissions:permissionSet([])},
  reader:{id:'qa-reader',roleCode:'qa-reader',role:'Lector',permissions:permissionSet(readPermissions)},
  summary:{id:'qa-summary',roleCode:'qa-summary',role:'Resumen',permissions:permissionSet(['dashboard.view'])},
  noFinancial:{id:'qa-no-financial',roleCode:'qa-no-financial',role:'Sin importes',permissions:permissionSet(['dashboard.view','collections.view','records.read'])},
  noCollections:{id:'qa-no-collections',roleCode:'qa-no-collections',role:'Sin cobranzas',permissions:permissionSet(['dashboard.view','history.view','records.read','records.financial'])},
  assigned:{id:'qa-assigned',roleCode:'qa-assigned',role:'Asignados',permissions:{...permissionSet(readPermissions),'scope.services.read.assigned':true}}
};
function Harness({scenario,theme,initialAccess,revision}) {
  const [access,setAccess]=useState(initialAccess),[screen,setScreen]=useState('dashboard'),[openRequest,setOpenRequest]=useState(null);
  const onHandled=useCallback(()=>setOpenRequest(null),[]);
  const notice=useCallback(message=>window.__qaNotices.push(message),[]);
  const openCollections=useCallback(request=>{window.__qaCollectionRequests.push(request);setOpenRequest(request);setScreen('collections')},[]);
  window.setDashboardCollectionsAccess=setAccess;
  window.openCollectionById=id=>{setOpenRequest({id});setScreen('collections')};
  window.showDashboardCollections=()=>setScreen('dashboard');
  return <PermissionsProvider user={users[access]}>
    <div className="app-shell" data-theme={theme} data-qa-revision={revision} data-qa-access={access}>
      <aside className="sidebar"><div className="qa-dashboard-brand">PIGNUS</div><nav>{['Resumen general','Agenda semanal','Historial','Cobranzas','Abonados y clientes','Mapa'].map((label,index)=><button key={label} className={index?'':'active'}>{label}</button>)}</nav><div className="sidebar-bottom">Datos sintéticos</div></aside>
      <main><header className="topbar"><div className="page-heading"><h1>{screen==='dashboard'?'Resumen general':'Cobranzas'}</h1><div id="module-description-slot"/></div></header>
        <section className="content">{screen==='dashboard'
          ? <Dashboard history={scenarios[scenario]} services={services} onOpenCollections={openCollections}/>
          : <Collections history={scenarios[scenario]} openRequest={openRequest} onOpenRequestHandled={onHandled} setNotice={notice} onSave={command=>{window.__qaWrites.push(command);return Promise.resolve()}} canManage={false}/>
        }</section>
      </main>
    </div>
  </PermissionsProvider>
}
let revision=0;
const host=createRoot(document.getElementById('root'));
window.renderDashboardCollections=(scenario='current',theme='light',access='administrator')=>{
  document.body.classList.toggle('dark',theme==='dark');
  window.__qaCollectionRequests=[];window.__qaWrites=[];window.__qaNotices=[];
  const next=++revision;
  host.render(<Harness key={next} revision={next} scenario={scenario} theme={theme} initialAccess={access}/>);
  return next;
};
window.renderDashboardCollections();
`
const built = buildSync({
  stdin: { contents: fixture, loader: 'jsx', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, outdir: 'out', format: 'iife',
  external: ['/logo-pignus.png', '/pignus-owl-white.svg'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' },
  loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent'
})
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const shellCSS = '.qa-dashboard-brand{font:600 26px Georgia,serif;text-align:center;padding:22px 12px;border-bottom:1px solid #ffffff14}'
const widths = (process.env.DASHBOARD_COLLECTIONS_WIDTHS || '2560,1920,1440,1024,390,320').split(',').map(Number)
const themes = (process.env.DASHBOARD_COLLECTIONS_THEMES || 'light,dark').split(',')
const results = [], errors = [], attemptedRequests = []

async function render(page, scenario, theme, access = 'administrator') {
  await page.mouse.move(1, 1)
  const revision = await page.evaluate(args => window.renderDashboardCollections(...args), [scenario, theme, access])
  await page.waitForFunction(expected => Number(document.querySelector('.app-shell')?.dataset.qaRevision) === expected, revision)
  await page.locator('.dashboard-block-grid').waitFor()
  const month = scenario === 'past' ? '2026-09' : scenario === 'future' ? '2026-11' : '2026-10'
  await page.locator('input[type="month"]').fill(month)
  await page.waitForFunction(expected => document.querySelector('input[type="month"]')?.value === expected, month)
  await page.waitForFunction(() => [...document.querySelectorAll('.annual-evolution-plot,.collections-overview-plot')].every(plot => {
    const svg = plot.querySelector('svg')
    return !svg || Math.abs(svg.viewBox.baseVal.width - Math.round(plot.getBoundingClientRect().width)) <= 1
  }))
  await page.waitForFunction(expected => {
    const color = getComputedStyle(document.querySelector('.net-projection-card')).backgroundColor.match(/[\d.]+/g).map(Number).slice(0, 3)
    return expected === 'light' ? Math.min(...color) > 230 : Math.max(...color) < 80
  }, theme)
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function measureGrid(page, name, collectionsVisible = true) {
  const geometry = await page.evaluate(() => {
    const grid = document.querySelector('.dashboard-block-grid')
    const bounds = element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    const style = getComputedStyle(grid)
    return {
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      grid: bounds(grid), columns: style.gridTemplateColumns.split(' ').length, gap: Number.parseFloat(style.rowGap),
      cards: [...grid.children].map(card => ({ tag: card.tagName, className: card.className, ...bounds(card) })),
      dataTables: [...grid.querySelectorAll('.dashboard-chart-data')].map(table => ({ className: table.className, ...bounds(table) })),
      invalidPaths: [...grid.querySelectorAll('svg path')].map(item => item.getAttribute('d')).filter(value => /NaN|Infinity|undefined/.test(value)),
      overflow: [...document.querySelectorAll('.dashboard-overview article,.dashboard-overview svg,.dashboard-overview button,.dashboard-overview input')].filter(element => {
        const box = element.getBoundingClientRect()
        return box.width && (box.left < -1 || box.right > innerWidth + 1)
      }).map(element => ({ tag: element.tagName, className: element.getAttribute('class') }))
    }
  })
  fs.writeFileSync(path.join(output, `${name}-geometry.json`), JSON.stringify(geometry, null, 2))
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true })
  const close = (actual, expected, message) => assert(Math.abs(actual - expected) <= 1.5, `${name}: ${message} (${actual} vs ${expected})`)
  assert(geometry.scrollWidth <= geometry.viewport + 1, `${name}: no page overflow`)
  assert.deepEqual(geometry.invalidPaths, [], `${name}: all chart coordinates are finite`)
  assert.deepEqual(geometry.overflow, [], `${name}: all controls and graphics fit the viewport`)
  assert.equal(geometry.cards.length, collectionsVisible ? 6 : 5, `${name}: expected direct card count`)
  assert(geometry.cards.every(card => card.tag === 'ARTICLE'), `${name}: grid contains direct article cards`)
  assert(geometry.cards.every(card => card.width > 200 && card.height > 100), `${name}: cards retain useful dimensions`)
  if (geometry.columns === 2) {
    const rowPairs = collectionsVisible ? [[0, 1], [2, 3], [4, 5]] : [[0, 1], [3, 4]]
    for (const [leftIndex, rightIndex] of rowPairs) {
      const left = geometry.cards[leftIndex], right = geometry.cards[rightIndex]
      close(left.width, right.width, 'both columns have identical width')
      close(left.left, geometry.grid.left, 'left column is aligned with the grid')
      close(right.right, geometry.grid.right, 'right column is aligned with the grid')
      close(left.top, right.top, 'cards in a row share the same top')
      close(left.bottom, right.bottom, 'cards in a row share the same bottom')
      close(right.left - left.right, geometry.gap, 'column gutter is consistent')
    }
    const rows = collectionsVisible ? [[0, 1], [2, 3], [4, 5]] : [[0, 1], [2], [3, 4]]
    for (let index = 1; index < rows.length; index++) {
      close(geometry.cards[rows[index][0]].top - geometry.cards[rows[index - 1][0]].bottom, geometry.gap, 'row gutter is consistent')
    }
    if (!collectionsVisible) {
      close(geometry.cards[2].width, geometry.grid.width, 'annual chart spans both columns without collections permission')
      close(geometry.cards[2].left, geometry.grid.left, 'expanded annual chart aligns at the left')
    }
  } else {
    assert.equal(geometry.columns, 1, `${name}: narrow layouts use one column`)
    for (let index = 0; index < geometry.cards.length; index++) {
      const card = geometry.cards[index]
      close(card.width, geometry.grid.width, 'stacked cards share the full width')
      close(card.left, geometry.grid.left, 'stacked cards share the left edge')
      if (index) close(card.top - geometry.cards[index - 1].bottom, geometry.gap, 'stacked cards retain consistent spacing')
    }
  }
  return geometry
}

async function checkCollectionsContent(page, scenario) {
  const card = page.locator('.collections-overview-card')
  assert(await card.isVisible(), 'Collections summary is a visible dashboard card')
  assert.equal(await page.getByRole('dialog').count(), 0, 'No modal is needed to inspect collections')
  if (scenario === 'current') {
    const text = await card.innerText()
    for (const [state, amount] of [['confirmed', '40.000'], ['pending', '70.000'], ['future', '110.000']]) {
      const bucket = card.locator(`.collections-overview-totals [data-state="${state}"]`)
      assert((await bucket.locator('strong').innerText()).includes(amount), `${state} has the correct amount`)
      assert.equal(await bucket.locator('small').innerText(), '1 servicio', `${state} has the correct record count`)
    }
    for (const excluded of ['800.000', '900.000', '130.000']) assert(!text.includes(excluded), `Collections summary excludes ${excluded}`)
    assert(await card.locator('.collections-overview-svg').isVisible(), 'Weekly chart is visible')
    assert.match(await card.locator('.collections-overview-coverage').innerText(), /14\/10\/2026|14.*octubre/i, 'October explains the tracking cutoff')
  }
  if (scenario === 'past') {
    assert(await card.locator('.collections-overview-empty').isVisible(), 'Pre-tracking historical month has an explicit empty state')
    assert.match(await card.innerText(), /seguimiento|registro|disponible|comenz/i, 'Historical coverage limitation is explicit')
  }
  if (scenario === 'empty') {
    assert(await card.locator('.collections-overview-empty').isVisible(), 'Empty month has an explicit state')
  }
  if (scenario === 'future') {
    assert.match(await card.innerText(), /130\.000/, 'Future month retains scheduled collections')
    assert.match(await card.innerText(), /futur|programad|próxim/i, 'Future amounts are clearly labelled')
  }
}

async function checkChartInteraction(page, width) {
  const card = page.locator('.collections-overview-card')
  const tooltip = card.locator('.collections-overview-tooltip')
  const paidWeek = card.locator('.collections-week-target[data-week="2026-10-12"]')
  await paidWeek.focus()
  assert.match(await tooltip.innerText(), /40\.000/, 'Keyboard focus exposes the confirmed week amount')
  assert.equal(await card.locator('.collections-week-target[tabindex="0"]').count(), 1, 'Weekly chart has a single keyboard entry point')
  await page.keyboard.press('ArrowRight')
  assert.match(await tooltip.innerText(), /70\.000/, 'Right arrow inspects the next week’s due amount')
  assert.match(await tooltip.innerText(), /110\.000/, 'Future amount remains separately inspectable in the same week')
  const bounds = await tooltip.boundingBox()
  assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, 'Weekly tooltip fits the viewport')
  await page.keyboard.press('Home')
  assert.equal(await card.locator('.collections-week-target[aria-pressed="true"]').getAttribute('data-week'), '2026-10-01')
  await page.keyboard.press('End')
  assert.equal(await card.locator('.collections-week-target[aria-pressed="true"]').getAttribute('data-week'), '2026-10-26')
  await page.keyboard.press('Escape')
  assert.equal(await tooltip.count(), 0, 'Escape dismisses the weekly tooltip')
  await page.keyboard.press('Enter')
  assert(await tooltip.isVisible(), 'Enter reopens the focused weekly value')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Space')
  assert(await tooltip.isVisible(), 'Space reopens the focused weekly value')
  await page.keyboard.press('Escape')
  if (width <= 640) {
    await paidWeek.tap()
    assert.match(await tooltip.innerText(), /40\.000/, 'Touch exposes the weekly confirmed total')
    await page.keyboard.press('Escape')
  }
  assert.equal(await card.locator('.collections-overview-data tbody tr').count(), 5, 'Accessible table contains each October week')
  assert.equal(await card.locator('.collections-overview-data thead th').count(), 7, 'Accessible table exposes amount and count for each state')
  const table = await card.locator('.collections-overview-data').evaluate(element => {
    const style = getComputedStyle(element)
    return { position: style.position, clipPath: style.clipPath }
  })
  assert.equal(table.position, 'absolute')
  assert.equal(table.clipPath, 'inset(50%)', 'Data table remains available without disrupting the chart layout')
}

async function checkNavigation(page, theme) {
  await render(page, 'current', theme, 'reader')
  await page.locator('.collections-overview-open').click()
  await page.locator('.collections-page').waitFor()
  assert.deepEqual(await page.evaluate(() => window.__qaCollectionRequests), [{ from: '2026-10-01', through: '2026-10-31', status: 'all' }], 'Dashboard CTA requests the selected whole month')
  assert.equal(await page.getByLabel('Servicio desde', { exact: true }).inputValue(), '2026-10-01')
  assert.equal(await page.getByLabel('Servicio hasta', { exact: true }).inputValue(), '2026-10-31')
  assert.equal(await page.getByRole('combobox', { name: /^Estado del pago/ }).inputValue(), 'all')
  assert.equal(await page.locator('.collections-table tbody tr').count(), 3, 'Month listing contains confirmed, due and future entries')
  assert.equal(await page.getByRole('dialog').count(), 0, 'Month navigation opens the listing without selecting a payment')
  await page.getByLabel('Buscar', { exact: true }).fill('does-not-match')
  await page.evaluate(() => window.openCollectionById('paid'))
  const dialog = page.getByRole('dialog', { name: 'Detalle de cobranza', exact: true })
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /CLIENTE SINTÉTICO paid/, 'Existing notification navigation still opens a specific payment by id')
  assert.equal(await page.getByLabel('Buscar', { exact: true }).inputValue(), '', 'Opening by id clears a stale search')
  assert.equal(await page.getByLabel('Servicio desde', { exact: true }).inputValue(), '', 'Opening by id clears a stale date range')
  assert.equal(await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).count(), 0, 'Reader does not gain mutation actions through dashboard navigation')
  await dialog.getByRole('button', { name: 'Cerrar edición', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.__qaNotices), [], 'Valid range and id navigation do not trigger unavailable-payment warnings')
  assert.deepEqual(await page.evaluate(() => window.__qaWrites), [], 'Review and navigation never mutate payments')
  await render(page, 'future', theme, 'reader')
  await page.locator('.collections-overview-open').click()
  await page.locator('.collections-page').waitFor()
  assert.deepEqual(await page.evaluate(() => window.__qaCollectionRequests), [{ from: '2026-11-01', through: '2026-11-30', status: 'all' }], 'CTA uses the selected month rather than the current month')
  assert.equal(await page.locator('.collections-table tbody tr').count(), 1)
}

async function checkPermissions(page, theme, width) {
  for (const access of ['summary', 'noFinancial', 'noCollections']) {
    await render(page, 'current', theme, access)
    assert.equal(await page.locator('.collections-overview-card').count(), 0, `${access}: financial card is absent`)
    assert(!/40\.000|70\.000|110\.000/.test(await page.locator('.dashboard-overview').innerText()), `${access}: hidden financial totals are not rendered`)
    if (access === 'summary') results.push({ name: `denied-${theme}-${width}`, geometry: await measureGrid(page, `denied-${theme}-${width}`, false) })
  }
  await render(page, 'current', theme, 'assigned')
  const scoped = await page.locator('.collections-overview-card').innerText()
  assert(scoped.includes('40.000'), 'Assigned scope includes its own collection')
  assert(!/70\.000|110\.000/.test(scoped), 'Assigned scope excludes another technician’s collections')
  await page.locator('.collections-overview-open').click()
  await page.locator('.collections-page').waitFor()
  assert.equal(await page.locator('.collections-table tbody tr').count(), 1, 'Collection list uses the same assignment scope as the dashboard')
  await render(page, 'current', theme, 'reader')
  await page.evaluate(() => window.openCollectionById('due'))
  await page.getByRole('dialog', { name: 'Detalle de cobranza', exact: true }).waitFor()
  await page.evaluate(() => window.setDashboardCollectionsAccess('assigned'))
  await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.qaAccess === 'assigned')
  assert.equal(await page.getByRole('dialog').count(), 0, 'Narrowing scope closes a payment editor whose record is no longer visible')
  assert(!/70\.000|110\.000/.test(await page.locator('.collections-page').innerText()), 'Scope revocation removes stale financial data from the editor and listing')
  await page.evaluate(() => window.setDashboardCollectionsAccess('noFinancial'))
  await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.qaAccess === 'noFinancial')
  assert.equal(await page.locator('.collections-summary,.collections-table').count(), 0, 'Revoking financial access removes the mounted collection amounts and records')
  await render(page, 'current', theme, 'reader')
  await page.evaluate(() => window.setDashboardCollectionsAccess('noFinancial'))
  await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.qaAccess === 'noFinancial')
  assert.equal(await page.locator('.collections-overview-card').count(), 0, 'Revoking financial permission removes the mounted card immediately')
  assert(!/40\.000|70\.000|110\.000/.test(await page.locator('.dashboard-overview').innerText()), 'Revocation does not retain stale financial totals')
}

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width <= 640, reducedMotion: 'reduce', timezoneId: 'America/Argentina/Buenos_Aires' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      page.on('pageerror', error => errors.push({ width, message: error.message }))
      await page.route('**/*', route => { attemptedRequests.push(route.request().url()); return route.abort() })
      await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
      await page.evaluate(styles => { const sheet = document.createElement('style'); sheet.textContent = styles; document.head.append(sheet) }, css + shellCSS)
      await page.addScriptTag({ content: js })
      await page.waitForFunction(() => typeof window.renderDashboardCollections === 'function')
      for (const theme of themes) {
        const scenarios = [1440, 390, 320].includes(width) ? ['current', 'past', 'future', 'empty', 'large'] : ['current']
        for (const scenario of scenarios) {
          await render(page, scenario, theme)
          await checkCollectionsContent(page, scenario)
          const name = `${scenario}-${theme}-${width}`
          results.push({ name, geometry: await measureGrid(page, name) })
          if (scenario === 'current') await checkChartInteraction(page, width)
        }
        await checkPermissions(page, theme, width)
        if ([1440, 390, 320].includes(width)) await checkNavigation(page, theme)
        assert.deepEqual(await page.evaluate(() => window.__qaWrites), [], 'No application writes')
      }
      await context.close()
    }
    assert.deepEqual(errors, [], 'No browser runtime errors')
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors, attemptedRequests }, null, 2))
    console.log(`Dashboard collections: ${results.length} layout/theme/scenario checks passed; month navigation, permission revocation and assignment scope preserved; no browser errors or writes.`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
