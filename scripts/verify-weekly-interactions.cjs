/* Real weekly components, synthetic data and a delayed in-memory persistence
   boundary. Every network request is intercepted; no external data is read or
   written. Verifies feedback, rollback and out-of-order acknowledgements. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/weekly-interactions')
fs.mkdirSync(output, { recursive: true })
const themeFixture = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const data = themeFixture.slice(themeFixture.indexOf('const themeReviewUser ='), themeFixture.indexOf('const themeReviewNavigation ='))
assert(data.includes('const themeReviewWeekly ='), 'Synthetic weekly fixture must be available')
const cssFor = file => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const source = `
import './style.css';
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WeeklyPlanner } from './features/agenda/presentation/WeeklyPlanner.jsx';
${cssFor('src/App.jsx')}
${cssFor('src/main.jsx')}
${data}
window.__commands = []; window.__delays = []; window.__failures = [];
function Fixture() {
  const initial = { revision:1, weekly:themeReviewWeekly, history:themeReviewHistory };
  const [confirmed,setConfirmed] = useState(initial);
  const [notice,setNotice] = useState('');
  const server = useRef(initial), inFlight = useRef(0);
  const navigationGuard = useRef(null);
  window.__tryLeave = () => navigationGuard.current(() => { window.__left = true; });
  window.__confirmed = confirmed;
  const persist = command => {
    const number = window.__commands.length;
    const entry = {number,operation:command.operation,teamId:command.teamId,id:command.base?.id,started:performance.now(),finished:null};
    window.__commands.push(entry); inFlight.current++;
    return new Promise((resolve,reject) => setTimeout(() => {
      if (window.__failures[number]) {
        entry.failed = true; entry.finished = performance.now();
        reject(new Error('Fallo de conexión simulado'));
      } else {
        const next = structuredClone(server.current);
        next.revision++;
        if (command.operation === 'service-preparation') {
          const record = next.history.find(item => item.id === command.base.id);
          record.servicePreparation = {ready:command.ready,byName:'Revisión sintética'};
        } else if (command.operation === 'team-members') {
          const team = next.weekly[command.day].teams.find(item => item.teamId === command.teamId);
          team.memberIds = command.memberIds; team.members = command.members;
        } else throw new Error('Unexpected command: '+command.operation);
        server.current = next; entry.finished = performance.now();
        resolve({state:{revision:next.revision},revision:next.revision});
      }
      inFlight.current--;
      // Match App's batch boundary: an early ACK is not yet a displayed record.
      if (!inFlight.current) setConfirmed(server.current);
    }, window.__delays[number] || 1200));
  };
  const rejectGlobalDraft = () => { throw new Error('Quick interaction leaked into global draft'); };
  return <div className="app-shell" data-theme="light"><main><section className="content">
    <output data-notice>{notice}</output>
    <WeeklyPlanner weekly={confirmed.weekly} history={confirmed.history} confirmedRevision={confirmed.revision} navigationGuardRef={navigationGuard}
      setWeekly={rejectGlobalDraft} setHistory={rejectGlobalDraft} setCustomers={rejectGlobalDraft}
      customers={themeReviewCustomers} services={themeReviewServices} activeTechs={themeReviewEmployees}
      vehicles={themeReviewVehicles} authUser={themeReviewUser} setNotice={setNotice}
      persistWeeklyService={persist} persistWeeklyConfiguration={rejectGlobalDraft} />
  </section></main></div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`
const built = buildSync({ stdin: { contents: source, loader: 'jsx', resolveDir: path.join(root, 'src') }, jsx: 'automatic', bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const timings = []

async function measureFeedback(locator, label, kind, expected) {
  const result = await locator.evaluate((element, options) => new Promise((resolve, reject) => {
    if (element.disabled) return reject(new Error('Target is unexpectedly disabled: ' + options.label))
    const start = performance.now()
    const matches = () => options.kind === 'checked' ? element.checked === options.expected : element.getAttribute('aria-pressed') === String(options.expected)
    element.click()
    const inspect = () => {
      if (matches()) return requestAnimationFrame(() => resolve({ label:options.label, feedbackMs:performance.now()-start }))
      if (performance.now()-start > 500) return reject(new Error('Local response exceeded 500 ms: ' + options.label))
      requestAnimationFrame(inspect)
    }
    requestAnimationFrame(inspect)
  }), { label, kind, expected })
  timings.push(result)
  assert(result.feedbackMs < 250, `${label}: local feedback took ${result.feedbackMs.toFixed(1)} ms`)
}

async function settle(page, revision) {
  await page.waitForFunction(value => window.__confirmed.revision >= value, revision)
  await page.waitForFunction(() => !document.querySelector('.service-preparation-button[aria-busy="true"], .weekly-tech-popover[aria-busy="true"]'))
}

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const width of (process.env.INTERACTION_WIDTHS || '1440,390').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      const errors = [], unexpectedWrites = []
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00-03:00'))
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== 'weekly-interactions.test') return route.abort()
        if (request.method() !== 'GET') { unexpectedWrites.push(request.url()); return route.abort() }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { holidays: [], days: [], attachments: [] } })
        return route.abort()
      })
      const ready = async () => {
        await page.goto('http://weekly-interactions.test/')
        await page.locator('[data-day="2026-10-14"] .week-team').first().waitFor()
      }
      await ready()
      const preparation = page.locator('[data-day="2026-10-14"] .service-preparation-button')
      await page.evaluate(() => { window.__delays = [1000, 1500] })
      await measureFeedback(preparation.nth(0), `ready-${width}`, 'pressed', true)
      assert.equal(await preparation.nth(0).getAttribute('aria-busy'), 'true')
      assert.equal(await page.evaluate(() => window.__confirmed.history.find(item => item.id === 'h-pending').servicePreparation?.ready === true), false)
      // Programmatic duplicate clicks also exercise the synchronous per-record guard.
      await preparation.nth(0).evaluate(element => { element.click(); element.click() })
      await measureFeedback(preparation.nth(1), `independent-ready-${width}`, 'pressed', true)
      await page.waitForFunction(() => window.__commands[0]?.finished)
      assert.equal(await page.evaluate(() => window.__commands.length), 2)
      assert.equal(await page.evaluate(() => window.__confirmed.revision), 1)
      assert.equal(await preparation.nth(0).getAttribute('aria-pressed'), 'true', 'Early ACK must retain readiness until batch publication')
      assert.equal(await preparation.nth(0).getAttribute('aria-busy'), 'true')
      await settle(page, 3)
      await page.evaluate(() => { window.__failures[2] = true; window.__delays[2] = 1000 })
      await measureFeedback(preparation.nth(0), `unready-failure-${width}`, 'pressed', false)
      await page.waitForFunction(() => window.__commands[2]?.failed)
      await page.waitForFunction(() => document.querySelector('[data-day="2026-10-14"] .service-preparation-button')?.getAttribute('aria-busy') === 'false')
      assert.equal(await preparation.nth(0).getAttribute('aria-pressed'), 'true', 'Rejected uncheck must restore the confirmed ready flag')
      assert.match(await page.locator('[data-notice]').textContent(), /No se cambió.*Fallo de conexión simulado/)

      await ready()
      const teams = page.locator('[data-day="2026-10-14"] .week-team')
      const checkbox = (index, name) => teams.nth(index).locator(`.tech-list label[title="${name}"] input`)
      await page.evaluate(() => { window.__delays = [1500, 1000] })
      await teams.nth(0).locator('.weekly-add-tech-button').click()
      await measureFeedback(checkbox(0, 'Mariano Ejemplo'), `unassign-${width}`, 'checked', false)
      assert.equal(await checkbox(0, 'Mariano Ejemplo').isDisabled(), false)
      await measureFeedback(checkbox(0, 'Pascual Ejemplo'), `queued-assign-${width}`, 'checked', true)
      await measureFeedback(checkbox(0, 'Rodrigo Ejemplo'), `queued-unassign-${width}`, 'checked', false)
      assert.deepEqual(await page.evaluate(() => window.__confirmed.weekly['2026-10-14'].teams[0].memberIds), ['tech-1', 'tech-2'])
      await page.evaluate(() => window.__tryLeave())
      assert.equal(await page.evaluate(() => Boolean(window.__left)), false, 'Queued selection must guard navigation')
      assert.equal(await page.evaluate(() => window.__commands.length), 1, 'Rapid clicks on one team must coalesce')
      await page.locator('.picker-backdrop').click({ position: { x: 5, y: 5 } })
      await teams.nth(1).locator('.weekly-add-tech-button').click()
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isDisabled(), false, 'Another team must remain editable')
      await measureFeedback(checkbox(1, 'Mariano Ejemplo'), `independent-assign-${width}`, 'checked', true)
      await page.waitForFunction(() => window.__commands[1]?.finished)
      assert.equal(await page.evaluate(() => window.__commands[0].finished), null, 'The second response must arrive first')
      assert.equal(await page.evaluate(() => window.__confirmed.revision), 1)
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isChecked(), true, 'Early team ACK must retain its selection')
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isDisabled(), false)
      await settle(page, 4)
      assert.equal(await page.evaluate(() => window.__commands.length), 3, 'The final queued intention should use one follow-up command')
      assert.match(await teams.nth(0).locator('.week-team-identity').textContent(), /Pascual/)
      assert.doesNotMatch(await teams.nth(0).locator('.week-team-identity').textContent(), /Rodrigo/)
      assert.doesNotMatch(await teams.nth(0).locator('.week-team-identity').textContent(), /Mariano/)
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isChecked(), true)
      await page.evaluate(() => window.__tryLeave())
      assert.equal(await page.evaluate(() => Boolean(window.__left)), true)
      await page.evaluate(() => { window.__failures[3] = true; window.__delays[3] = 1000 })
      await measureFeedback(checkbox(1, 'Mariano Ejemplo'), `unassign-failure-${width}`, 'checked', false)
      await page.waitForFunction(() => window.__commands[3]?.failed)
      await page.waitForFunction(() => document.querySelector('.weekly-tech-popover')?.getAttribute('aria-busy') === 'false')
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isChecked(), true)
      assert.match(await page.locator('[data-notice]').textContent(), /No se guardó.*Fallo de conexión simulado/)
      await page.screenshot({ path: path.join(output, `verified-${width}.png`) })
      assert.deepEqual(errors, [])
      assert.deepEqual(unexpectedWrites, [])
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, persistenceDelayMs: [1000, 1500], timings }, null, 2))
    console.log(JSON.stringify({ passed: true, persistenceDelayMs: [1000, 1500], timings }, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
