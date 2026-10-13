/* Real annual evolution component with synthetic data and no network access. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/annual-evolution')
fs.mkdirSync(output, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './App.jsx';
import AnnualEvolutionChart from './components/AnnualEvolutionChart.jsx';
import {visibleAnnualMonthLabels} from './annual-chart.mjs';
${cssImports}
const reference = new Date(2026, 9, 13, 12);
const series = {
  docta: [4, 9, 7, 11, 5, 12, 9, 15, 10, 16],
  nobu: [1, 3, 2, 0, 4, 2, 5, 3, 4, 6],
  residential: [8, 6, 10, 9, 13, 7, 11, 10, 15, 12],
  retirements: [0, 2, 1, 3, 2, 0, 4, 2, 3, 1]
};
const monthly = visibleAnnualMonthLabels(2026, reference).map((label,index) => ({
  label,
  value: series.docta[index] + series.nobu[index] + series.residential[index],
  locations: {docta:series.docta[index], 'nobu-town':series.nobu[index], residencial:series.residential[index]},
  retirements: series.retirements[index]
}));
const cases = {
  variable: {year:'2026', months:monthly},
  zero: {year:'2026', months:monthly.map(month => ({...month,value:0,locations:{docta:0,'nobu-town':0,residencial:0},retirements:0}))},
  single: {year:'2026', months:monthly.slice(0,1)},
  future: {year:'2027', months:visibleAnnualMonthLabels(2027,reference)},
  past: {year:'2025', months:visibleAnnualMonthLabels(2025,reference).map((label,index) => ({...monthly[index % monthly.length],label}))}
};
const host = createRoot(document.getElementById('root'));
let renderNumber = 0;
window.renderAnnualReview = (name='variable', theme='light') => {
  document.body.classList.toggle('dark',theme === 'dark');
  host.render(<div className="app-shell chart-review-shell" data-theme={theme}>
    <main className="chart-review-content"><div className="dashboard-analytics">
      <AnnualEvolutionChart key={++renderNumber} {...cases[name]}/>
      <article className="data-card zone-summary"><p className="eyebrow">DATOS DE PRUEBA</p><h2>Detalle por ubicación</h2><p>Serie mensual sintética para comprobar el gráfico.</p></article>
    </div></main>
  </div>);
};
window.renderAnnualReview();
`
const build = buildSync({
  stdin: { contents: fixture, loader: 'jsx', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css' }, logLevel: 'silent'
})
const css = build.outputFiles.find(file => file.path.endsWith('.css')).text
const js = build.outputFiles.find(file => file.path.endsWith('.js')).text
const widths = (process.env.ANNUAL_WIDTHS || '1440,768,390').split(',').map(Number)
const results = []
const errors = []
const seriesKeys = ['docta','nobu-town','residencial','retirements']
const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

async function render(page, scenario, theme) {
  await page.evaluate(({scenario,theme}) => window.renderAnnualReview(scenario,theme), {scenario,theme})
  await page.waitForFunction(expected => document.querySelector('.chart-review-shell')?.dataset.theme === expected, theme)
  await page.waitForFunction(expected => {
    const card = document.querySelector('.annual-chart')
    if (!card) return false
    const values = getComputedStyle(card).backgroundColor.match(/[\d.]+/g).map(Number).slice(0,3)
    return expected === 'light' ? Math.min(...values) > 230 : Math.max(...values) < 80
  },theme)
  await page.waitForFunction(() => {
    const plot = document.querySelector('.annual-evolution-plot')
    const svg = plot?.querySelector('svg')
    return !svg || Math.abs(Number(svg.viewBox.baseVal.width) - Math.round(plot.getBoundingClientRect().width)) <= 1
  })
}

async function checkContent(page, scenario, theme) {
  const chart = page.locator('.annual-evolution-card')
  const expectedMonths = scenario === 'future' ? [] : scenario === 'single' ? labels.slice(0,1) : scenario === 'past' ? labels : labels.slice(0,10)
  assert.deepEqual(await chart.locator('.x-tick').allTextContents(),expectedMonths,`${scenario}: only elapsed months should be visible`)
  assert.equal(await chart.locator('.chart-hit-target').count(),expectedMonths.length)
  assert.equal(await chart.locator('.annual-evolution-data tbody tr').count(),expectedMonths.length)
  assert.equal(await chart.locator('.annual-evolution-legend button').count(),4)
  assert.deepEqual(await chart.locator('.annual-evolution-legend button').evaluateAll(buttons => buttons.map(button => button.dataset.series)),seriesKeys)
  const table = await chart.locator('.annual-evolution-data').evaluate(element => {
    const style = getComputedStyle(element)
    return {position:style.position,clip:style.clip,clipPath:style.clipPath,overflow:style.overflow}
  })
  assert(table.position === 'absolute' && (table.clipPath === 'inset(50%)' || table.clip === 'rect(0px, 0px, 0px, 0px)'),`${scenario}: accessible data table must be clipped outside visible flow (${JSON.stringify(table)})`)
  if (scenario === 'future') {
    assert.equal(await chart.locator('svg').count(),0)
    assert.match(await chart.locator('.annual-evolution-empty').textContent(),/no hay meses transcurridos/)
    return
  }
  assert.equal(await chart.locator('.axis-caption').textContent(),'Cantidad')
  const ticks = (await chart.locator('.y-tick').allTextContents()).map(value => Number(value.replaceAll('.','')))
  assert.equal(ticks[0],0,'Quantity axis starts at zero')
  assert(ticks.every(Number.isInteger),'Quantity axis must use whole counts')
  assert(ticks.every((value,index) => !index || value > ticks[index-1]),'Quantity ticks must increase')
  assert(ticks.at(-1) > 0,'Quantity range must never collapse')
  if (scenario === 'zero') {
    assert.equal(await chart.locator('.series-line').count(),0)
    assert.match(await chart.locator('.annual-evolution-empty').textContent(),/Sin instalaciones ni bajas/)
    await chart.locator('.chart-hit-target').first().focus()
    assert.deepEqual(await chart.locator('.annual-evolution-tooltip b').allTextContents(),['0','0','0','0'])
    await page.keyboard.press('Escape')
    return
  }
  const lines = await chart.locator('.series-line').evaluateAll(paths => paths.map(path => ({series:path.dataset.series,stroke:getComputedStyle(path).stroke,width:Number.parseFloat(getComputedStyle(path).strokeWidth),d:path.getAttribute('d')})))
  assert.deepEqual(lines.map(line => line.series),seriesKeys)
  assert(lines.every(line => line.stroke !== 'none' && line.stroke !== 'transparent' && line.width >= 2),'All four series need a visible line stroke')
  assert.equal(new Set(lines.map(line => line.stroke)).size,4,'Every series keeps its own color')
  if (scenario === 'single') {
    assert.equal(await chart.locator('.series-point').count(),4,'Single month must display four points')
    assert.equal(await chart.locator('.series-area').count(),0,'One month cannot imply a filled interval')
    const point = await chart.locator('.series-point').first().evaluate(element => Number(element.getAttribute('cx')))
    const tick = await chart.locator('.x-tick').first().evaluate(element => Number(element.getAttribute('x')))
    assert.equal(point,tick)
  } else {
    assert(lines.every(line => line.d.includes('C')),'Multiple monthly values should form smooth curves')
    assert.equal(await chart.locator('.series-area').count(),4,'Each visible series includes its matching area')
  }
  const lineColors = Object.fromEntries(lines.map(line => [line.series,line.stroke.match(/[\d.]+/g).map(Number)]))
  assert(lineColors.docta[0] > lineColors.docta[2] && lineColors.docta[1] > lineColors.docta[2],'Docta stays yellow')
  assert(lineColors['nobu-town'][2] > lineColors['nobu-town'][0],'Nobu stays blue')
  assert(lineColors.residencial[1] > lineColors.residencial[0],'Residential stays green')
  assert(lineColors.retirements[0] > lineColors.retirements[1],'Retirements stay red')
  assert(await chart.locator('.annual-evolution-svg').getAttribute('aria-labelledby'),'Chart needs an accessible title')
}

async function checkInteractions(page, width, theme) {
  const chart = page.locator('.annual-evolution-card')
  const targets = chart.locator('.chart-hit-target')
  const tooltip = chart.locator('.annual-evolution-tooltip')
  const expectMonth = async month => {
    await tooltip.waitFor()
    assert.equal(await tooltip.locator('strong').textContent(),`${month} 2026`)
    const box = await tooltip.boundingBox()
    assert(box.x >= 0 && box.x + box.width <= width + 1,'Tooltip fits the viewport')
  }
  await targets.nth(4).hover()
  await expectMonth('May')
  assert.deepEqual(await tooltip.locator('b').allTextContents(),['5','4','13','2'],'Hover exposes exact values, not rounded curve interpolation')
  await page.mouse.move(1,1)
  assert.equal(await tooltip.count(),0,'Pointer leaving chart closes hover tooltip')
  await targets.first().focus()
  await expectMonth('Ene')
  await page.keyboard.press('ArrowRight')
  await expectMonth('Feb')
  assert.equal(await targets.nth(1).evaluate(element => document.activeElement === element),true)
  await page.keyboard.press('End')
  await expectMonth('Oct')
  await page.keyboard.press('Home')
  await expectMonth('Ene')
  await page.keyboard.press('Escape')
  assert.equal(await tooltip.count(),0)
  await page.keyboard.press('Enter')
  await expectMonth('Ene')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Space')
  await expectMonth('Ene')
  if (width === 390) {
    await targets.nth(7).tap()
    await expectMonth('Ago')
    assert.deepEqual(await tooltip.locator('b').allTextContents(),['15','3','10','2'],'Touch exposes the selected month values')
  }
  await page.screenshot({path:path.join(output,`tooltip-${theme}-${width}.png`),fullPage:true})
  const originalTicks = await chart.locator('.y-tick').allTextContents()
  for (const key of seriesKeys) {
    const legend = chart.locator(`.annual-evolution-legend button[data-series="${key}"]`)
    await legend.click()
    assert.equal(await legend.getAttribute('aria-pressed'),'false')
    assert.equal(await chart.locator(`.series-line[data-series="${key}"]`).count(),0)
    assert.equal(await chart.locator(`.series-area[data-series="${key}"]`).count(),0)
    assert.deepEqual(await chart.locator('.y-tick').allTextContents(),originalTicks,'Hiding a series should not rescale comparison values')
  }
  assert.match(await chart.locator('.annual-evolution-empty').textContent(),/Seleccioná una serie/)
  await chart.locator('.annual-evolution-legend button').first().click()
  assert.equal(await chart.locator('.series-line').count(),1)
  assert.equal(await chart.locator('.annual-evolution-empty').count(),0)
  await targets.nth(4).focus()
  assert.deepEqual(await tooltip.locator('b').allTextContents(),['5'],'Hidden series stay absent from the tooltip')
}

async function checkGeometry(page, name) {
  const geometry = await page.evaluate(() => {
    const chart = document.querySelector('.annual-chart')
    const svg = chart.querySelector('svg')
    const rect = chart.getBoundingClientRect()
    const paths = [...chart.querySelectorAll('path')].map(path => path.getAttribute('d'))
    return {
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      card: {x:rect.x,width:rect.width},
      svg: svg && {x:svg.getBoundingClientRect().x,width:svg.getBoundingClientRect().width},
      paths,
      text: chart.textContent,
      color: getComputedStyle(chart).color,
      background: getComputedStyle(chart).backgroundColor
    }
  })
  assert(geometry.scrollWidth <= geometry.viewport + 2, `${name}: horizontal viewport overflow`)
  assert(geometry.card.x >= 0 && geometry.card.x + geometry.card.width <= geometry.viewport + 1, `${name}: chart card leaves viewport`)
  if (geometry.svg) assert(geometry.svg.x >= geometry.card.x && geometry.svg.x + geometry.svg.width <= geometry.card.x + geometry.card.width + 1, `${name}: SVG leaves card`)
  assert(geometry.paths.every(value => !/NaN|Infinity|undefined/.test(value)), `${name}: invalid curve coordinates`)
  await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true})
  return geometry
}

;(async () => {
  const browser = await chromium.launch({headless:true,channel:'msedge'})
  try {
    for (const width of widths) {
      const context = await browser.newContext({viewport:{width,height:950},hasTouch:width === 390,reducedMotion:'reduce',timezoneId:'America/Argentina/Buenos_Aires'})
      const page = await context.newPage()
      page.on('pageerror',error => errors.push(error.message))
      await page.route('**/*',route => route.abort())
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
      await page.evaluate(styles => {
        const sheet = document.createElement('style')
        sheet.textContent = styles
        document.head.append(sheet)
      },css+'\n.chart-review-shell {display:block!important}.chart-review-content {max-width:1200px;margin:0 auto;padding:24px 16px}@media(max-width:640px){.chart-review-content {padding:16px 12px}}')
      await page.addScriptTag({content:js})
      await page.waitForFunction(() => typeof window.renderAnnualReview === 'function')
      for (const theme of ['light','dark']) {
        for (const scenario of ['variable','zero','single','future','past']) {
          await render(page,scenario,theme)
          const name = `${scenario}-${theme}-${width}`
          await checkContent(page,scenario,theme)
          const geometry = await checkGeometry(page,name)
          if (scenario === 'variable') await checkInteractions(page,width,theme)
          results.push({name,geometry})
        }
      }
      await context.close()
    }
    assert.deepEqual(errors,[],'Browser errors must be empty')
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2))
    console.log(`Annual evolution: ${results.length} responsive/theme/scenario checks passed; no browser errors.`)
  } finally { await browser.close() }
})().catch(error => {console.error(error);process.exitCode=1})
