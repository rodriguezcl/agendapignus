/* Dashboard integration with synthetic records, a fixed local date and no server.
   Run with Playwright available on NODE_PATH, as with the other visual QA scripts. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/dashboard-overview')
fs.mkdirSync(output, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
  .map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './App.jsx';
import Dashboard from './features/dashboard/presentation/Dashboard.jsx';
import {PermissionsProvider} from './presentation/contexts/permissions-context.jsx';
import policy from '../api/_lib/permission-catalog.cjs';
${cssImports}
const RealDate = Date;
window.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-10-20T15:00:00Z'])); }
  static now() { return new RealDate('2026-10-20T15:00:00Z').getTime(); }
};
const services = [
  {id:'alarm-installation',name:'Instalación de alarma',code:'alarm-installation',category:'installation'},
  {id:'renamed-alarm',name:'Alta de monitoreo',code:'alarm-installation'},
  {id:'camera-installation',name:'Instalación de cámaras',category:'installation'},
  {id:'alarm-service',name:'Servicio de alarma'},
  {id:'camera-service',name:'Servicio de cámaras'},
  {id:'retirement',name:'Retiro de equipo'}
];
const record = (id,date,service='Instalación de alarma',extra={}) => ({
  id,date,time:'08:30',status:'Completado',service,installationZone:'residencial',
  client:'CLIENTE DE PRUEBA '+id,address:'Dirección sintética',phone:'000000000',
  technicians:['Técnico de prueba'],...extra
});
const current = [
  record('a1','2026-10-01','Instalación de alarma',{installationZone:'docta'}),
  record('a2','2026-10-02','Instalación de alarma',{installationZone:'nobu-town'}),
  record('a3','2026-10-05'),
  record('a4','2026-10-06','Instalación de alarma',{installationZone:'docta'}),
  record('a5','2026-10-09'),
  record('a6','2026-10-20','Instalación de alarma',{installationZone:'nobu-town'}),
  record('r1','2026-10-08','Retiro de equipo'),
  record('s1','2026-10-02','Servicio de alarma'),
  record('s2','2026-10-09','Servicio de alarma'),
  record('s3','2026-10-14','Servicio de alarma'),
  record('c1','2026-10-12','Servicio de cámaras'),
  record('c2','2026-10-16','Servicio de cámaras'),
  record('v1','2026-10-19','Control semanal de vehículo'),
  record('m1','2026-10-19','Instalación de alarma',{serviceTypes:[{id:'alarm-installation',name:'Instalación de alarma'},{id:'camera-installation',name:'Instalación de cámaras'}]}),
  record('unmonitored','2026-10-13','Instalación de alarma',{installationZone:'no-monitoreada'}),
  record('pending','2026-10-20','Instalación de alarma',{status:'Pendiente'})
];
const past = [
  record('sep1','2026-09-01'),record('sep2','2026-09-07'),
  record('sep3','2026-09-21'),record('sep4','2026-09-23','Retiro de equipo')
];
const scenarios = {
  current: [...past,...current],
  empty: [],
  negative: [record('loss1','2026-10-02','Retiro de equipo'),record('loss2','2026-10-15','Retiro de equipo')],
  multi: [record('multi','2026-10-19','Instalación de alarma',{serviceTypes:[{id:'alarm-installation',name:'Instalación de alarma'},{id:'camera-installation',name:'Instalación de cámaras'}]})],
  renamed: [record('renamed','2026-10-19','Alta de monitoreo',{serviceId:'renamed-alarm'})],
  past: [...past,...current],
  future: [...past,...current]
};
const permissionSet = ids => ({__catalogV2:true,...Object.fromEntries(policy.CATALOG.map(item => [item.id,ids.includes(item.id)]))});
const users = {
  administrator:{id:'qa-admin',roleCode:'administrator',role:'Administrador',permissions:permissionSet([])},
  summary:{id:'qa-summary',roleCode:'qa-summary',role:'Resumen',permissions:permissionSet(['dashboard.view'])},
  detail:{id:'qa-detail',roleCode:'qa-detail',role:'Detalle',permissions:permissionSet(['dashboard.view','dashboard.detail','records.read'])}
};
const host = createRoot(document.getElementById('root'));
let revision = 0;
window.renderDashboardReview = (scenario='current',theme='light',access='administrator') => {
  document.body.classList.toggle('dark',theme === 'dark');
  const renderKey = ++revision;
  host.render(<PermissionsProvider user={users[access]}>
    <div className="app-shell" data-theme={theme} data-qa-scenario={scenario} data-qa-revision={renderKey}>
      <aside className="sidebar"><div className="qa-dashboard-brand">PIGNUS</div><p className="nav-label">MÓDULOS</p><nav>{['Menú principal','Agenda semanal','Historial','Cobranzas','Abonados y clientes','Mapa','Configuración'].map((label,index) => <button key={label} className={index ? '' : 'active'}>{label}</button>)}</nav><div className="sidebar-bottom">Vista de prueba · Datos sintéticos</div></aside>
      <main><header className="topbar"><div className="page-heading"><h1>Menú principal</h1><div id="module-description-slot"/></div><span className="qa-dashboard-label">Vista de prueba</span></header>
        <section className="content"><Dashboard key={renderKey} history={scenarios[scenario]} services={services}/></section>
      </main>
    </div>
  </PermissionsProvider>);
  return renderKey;
};
window.renderDashboardReview();
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
const shellCSS = `
  .qa-dashboard-brand {font:600 26px Georgia,serif;text-align:center;padding:22px 12px;border-bottom:1px solid #ffffff14}
  .qa-dashboard-label {font-size:12px;color:var(--ap-text-muted);margin-left:auto;white-space:nowrap}
  @media(max-width:640px){.qa-dashboard-label{display:none}}
`
const widths = (process.env.DASHBOARD_WIDTHS || '1440,1280,1024,768,390').split(',').map(Number)
const themes = (process.env.DASHBOARD_THEMES || 'light,dark').split(',')
const captureOnly = process.env.DASHBOARD_CAPTURE_ONLY === '1'
const results = []
const errors = []
const attemptedRequests = []

async function render(page, scenario, theme, access = 'administrator') {
  await page.mouse.move(1, 1)
  const revision = await page.evaluate(({ scenario, theme, access }) => window.renderDashboardReview(scenario, theme, access), { scenario, theme, access })
  await page.waitForFunction(expected => Number(document.querySelector('.app-shell')?.dataset.qaRevision) === expected, revision)
  await page.locator('.dashboard-overview').waitFor()
  const selectedMonth = scenario === 'past' ? '2026-09' : scenario === 'future' ? '2027-01' : '2026-10'
  const month = page.locator('input[type="month"]')
  if (await month.inputValue() !== selectedMonth) await month.fill(selectedMonth)
  await page.waitForFunction(expected => document.querySelector('input[type="month"]')?.value === expected, selectedMonth)
  await page.waitForFunction(() => {
    const plots = [...document.querySelectorAll('.annual-evolution-plot')]
    return plots.every(plot => {
      const svg = plot.querySelector('svg')
      return !svg || Math.abs(svg.viewBox.baseVal.width - Math.round(plot.getBoundingClientRect().width)) <= 1
    })
  })
  await page.waitForFunction(expected => {
    const card = document.querySelector('.net-projection-card')
    const values = card && getComputedStyle(card).backgroundColor.match(/[\d.]+/g).map(Number).slice(0, 3)
    return values && (expected === 'light' ? Math.min(...values) > 230 : Math.max(...values) < 80)
  }, theme)
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function geometry(page, name) {
  const measurements = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.net-projection-card,.work-composition-card,.annual-evolution-card')]
    return {
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cards: cards.map(card => {
        const rect = card.getBoundingClientRect()
        const style = getComputedStyle(card)
        return { className: card.className, x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: style.color, background: style.backgroundColor }
      }),
      invalidPaths: [...document.querySelectorAll('.dashboard-overview svg path')].map(path => path.getAttribute('d')).filter(value => /NaN|Infinity|undefined/.test(value)),
      overflow: [...document.querySelectorAll('.dashboard-overview article, .dashboard-overview svg, .dashboard-overview button, .dashboard-overview input')].filter(element => {
        const rect = element.getBoundingClientRect()
        return rect.width && (rect.left < -1 || rect.right > innerWidth + 1)
      }).map(element => ({ tag: element.tagName, className: element.getAttribute('class') }))
    }
  })
  assert(measurements.scrollWidth <= measurements.viewport + 1, `${name}: page has horizontal overflow`)
  assert.equal(measurements.cards.length, 3, `${name}: exactly three chart cards`)
  assert.deepEqual(measurements.invalidPaths, [], `${name}: finite SVG paths`)
  assert.deepEqual(measurements.overflow, [], `${name}: cards, charts and controls stay inside viewport`)
  for (const card of measurements.cards) {
    assert(card.width > 200 && card.height > 150, `${name}: chart has a useful visible size`)
  }
  const [projection, composition, annual] = measurements.cards
  if (measurements.viewport >= 1200) {
    assert(Math.abs(projection.y - composition.y) <= 2, `${name}: both monthly charts share one row on desktop`)
    assert(annual.y >= projection.y + projection.height - 1, `${name}: annual evolution follows monthly insights`)
  } else {
    assert(composition.y >= projection.y + projection.height - 1, `${name}: monthly charts stack on mobile`)
    assert(annual.y >= composition.y + composition.height - 1, `${name}: annual evolution follows composition on mobile`)
  }
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true })
  return measurements
}

async function checkStructure(page, scenario) {
  const overview = page.locator('.dashboard-overview')
  assert.equal(await overview.locator('.stats-grid,.annual-kpi-section,.annual-stats-grid').count(), 0, 'Redundant KPI cards and annual accumulated section are removed')
  assert.equal(await page.locator('.dashboard-insight-modal,[role="dialog"]').count(), 0, 'Insight charts are visible without a dialog')
  for (const selector of ['.net-projection-card', '.work-composition-card', '.annual-evolution-card']) {
    assert(await overview.locator(selector).isVisible(), `${selector} is directly visible`)
    assert(await overview.locator(selector).getByRole('heading').count() > 0, `${selector} has a meaningful heading`)
  }
  assert.equal(await overview.locator('.dashboard-detail-grid > .zone-summary').count(), 2, 'Installation and retirement details remain together below charts')
  if (scenario === 'current' || scenario === 'multi' || scenario === 'negative' || scenario === 'past') {
    assert(await overview.locator('.net-projection-card svg').count() > 0, 'Net development has a chart')
    assert(await overview.locator('.work-composition-card svg').count() > 0, 'Period composition has a chart')
  }
  if (scenario === 'current') {
    assert.equal(await overview.locator('.zone-summary:not(.retirement-summary) > div > b').first().textContent(), '7', 'One multi-service job counts as one alarm installation; unmonitored installation excluded')
    assert.equal(await overview.locator('.retirement-summary > div > b').first().textContent(), '1')
    assert.equal(await overview.locator('.net-projection-headline strong').textContent(), '+9', 'Net projection uses seven monitored additions, one retirement and 14 of 22 weekdays')
    assert.equal(await overview.locator('.work-donut-total').textContent(), '16', 'Donut counts prestations when one job includes two services')
    assert.match(await overview.locator('.work-composition-card .dashboard-chart-period').textContent(), /15 trabajos/, 'Completed job count remains distinct from service count')
  }
  if (scenario === 'multi') {
    assert.deepEqual(await overview.locator('.work-composition-legend small').allTextContents(), ['50%', '50%'], 'Two services in one job produce two 50% shares')
    assert.equal(await overview.locator('.work-donut-total').textContent(), '2')
    assert.match(await overview.locator('.work-composition-card .dashboard-chart-footer').textContent(), /2 prestaciones en 1 trabajo\b/, 'Composition explains the denominator used for multiple services')
  }
  if (scenario === 'renamed') {
    assert.equal(await overview.locator('.zone-summary:not(.retirement-summary) > div > b').first().textContent(), '1', 'Renamed service with alarm-installation code remains in installation details')
    assert.equal(await overview.locator('.net-projection-headline strong').textContent(), '+2', 'Projection uses the same configured alarm classification as detail')
  }
  if (scenario === 'past') assert.match(await overview.locator('.net-projection-card').textContent(), /final|cerrad/i, 'Historical months show a closed result')
  if (scenario === 'future') assert.match(await overview.locator('.net-projection-card').textContent(), /futur|no comenz|todavía|sin proyecci/i, 'Future months do not imply a calculated projection')
  if (scenario === 'empty') assert.match(await overview.locator('.work-composition-card').textContent(), /sin trabajos|sin servicios|no hay/i, 'No-work months show an explicit empty state')
  if (scenario === 'negative') assert.match(await overview.locator('.net-projection-card').textContent(), /[−-][23]/, 'Negative growth remains negative in visible summary')
}

async function checkInteractions(page, width) {
  await page.mouse.move(1, 1)
  const projection = page.locator('.net-projection-card')
  const tooltip = projection.locator('.net-projection-tooltip')
  await projection.locator('[data-day="20"]').focus()
  assert.match(await tooltip.textContent(), /Confirmado.*\+6/s, 'Keyboard focus exposes the exact confirmed total')
  await page.keyboard.press('End')
  assert.match(await tooltip.textContent(), /Estimado.*\+9/s, 'End reaches the projected closing value')
  const tooltipBounds = await tooltip.boundingBox()
  assert(tooltipBounds.x >= 0 && tooltipBounds.x + tooltipBounds.width <= width + 1, 'Projection tooltip stays within viewport')
  await page.keyboard.press('Home')
  assert.match(await tooltip.textContent(), /Confirmado.*\+1/s)
  await page.keyboard.press('ArrowRight')
  assert.match(await tooltip.textContent(), /Confirmado.*\+2/s)
  await page.keyboard.press('Escape')
  assert.equal(await tooltip.count(), 0, 'Escape dismisses projection tooltip')
  await page.keyboard.press('Enter')
  assert.match(await tooltip.textContent(), /Confirmado.*\+2/s, 'Enter restores the focused daily value')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Space')
  assert.match(await tooltip.textContent(), /Confirmado.*\+2/s, 'Space activates the focused daily value')
  await page.keyboard.press('Escape')
  const composition = page.locator('.work-composition-card')
  const firstType = composition.locator('.work-composition-legend button').first()
  await firstType.focus()
  await page.keyboard.press('Enter')
  assert.equal(await firstType.getAttribute('aria-pressed'), 'true', 'Composition legend can select a category with keyboard')
  assert.equal(await composition.locator('.work-donut-total').textContent(), '8', 'Selected category exposes its exact count')
  assert.equal(await composition.locator('.work-donut-segment.is-muted').count(), 5, 'Other categories dim without changing the distribution')
  await page.keyboard.press('Enter')
  await page.mouse.move(1, 1)
  assert.equal(await firstType.getAttribute('aria-pressed'), 'false')
  assert.equal(await composition.locator('.work-donut-total').textContent(), '16', 'Unselecting restores the total')
  if (width <= 640) {
    await projection.locator('[data-day="20"]').tap()
    assert.match(await tooltip.textContent(), /Confirmado.*\+6/s, 'Touch can inspect a confirmed daily value')
    await page.keyboard.press('Escape')
  }
  const table = await projection.locator('.dashboard-chart-data').evaluate(element => {
    const style = getComputedStyle(element)
    return { position: style.position, clip: style.clip, clipPath: style.clipPath }
  })
  assert(table.position === 'absolute' && (table.clipPath === 'inset(50%)' || table.clip === 'rect(0px, 0px, 0px, 0px)'), 'Projection data table stays available to assistive technology without adding visual clutter')
}

async function checkPermissions(page, theme) {
  await render(page, 'current', theme, 'summary')
  const details = page.locator('.dashboard-detail-grid')
  assert.equal(await details.locator('button').count(), 0, 'Summary-only role cannot open detail or export records')
  assert.equal(await page.locator('.net-projection-card,.work-composition-card,.annual-evolution-card').count(), 3, 'Aggregate charts remain available to dashboard viewers')
  await render(page, 'current', theme, 'detail')
  assert.equal(await details.getByRole('button', { name: /Excel|PDF/ }).count(), 0, 'Record detail permission does not grant export')
  const firstDetail = details.getByRole('button', { name: 'Ver todas las instalaciones', exact: true })
  await firstDetail.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.match(await dialog.textContent(), /CLIENTE DE PRUEBA/, 'Authorized role can inspect synthetic installation records')
  assert.equal(await dialog.getByRole('columnheader', { name: 'Contacto', exact: true }).count(), 0, 'Detail permission does not expose restricted contact data')
  assert.equal(await dialog.getByRole('columnheader', { name: 'Abono mensual', exact: true }).count(), 0, 'Detail permission does not expose restricted financial data')
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 0, 'Detail closes with Escape')
  await render(page, 'current', theme, 'administrator')
  assert.equal(await details.getByRole('button', { name: 'Excel', exact: true }).count(), 5, 'All existing Excel report actions remain')
  assert.equal(await details.getByRole('button', { name: 'PDF', exact: true }).count(), 5, 'All existing PDF report actions remain')
  await page.evaluate(() => {
    window.__qaDownloads = []
    window.__qaOriginalAnchorClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      window.__qaDownloads.push({ href: this.getAttribute('href'), fileName: this.download })
    }
  })
  try {
    await details.getByRole('button', { name: 'Excel', exact: true }).first().click()
    await details.locator('.retirement-summary').getByRole('button', { name: 'PDF', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.__qaDownloads), [
      { href: '/api/history/export?month=2026-10&category=all&format=excel', fileName: 'instalaciones-alarma-all-2026-10.xls' },
      { href: '/api/history/export?month=2026-10&category=retirements&format=pdf', fileName: 'bajas-servicio-2026-10.pdf' }
    ], 'Export actions preserve the selected period, report category and file format')
  } finally {
    await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.__qaOriginalAnchorClick; delete window.__qaOriginalAnchorClick })
  }
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
      await page.evaluate(styles => {
        const sheet = document.createElement('style')
        sheet.textContent = styles
        document.head.append(sheet)
      }, css + shellCSS)
      await page.addScriptTag({ content: js })
      await page.waitForFunction(() => typeof window.renderDashboardReview === 'function')
      for (const theme of themes) {
        const scenarios = !captureOnly && [1440, 390].includes(width) ? ['current', 'past', 'future', 'empty', 'negative', 'multi', 'renamed'] : ['current']
        for (const scenario of scenarios) {
          await render(page, scenario, theme)
          const name = `${scenario}-${theme}-${width}`
          await checkStructure(page, scenario)
          const dimensions = await geometry(page, name)
          if (!captureOnly && scenario === 'current') await checkInteractions(page, width)
          results.push({ name, geometry: dimensions })
        }
        if (!captureOnly) await checkPermissions(page, theme)
      }
      await context.close()
    }
    assert.deepEqual(errors, [], 'No browser runtime errors')
    fs.writeFileSync(path.join(output, captureOnly ? 'capture-results.json' : 'results.json'), JSON.stringify({ results, errors, attemptedRequests }, null, 2))
    console.log(captureOnly
      ? `Dashboard overview: ${results.length} final screenshots refreshed; geometry and content checks passed.`
      : `Dashboard overview: ${results.length} responsive/theme/scenario checks passed, detail/export permissions preserved; no browser errors.`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
