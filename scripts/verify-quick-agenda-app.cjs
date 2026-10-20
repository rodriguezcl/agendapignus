/* App integration with synthetic state and intercepted APIs. PATCH operations
   use the real authorization/concurrency helpers, without a server or database. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const { preparePlanningClick } = require('../api/_lib/planning-click-operation.cjs')
const { visibleStateForUser, authorizeIncomingState, normalizeStateForSave, secureEmployees, validateState, statePersistenceChanged } = require('../api/_lib/core.cjs')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { stateForOperationComparison } = require('../api/_lib/legacy-estimated-minutes.cjs')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/quick-agenda-app')
fs.mkdirSync(output, { recursive: true })
const fixtureSource = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const fixtureData = fixtureSource.slice(fixtureSource.indexOf('const themeReviewUser ='), fixtureSource.indexOf('const themeReviewNavigation ='))
assert(fixtureData.includes('const themeReviewWeekly ='))
const historicalCount = Number(process.env.QUICK_HISTORY_COUNT || 1000)
const fixture = JSON.parse(JSON.stringify(vm.runInNewContext(fixtureData + `\n({
  user:themeReviewUser,
  state:{revision:1,roles:themeReviewRoles,employees:themeReviewEmployees,services:themeReviewServices,
    customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:themeReviewHistory,reviews:[],preferences:{},
    agenda:{date:'2026-10-13',teams:themeReviewTeams,weekly:themeReviewWeekly}}
})`)))
for (const record of fixture.state.history) record.sourceTaskId = `task-${record.id}`
for (const [day, plan] of Object.entries(fixture.state.agenda.weekly)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
  for (const team of plan.teams) for (const task of team.tasks) task.taskId = `task-${task.historyId}`
}
fixture.state.agenda.teams = structuredClone(fixture.state.agenda.weekly['2026-10-13'].teams)
for (let index = 0; index < historicalCount; index++) fixture.state.history.push({
  ...fixture.state.history[0], id: `synthetic-old-${index}`, sourceTaskId: `synthetic-task-${index}`,
  date: '2025-01-02', client: `CLIENTE SINTÉTICO HISTÓRICO ${index}`
})
// Start from a valid persisted snapshot (roles, durations and completed-service
// metadata), while preserving absent display-only customer reference fields.
fixture.state = normalizeStateForSave(fixture.state, fixture.state, { allowEarlyCompletion: true })
validateState(fixture.state, fixture.state)
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const built = buildSync({
  stdin: { contents: `import './style.css';\nimport React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport App from './App.jsx';\n${cssImports}\ncreateRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: path.join(root, 'src') },
  jsx: 'automatic', bundle: true, write: false, outdir: 'out', format: 'iife',
  external: ['/logo-pignus.png', '/pignus-owl-white.svg'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' },
  loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent'
})
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const results = []
const waitUntil = async predicate => {
  for (let count = 0; count < 200; count++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail('Timed out waiting for the intercepted persistence boundary')
}

async function feedback(locator, label, kind, expected) {
  return locator.evaluate((element, options) => new Promise((resolve, reject) => {
    if (element.disabled) return reject(new Error('Unexpected disabled target: ' + options.label))
    const start = performance.now(), count = window.__snapshots.length
    const matches = () => options.kind === 'checked' ? element.checked === options.expected : element.getAttribute('aria-pressed') === String(options.expected)
    element.click()
    const inspect = () => {
      if (matches()) return requestAnimationFrame(() => resolve({ label:options.label, feedbackMs:performance.now()-start, fullSerializationsBeforeFeedback:window.__snapshots.length-count }))
      if (performance.now()-start > 500) return reject(new Error('Local feedback exceeded 500 ms: ' + options.label))
      requestAnimationFrame(inspect)
    }
    requestAnimationFrame(inspect)
  }), { label, kind, expected })
}

;(async () => {
  const { stateDelta } = await import('../src/domain/shared/state-delta.mjs')
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const width of (process.env.QUICK_WIDTHS || '1440,390').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const errors = [], unexpectedWrites = [], commands = [], timings = []
      const delays = [], failures = []
      let server = structuredClone(fixture.state)
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00-03:00'))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== 'quick-agenda.test') return route.abort()
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/logo-pignus.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'public/logo-pignus.png')) })
        if (url.pathname === '/api/auth/activity' && request.method() === 'POST') return route.fulfill({ json: { ok: true } })
        if (url.pathname === '/api/state' && request.method() === 'PATCH') {
          const body = request.postDataJSON(), index = commands.length
          const command = { index, requestRevision:body.revision, requestedMode:body.responseMode, started:Date.now(), operations:body.operations, finished:null }
          commands.push(command)
          await new Promise(resolve => setTimeout(resolve, delays[index] || 1200))
          try {
            if (failures[index]) throw Object.assign(new Error('Fallo de conexión simulado'), { statusCode: 422 })
            const previous = server
            const prepared = preparePlanningClick(server, body.operations, fixture.user)
            if (!prepared) fs.writeFileSync(path.join(output, `unrecognized-${width}-${index}.json`), JSON.stringify(body, null, 2))
            let next = prepared?.state
            if (!prepared) {
              // The production endpoint retains its general path for legacy
              // projections and mixed changes that do not match the fast path.
              next = authorizeIncomingState(applyStateOperations(visibleStateForUser(stateForOperationComparison(server), fixture.user), body.operations), server, fixture.user)
              next = normalizeStateForSave(next, server, { allowEarlyCompletion: true })
              next.employees = secureEmployees(next.employees, server.employees)
              validateState(next, server)
            }
            server = { ...next, revision: server.revision + (statePersistenceChanged(server, next) ? 1 : 0) }
            command.kind = prepared?.kind || 'general'
            command.responseRevision = server.revision
            const state = visibleStateForUser(server, fixture.user)
            const response = { ok:true, revision:server.revision, merged:body.revision !== previous.revision }
            if (body.responseMode === 'delta-v1' && body.revision === previous.revision) {
              response.delta = stateDelta(visibleStateForUser(previous, fixture.user), state)
              command.responseMode = 'delta-v1'
            } else { response.state = state; command.responseMode = 'state' }
            command.finished = Date.now()
            return route.fulfill({ json: response })
          } catch (error) {
            command.finished = Date.now(); command.error = error.message
            return route.fulfill({ status: error.statusCode || 422, json: { error:error.message, code:error.code } })
          }
        }
        if (request.method() !== 'GET') { unexpectedWrites.push(`${request.method()} ${url.pathname}`); return route.abort() }
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user:fixture.user, state:visibleStateForUser(server, fixture.user) } })
        if (url.pathname === '/api/state') return route.fulfill({ json: visibleStateForUser(server, fixture.user) })
        if (url.pathname.includes('revision')) return route.fulfill({ json: { revision:server.revision } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { holidays:[], days:[], attachments:[], records:[], requests:[] } })
        return route.abort()
      })
      const navigate = async label => {
        if (width <= 640 && !(await page.locator('.sidebar').evaluate(node => node.classList.contains('open')))) await page.locator('.sidebar-toggle').click()
        await page.locator('.sidebar nav').getByRole('button', { name:label, exact:true }).click()
      }
      await page.goto('http://quick-agenda.test/')
      await page.locator('.dashboard-overview').waitFor()
      await navigate('Agenda semanal')
      await page.locator('[data-day="2026-10-14"] .week-team').first().waitFor()
      assert.equal(commands.length, 0, 'Hydration must not write the synthetic fixture')
      await page.evaluate(() => {
        window.__snapshots = []
        const original = JSON.stringify
        JSON.stringify = function(value, ...options) {
          const start = performance.now()
          const result = original.call(this, value, ...options)
          if (value?.agenda && Array.isArray(value.history) && Array.isArray(value.customers) && Array.isArray(value.employees)) window.__snapshots.push({ at:performance.now(), characters:result.length, durationMs:performance.now()-start })
          return result
        }
      })
      const preparation = page.locator('[data-day="2026-10-14"] .service-preparation-button')
      delays.push(1000, 1500, 1000, 1500, 1000, 1200, 1000)
      timings.push(await feedback(preparation.nth(0), `ready-${width}`, 'pressed', true))
      await preparation.nth(0).evaluate(element => { element.click(); element.click() })
      timings.push(await feedback(preparation.nth(1), `independent-ready-${width}`, 'pressed', true))
      await waitUntil(() => commands[0]?.finished)
      assert.equal(commands[0].error, undefined, `First preparation failed: ${commands[0].error}`)
      assert.equal(commands.length, 2)
      assert.equal(commands[1].finished, null)
      assert.equal(await preparation.nth(0).getAttribute('aria-pressed'), 'true')
      assert.equal(await preparation.nth(0).getAttribute('aria-busy'), 'true', 'Early ACK must remain pending until App publishes the batch')
      await waitUntil(() => commands[1]?.finished)
      await page.waitForFunction(() => [...document.querySelectorAll('[data-day="2026-10-14"] .service-preparation-button')].every(node => node.getAttribute('aria-busy') === 'false'))
      assert.deepEqual(commands.slice(0, 2).map(command => command.responseMode), ['delta-v1', 'state'])
      assert.deepEqual(commands.slice(0, 2).map(command => command.kind), ['service_preparation', 'service_preparation'], 'Display enrichment must not force a quick preparation command through the general save pipeline')
      assert.equal(server.history.find(item => item.id === 'h-pending').servicePreparation.ready, true)
      assert.equal(server.history.find(item => item.id === 'h-afternoon').servicePreparation.ready, true)
      failures[2] = true
      timings.push(await feedback(preparation.nth(0), `ready-rollback-${width}`, 'pressed', false))
      await waitUntil(() => commands[2]?.finished)
      await page.waitForFunction(() => document.querySelector('[data-day="2026-10-14"] .service-preparation-button')?.getAttribute('aria-busy') === 'false')
      assert.equal(await preparation.nth(0).getAttribute('aria-pressed'), 'true')
      assert.match(await page.locator('.notice').textContent(), /No se cambió.*Fallo de conexión simulado/)

      const teams = page.locator('[data-day="2026-10-14"] .week-team')
      const checkbox = (index, name) => teams.nth(index).locator(`.tech-list label[title="${name}"] input`)
      await teams.nth(0).locator('.weekly-add-tech-button').click()
      timings.push(await feedback(checkbox(0, 'Mariano Ejemplo'), `unassign-${width}`, 'checked', false))
      timings.push(await feedback(checkbox(0, 'Pascual Ejemplo'), `queued-assign-${width}`, 'checked', true))
      timings.push(await feedback(checkbox(0, 'Rodrigo Ejemplo'), `queued-unassign-${width}`, 'checked', false))
      assert.deepEqual(server.agenda.weekly['2026-10-14'].teams[0].memberIds, ['tech-1', 'tech-2'])
      assert.equal(commands.length, 4)
      await page.locator('.picker-backdrop').click({ position: { x:5, y:5 } })
      await teams.nth(1).locator('.weekly-add-tech-button').click()
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isDisabled(), false)
      timings.push(await feedback(checkbox(1, 'Mariano Ejemplo'), `independent-team-${width}`, 'checked', true))
      await waitUntil(() => commands[4]?.finished)
      assert.equal(commands[3].finished, null, 'Independent team responses must arrive out of order')
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isChecked(), true)
      await waitUntil(() => commands[5]?.finished)
      await page.waitForFunction(() => !document.querySelector('.confirmed-save-status, .weekly-tech-popover[aria-busy="true"]'))
      assert.equal(commands.length, 6, 'Three same-team clicks must generate one initial and one final-intent command')
      assert.deepEqual(server.agenda.weekly['2026-10-14'].teams[0].memberIds, ['tech-3'])
      assert.deepEqual(server.agenda.weekly['2026-10-14'].teams[1].memberIds, ['tech-3', 'tech-1'])
      assert.match(await teams.nth(0).locator('.week-team-identity').textContent(), /Pascual/)
      assert.doesNotMatch(await teams.nth(0).locator('.week-team-identity').textContent(), /Mariano|Rodrigo/)
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isChecked(), true)
      failures[6] = true
      timings.push(await feedback(checkbox(1, 'Mariano Ejemplo'), `membership-rollback-${width}`, 'checked', false))
      await waitUntil(() => commands[6]?.finished)
      await page.waitForFunction(() => document.querySelector('.weekly-tech-popover')?.getAttribute('aria-busy') === 'false')
      assert.equal(await checkbox(1, 'Mariano Ejemplo').isChecked(), true)
      assert.match(await page.locator('.notice').textContent(), /No se guardó.*Fallo de conexión simulado/)
      assert.equal(commands.length, 7)
      assert.deepEqual(commands.filter((_, index) => ![2, 6].includes(index)).map(command => command.error).filter(Boolean), [])
      assert.deepEqual(errors, [])
      assert.deepEqual(unexpectedWrites, [])
      for (const timing of timings) {
        assert(timing.feedbackMs < 250, `${timing.label}: slow local feedback ${timing.feedbackMs} ms`)
        assert.equal(timing.fullSerializationsBeforeFeedback, 0, `${timing.label}: full snapshot serialization delayed local feedback`)
      }
      await page.screenshot({ path:path.join(output, `verified-${width}.png`) })
      const snapshotWork = await page.evaluate(() => ({
        totalFullSerializations:window.__snapshots.length,
        totalCharacters:window.__snapshots.reduce((total, item) => total+item.characters, 0),
        maxSerializationMs:Math.max(0, ...window.__snapshots.map(item => item.durationMs))
      }))
      results.push({ width, historicalCount, timings, snapshotWork, commands:commands.map(({operations, ...command}) => ({ ...command, operationCount:operations.length, roundtripMs:command.finished-command.started })) })
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed:true, results }, null, 2))
    console.log(JSON.stringify({ passed:true, results }, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
