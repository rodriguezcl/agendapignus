// Real App, synthetic intercepted APIs, no credentials or external writes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const { visibleStateForUser, userForEmployee } = require('../api/_lib/core.cjs')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/session-permissions')
fs.mkdirSync(output, { recursive: true })
const theme = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const data = theme.slice(theme.indexOf('const themeReviewUser ='), theme.indexOf('const themeReviewNavigation ='))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const source = `
import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx';
${cssImports}
${data}
window.__seed={revision:1,roles:themeReviewRoles,employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:themeReviewHistory,agenda:{date:'2026-10-13',teams:themeReviewTeams,weekly:themeReviewWeekly}};
createRoot(document.getElementById('root')).render(<App/>);
`
const built = buildSync({ stdin: { contents: source, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const permissions = (...ids) => ({ __catalogV2: true, ...Object.fromEntries(ids.map(id => [id, true])) })

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const results = []
  try {
    for (const width of (process.env.PERMISSION_WIDTHS || '1440,390').split(',').map(Number)) {
      for (const scenario of ['weekly', 'draft', 'administrator', 'legacy-technician', 'technical-disabled']) {
        const page = await browser.newPage({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
        let state, stateLoads = 0, statusLoads = 0
        const errors = [], writes = []
        const actor = () => userForEmployee(state.employees.find(employee => employee.id === 'tech-1'), state.roles)
        const projection = () => visibleStateForUser(state, actor())
        const focus = () => page.evaluate(() => window.dispatchEvent(new Event('focus')))
        page.on('pageerror', error => errors.push(error.message))
        page.setDefaultTimeout(15000)
        await page.clock.setFixedTime(new Date('2026-10-13T12:00:00-03:00'))
        await page.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url())
          if (url.hostname !== 'session-permissions.test') return route.abort()
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
          if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
          if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
          if (!state) {
            state = await page.evaluate(() => window.__seed)
            const reader = { id: 'qa-reader', code: 'qa-reader', name: 'Consulta historial', permissions: permissions('history.view', 'records.read') }
            const editor = { id: 'qa-editor', code: 'qa-editor', name: 'Editor semanal', permissions: permissions('weekly.view', 'records.read', 'planning.ready') }
            const manager = { id: 'qa-manager', code: 'qa-manager', name: 'Gestor de roles', permissions: permissions('settings.view', 'settings.roles.read', 'settings.roles.edit') }
            const technical = { id: 'qa-technical', code: 'qa-technical', name: 'Portal técnico', permissions: permissions('technical.view', 'records.read') }
            const target = { id: 'qa-target', code: 'qa-target', name: 'Rol objetivo', description: 'Descripción inicial', permissions: permissions('weekly.view') }
            state.roles.push(reader, editor, manager, technical, target)
            const employee = state.employees.find(employee => employee.id === 'tech-1')
            employee.roleId = scenario === 'legacy-technician' ? 'r-tech' : scenario === 'administrator' ? 'r-admin' : scenario === 'draft' ? manager.id : scenario === 'technical-disabled' ? technical.id : editor.id
            employee.role = state.roles.find(role => role.id === employee.roleId).name
            if (scenario === 'technical-disabled') employee.technicalEnabled = false
            if (scenario === 'administrator') state.roles.find(role => role.id === 'r-admin').permissions = permissions()
          }
          if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { active: true } })
          if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 403, json: { error: 'Unexpected write' } }) }
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: actor(), state: projection() } })
          if (url.pathname === '/api/auth/session-status') {
            statusLoads++
            return route.fulfill({ json: { active: true, sessionUser: actor() } })
          }
          if (url.pathname === '/api/state') { stateLoads++; return route.fulfill({ json: projection() }) }
          if (url.pathname === '/api/state/revision') return route.fulfill({ json: { revision: state.revision } })
          if (url.pathname === '/api/technician/state') {
            if (actor().roleCode !== 'technician') return route.fulfill({ status: 403, json: { error: 'El rol ya no tiene acceso técnico.' } })
            return route.fulfill({ json: projection() })
          }
          if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { holidays: [], days: [], requests: [], attachments: [], records: [] } })
          return route.abort()
        })
        await page.goto('http://session-permissions.test/')
        if (scenario === 'legacy-technician') await page.locator('.technician-page').waitFor()
        else await page.locator('.topbar').waitFor()
        if (scenario === 'weekly') {
          await page.locator('.service-preparation-button').first().waitFor()
          state.roles.find(role => role.id === 'qa-editor').permissions['planning.ready'] = false
          state.revision++
          await focus()
          await page.waitForFunction(() => !document.querySelector('.service-preparation-button'))
          assert.equal(await page.locator('.weekly-intro').count(), 1, 'Revoking one action preserves the authorized module')
        }
        if (scenario === 'technical-disabled') {
          await page.waitForFunction(() => document.querySelector('.topbar .page-heading h1')?.textContent === 'Centro de ayuda')
          assert.equal(await page.locator('.technician-page').count(), 0)
          assert.equal(await page.locator('.sidebar nav').getByRole('button', { name: 'Mis servicios', exact: true }).count(), 0)
          assert((await page.locator('.content').textContent()).trim().length > 30, 'Ineligible technical access has a visible fallback')
        } else if (scenario === 'draft') {
          await page.locator('.role-picker').getByRole('button', { name: 'Rol objetivo Descripción inicial' }).click()
          await page.getByLabel('Descripción', { exact: true }).fill('Borrador que debe conservarse')
          state.roles.find(role => role.id === 'qa-manager').permissions['settings.roles.edit'] = false
          state.revision++
          await focus()
          await page.waitForFunction(() => document.querySelector('.role-permission-editor input[maxlength="500"]')?.disabled === true)
          assert.equal(await page.getByLabel('Descripción', { exact: true }).inputValue(), 'Borrador que debe conservarse')
          assert.equal(await page.getByRole('button', { name: 'Guardar rol', exact: true }).isDisabled(), true)
        } else {
          if (scenario === 'administrator') assert(await page.locator('.sidebar nav').getByRole('button', { name: 'Configuración', exact: true }).count())
          const employee = state.employees.find(employee => employee.id === 'tech-1')
          employee.roleId = 'qa-reader'; employee.role = 'Consulta historial'; employee.technicalEnabled = false
          state.revision++
          await focus()
          await page.locator('.sidebar nav').getByRole('button', { name: 'Historial', exact: true }).waitFor()
          await page.waitForFunction(() => document.querySelector('.topbar .page-heading h1')?.textContent === 'Historial')
          assert.equal(await page.locator('.technician-page').count(), 0)
          assert.equal(await page.locator('.sidebar nav').getByRole('button', { name: 'Configuración', exact: true }).count(), 0)
          assert.equal(await page.locator('.sidebar nav').getByRole('button', { name: 'Agenda semanal', exact: true }).count(), 0)
          assert.equal(await page.locator('.service-preparation-button').count(), 0)
        }
        assert(statusLoads > 0, 'The existing lightweight session subscription receives updates')
        assert(stateLoads < 8, 'Identity updates do not restart the session/bootstrap loop')
        assert.deepEqual(errors, [])
        assert.deepEqual(writes, [])
        await page.screenshot({ path: path.join(output, `${scenario}-${width}.png`), fullPage: true })
        results.push({ scenario, width, errors: 0, writes: 0, stateLoads, statusLoads })
        console.log(`PASS session ${scenario}/${width}`)
        await page.close({ runBeforeUnload: false })
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
