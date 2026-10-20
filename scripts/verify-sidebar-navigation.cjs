/* Real application navigation, synthetic state, fully intercepted networking.
   No request reaches production and no business mutation is accepted. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const policy = require('../api/_lib/permission-catalog.cjs')
const { userForEmployee, visibleStateForUser } = require('../api/_lib/core.cjs')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/sidebar-navigation')
fs.mkdirSync(output, { recursive: true })
const sharedFixture = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const start = sharedFixture.indexOf('const themeReviewUser =')
const end = sharedFixture.indexOf('const themeReviewNavigation =')
assert(start >= 0 && end > start, 'Shared chrome fixture must exist')
const seed = vm.runInNewContext(`${sharedFixture.slice(start, end)}\n({revision:1,roles:themeReviewRoles,employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:themeReviewHistory,agenda:{date:'2026-10-13',teams:themeReviewTeams,weekly:themeReviewWeekly}})`)
const permissions = (...ids) => ({ __catalogV2: true, ...Object.fromEntries(policy.CATALOG.map(item => [item.id, ids.includes(item.id)])) })
seed.roles.push(
  { id: 'qa-fleet-role', code: 'qa-fleet-role', name: 'Flota QA', permissions: permissions('dashboard.view', 'vehicles.view') },
  { id: 'qa-summary-role', code: 'qa-summary-role', name: 'Resumen QA', permissions: permissions('dashboard.view') },
  { id: 'qa-mixed-role', code: 'qa-mixed-role', name: 'Mixto QA', permissions: permissions('dashboard.view', 'technical.view', 'records.read') }
)
for (const [id, roleId] of [['qa-admin-a', 'r-admin'], ['qa-admin-b', 'r-admin'], ['qa-fleet', 'qa-fleet-role'], ['qa-summary', 'qa-summary-role'], ['qa-mixed', 'qa-mixed-role']]) {
  seed.employees.push({ id, roleId, role: seed.roles.find(role => role.id === roleId).name, firstName: 'Navegación', lastName: id, name: `Navegación ${id}`, email: `${id}@example.test`, status: 'Activo', technicalEnabled: id === 'qa-mixed' })
}
const actors = Object.fromEntries(seed.employees.filter(employee => employee.id.startsWith('qa-')).map(employee => [employee.id, userForEmployee(employee, seed.roles)]))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const built = buildSync({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import './style.css';import App from './App.jsx';\n${cssImports}\ncreateRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent'
})
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const layouts = [
  { width: 1440, height: 960 }, { width: 1440, height: 560 },
  { width: 390, height: 844 }, { width: 320, height: 568 }
].filter(layout => !process.env.SIDEBAR_WIDTHS || process.env.SIDEBAR_WIDTHS.split(',').map(Number).includes(layout.width))
const results = []
const sidebar = page => page.locator('#main-navigation')
const group = (page, label) => sidebar(page).getByRole('button', { name: label, exact: true })
const moduleButton = (page, label) => sidebar(page).getByRole('button', { name: label, exact: true })

async function ready(page) {
  await page.locator('.dashboard-overview').waitFor()
  await page.waitForFunction(() => document.querySelector('.topbar .page-heading h1')?.textContent === 'Resumen general')
}

async function showDrawer(page) {
  if (page.viewportSize().width <= 640 && !await sidebar(page).evaluate(element => element.classList.contains('open'))) {
    await page.getByRole('button', { name: 'Abrir menú lateral', exact: true }).tap()
    await page.locator('#main-navigation.open').waitFor()
  }
}

async function setGroup(page, label, expanded) {
  await showDrawer(page)
  const button = group(page, label)
  if (await button.getAttribute('aria-expanded') !== String(expanded)) await button.click()
  assert.equal(await button.getAttribute('aria-expanded'), String(expanded), `${label} has explicit expanded state`)
}

async function navigate(page, label) {
  await showDrawer(page)
  if (['Colaboradores', 'Flota', 'Tipos de servicio'].includes(label) && !await moduleButton(page, label).isVisible()) await setGroup(page, 'Recursos', true)
  if (['Configuración', 'Auditoría'].includes(label) && !await moduleButton(page, label).isVisible()) await setGroup(page, 'Administración', true)
  const button = moduleButton(page, label)
  if (page.viewportSize().width <= 640) await button.tap()
  else await button.click()
  await page.waitForFunction(expected => document.querySelector('#main-navigation [aria-current="page"]')?.getAttribute('aria-label') === expected, label)
  if (page.viewportSize().width <= 640) assert.equal(await page.locator('#main-navigation.open').count(), 0, 'Selecting a module closes the mobile drawer')
}

async function capture(page, name) {
  await showDrawer(page)
  const geometry = await sidebar(page).evaluate(element => {
    const rect = element.getBoundingClientRect()
    const buttons = [...element.querySelectorAll('button')].filter(button => button.getClientRects().length)
    const help = buttons.find(button => button.getAttribute('aria-label') === 'Centro de ayuda')
    const helpRect = help?.getBoundingClientRect()
    const footer = element.querySelector('.sidebar-bottom')
    const footerRect = footer?.getBoundingClientRect()
    return {
      viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
      sidebar: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom },
      help: helpRect && { x: helpRect.x, y: helpRect.y, width: helpRect.width, bottom: helpRect.bottom },
      footer: footerRect && { y: footerRect.y, bottom: footerRect.bottom },
      horizontalOverflow: buttons.filter(button => { const r = button.getBoundingClientRect(); return r.left < rect.left - 1 || r.right > rect.right + 1 }).map(button => button.getAttribute('aria-label') || button.textContent)
    }
  })
  assert(geometry.pageWidth <= geometry.viewport.width + 1, `${name}: no page overflow`)
  assert.deepEqual(geometry.horizontalOverflow, [], `${name}: navigation controls fit the sidebar`)
  if (!name.startsWith('restricted-')) assert(geometry.help && geometry.help.bottom <= geometry.viewport.height + 1 && geometry.help.y >= 0, `${name}: help remains reachable at the bottom`)
  assert(geometry.footer && geometry.footer.bottom <= geometry.viewport.height + 1, `${name}: footer stays on screen`)
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false })
  return geometry
}

async function checkGroups(page) {
  await showDrawer(page)
  assert.equal(await group(page, 'Recursos').getAttribute('aria-expanded'), 'false', 'Resources starts collapsed')
  assert.equal(await group(page, 'Administración').getAttribute('aria-expanded'), 'false', 'Administration starts collapsed')
  for (const label of ['Colaboradores', 'Flota', 'Tipos de servicio', 'Configuración', 'Auditoría']) assert.equal(await moduleButton(page, label).isVisible(), false)
  await setGroup(page, 'Recursos', true)
  await setGroup(page, 'Administración', true)
  const labels = await sidebar(page).locator('[aria-label][aria-current], button[aria-label]').evaluateAll(buttons => buttons.filter(button => button.getClientRects().length && !button.hasAttribute('aria-expanded')).map(button => button.getAttribute('aria-label')).filter(label => label !== 'Ir al inicio'))
  assert.deepEqual(labels, ['Resumen general', 'Agenda semanal', 'Historial', 'Abonados y clientes', 'Cobranzas', 'Mapa', 'Colaboradores', 'Flota', 'Tipos de servicio', 'Configuración', 'Auditoría', 'Centro de ayuda'], 'Navigation order and module names match the approved sidebar')
  assert.equal(await group(page, 'Recursos').getAttribute('aria-expanded'), 'true', 'Opening administration does not close resources')
  assert.equal(await sidebar(page).getByRole('heading', { name: 'Operación', exact: true }).count(), 1)
  assert.equal(await sidebar(page).getByRole('heading', { name: 'Clientes y cobranzas', exact: true }).count(), 1)
}

async function checkPersistence(page, environment) {
  await setGroup(page, 'Recursos', true)
  await setGroup(page, 'Administración', false)
  await page.reload()
  await ready(page)
  await showDrawer(page)
  assert.equal(await group(page, 'Recursos').getAttribute('aria-expanded'), 'true', 'Open group persists across reload')
  assert.equal(await group(page, 'Administración').getAttribute('aria-expanded'), 'false', 'Closed group persists across reload')
  environment.actorId = 'qa-admin-b'
  await page.reload()
  await ready(page)
  await showDrawer(page)
  assert.equal(await group(page, 'Recursos').getAttribute('aria-expanded'), 'false', 'A second user starts with independent group preferences')
  assert.equal(await group(page, 'Administración').getAttribute('aria-expanded'), 'false')
  environment.actorId = 'qa-admin-a'
  await page.reload()
  await ready(page)
  await showDrawer(page)
  assert.equal(await group(page, 'Recursos').getAttribute('aria-expanded'), 'true', 'Returning to first user restores their open group')
}

async function checkCompact(page) {
  await page.getByRole('button', { name: 'Contraer menú lateral', exact: true }).click()
  assert((await sidebar(page).boundingBox()).width <= 80, 'Compact desktop sidebar is an icon rail')
  await group(page, 'Recursos').click()
  await page.getByRole('button', { name: 'Contraer menú lateral', exact: true }).waitFor()
  assert((await sidebar(page).boundingBox()).width > 150, 'Clicking a compact group expands the sidebar')
  assert.equal(await group(page, 'Recursos').getAttribute('aria-expanded'), 'true')
  await navigate(page, 'Flota')
  await page.locator('.vehicle-row').first().waitFor()
  assert.equal(await page.locator('.topbar .page-heading h1').textContent(), 'Flota', 'Renamed fleet opens the existing vehicle module')
  await navigate(page, 'Colaboradores')
  await page.locator('.employee-row').first().waitFor()
  assert.equal(await page.locator('.topbar .page-heading h1').textContent(), 'Colaboradores', 'Renamed collaborators opens the existing employee module')
}

async function checkMobileFocus(page) {
  await showDrawer(page)
  assert.equal(await sidebar(page).getAttribute('role'), 'dialog')
  const first = sidebar(page).locator('[role="button"],button').filter({ visible: true }).first()
  await first.focus()
  await page.keyboard.press('Shift+Tab')
  assert(await sidebar(page).evaluate(element => element.contains(document.activeElement)), 'Shift+Tab stays inside mobile navigation')
  await page.keyboard.press('Tab')
  assert(await sidebar(page).evaluate(element => element.contains(document.activeElement)), 'Tab stays inside mobile navigation')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#main-navigation.open').count(), 0)
  await page.waitForFunction(() => document.activeElement === document.querySelector('.sidebar-toggle'))
  await showDrawer(page)
  await page.locator('.backdrop').tap({ position: { x: page.viewportSize().width - 8, y: 100 } })
  assert.equal(await page.locator('#main-navigation.open').count(), 0, 'Touching the backdrop closes the mobile drawer')
  await page.waitForFunction(() => document.activeElement === document.querySelector('.sidebar-toggle'))
  await navigate(page, 'Flota')
  await page.locator('.vehicle-row').first().waitFor()
  await page.waitForFunction(() => document.activeElement === document.querySelector('.sidebar-toggle'))
}

async function checkExternalNavigation(page) {
  await navigate(page, 'Resumen general')
  await setGroup(page, 'Recursos', false)
  await navigate(page, 'Centro de ayuda')
  await page.locator('.help-categories').getByRole('button', { name: /^Flota\b/ }).click()
  await page.locator('.help-content').getByRole('button', { name: /^Ir al módulo/ }).click()
  await page.locator('.vehicle-row').first().waitFor()
  assert.equal(await group(page, 'Recursos').getAttribute('aria-expanded'), 'true', 'External navigation automatically opens the active module group')
  assert.equal(await moduleButton(page, 'Flota').getAttribute('aria-current'), 'page')
}

async function checkGuardAndPreview(page) {
  await navigate(page, 'Configuración')
  await page.locator('.role-permission-editor').waitFor()
  const name = page.getByLabel('Nombre del rol', { exact: true })
  const original = await name.inputValue()
  await name.fill(`${original} borrador QA`)
  await showDrawer(page)
  await moduleButton(page, 'Resumen general').click()
  const confirmation = page.getByRole('alertdialog')
  await confirmation.waitFor()
  assert.match(await confirmation.textContent(), /Cambios sin guardar/)
  assert.equal(await page.locator('.topbar .page-heading h1').textContent(), 'Configuración', 'Blocked navigation keeps the current module')
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal(await name.inputValue(), `${original} borrador QA`, 'Cancelling navigation preserves the form')
  await showDrawer(page)
  await moduleButton(page, 'Resumen general').click()
  await confirmation.getByRole('button', { name: 'Confirmar cambios', exact: true }).click()
  await ready(page)
  await navigate(page, 'Configuración')
  assert.equal(await name.inputValue(), original, 'Confirmed discard navigates without saving the role')
  await page.getByRole('button', { name: 'Vista previa del rol', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Vista previa del rol', exact: true })
  await dialog.waitFor()
  const ids = await dialog.locator('[data-module-id]').evaluateAll(buttons => buttons.map(button => button.dataset.moduleId))
  assert.deepEqual(ids.filter(id => !['agenda', 'technical', 'help'].includes(id)), ['dashboard', 'weekly', 'history', 'accounts', 'collections', 'map', 'employees', 'vehicles', 'services', 'settings', 'audit'], 'Role preview uses the same module order')
  for (const label of ['Colaboradores', 'Flota', 'Resumen general']) assert(await dialog.getByText(label, { exact: true }).count() > 0, `Role preview reflects ${label}`)
  await dialog.getByRole('button', { name: 'Volver a configurar', exact: true }).click()
}

async function checkRestrictedRoles(page, environment) {
  environment.actorId = 'qa-fleet'
  await page.reload()
  await ready(page)
  await showDrawer(page)
  assert.equal(await group(page, 'Recursos').count(), 0, 'A group with one authorized child is flattened')
  assert.equal(await group(page, 'Administración').count(), 0, 'An unauthorized group is omitted')
  assert(await moduleButton(page, 'Flota').isVisible(), 'The sole authorized resource stays directly reachable')
  assert.equal(await moduleButton(page, 'Colaboradores').count(), 0)
  await navigate(page, 'Flota')
  await page.locator('.vehicle-row').first().waitFor()
  environment.actorId = 'qa-summary'
  await page.reload()
  await ready(page)
  await showDrawer(page)
  assert.equal(await sidebar(page).locator('[aria-expanded]').count(), 0, 'Summary-only role has no empty groups')
  for (const label of ['Flota', 'Colaboradores', 'Auditoría', 'Configuración']) assert.equal(await moduleButton(page, label).count(), 0)
  assert.equal(await sidebar(page).getByRole('heading', { name: 'Operación', exact: true }).count(), 0, 'Empty static sections are omitted')
}

async function checkMixedRole(page, environment) {
  environment.actorId = 'qa-mixed'
  await page.reload()
  await ready(page)
  await showDrawer(page)
  await moduleButton(page, 'Mis servicios').click()
  await page.getByRole('button', { name: /Volver a gestión/ }).waitFor()
  if (page.viewportSize().width <= 640) await page.getByRole('button', { name: 'Abrir menú', exact: true }).tap()
  await page.getByRole('button', { name: /Volver a gestión/ }).click()
  await ready(page)
  assert.equal(await moduleButton(page, 'Resumen general').getAttribute('aria-current'), 'page', 'Mixed technical users return to their first management module')
}

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const layout of layouts) for (const theme of (process.env.SIDEBAR_THEMES || 'light,dark').split(',')) {
      const context = await browser.newContext({ viewport: layout, hasTouch: layout.width <= 640, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const environment = { actorId: 'qa-admin-a' }, errors = [], writes = [], unexpected = []
      const before = JSON.stringify(seed)
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00-03:00'))
      await page.addInitScript(({ theme, ids }) => ids.forEach(id => localStorage.setItem(`pignus-theme-account:${id}`, theme)), { theme, ids: Object.keys(actors) })
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
        if (url.hostname !== 'sidebar-review.test') { unexpected.push(`${request.method()} ${url.hostname}${url.pathname}`); return route.abort() }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/logo-pignus.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'public/logo-pignus.png')) })
        if (url.pathname === '/pignus-owl-white.svg') return route.fulfill({ contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, 'public/pignus-owl-white.svg')) })
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
        if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { active: true } })
        if (request.method() !== 'GET') { writes.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 403, json: { error: 'Navigation review cannot write business data' } }) }
        const actor = actors[environment.actorId]
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: actor, state: visibleStateForUser(seed, actor) } })
        if (url.pathname === '/api/auth/session-status') return route.fulfill({ json: { active: true, sessionUser: actor } })
        if (url.pathname === '/api/state') return route.fulfill({ json: visibleStateForUser(seed, actor) })
        if (url.pathname === '/api/technician/state') return route.fulfill({ json: { history: [], services: [], vehicles: [], revision: 1 } })
        if (url.pathname === '/api/state/revision') return route.fulfill({ json: { revision: 1 } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { holidays: [], days: [], requests: [], attachments: [], records: [] } })
        unexpected.push(`${request.method()} ${url.pathname}`)
        return route.abort()
      })
      const label = `${theme}-${layout.width}x${layout.height}`
      try {
        await page.goto('http://sidebar-review.test/')
        await ready(page)
        await checkGroups(page)
        const geometry = await capture(page, `expanded-${label}`)
        await checkPersistence(page, environment)
        if (layout.width > 640) await checkCompact(page)
        else await checkMobileFocus(page)
        // The existing help layout hides its module launcher below 900px.
        if (layout.width > 640) await checkExternalNavigation(page)
        await checkGuardAndPreview(page)
        await checkRestrictedRoles(page, environment)
        await capture(page, `restricted-${label}`)
        await checkMixedRole(page, environment)
        assert.deepEqual(errors, [], 'No browser runtime errors')
        assert.deepEqual(writes, [], 'Navigation and role preview make no business mutations')
        assert.deepEqual(unexpected, [], 'All fixture requests remain local and accounted for')
        assert.equal(JSON.stringify(seed), before, 'Stored synthetic records remain unchanged')
        results.push({ ...layout, theme, geometry, errors: errors.length, writes: writes.length, checks: ['group-order', 'independent-expansion', 'per-user-persistence', ...(layout.width > 640 ? ['compact-expand', 'external-active-group'] : ['mobile-touch-focus']), 'form-navigation-guard', 'role-preview-order', 'restricted-single-and-empty-groups', 'mixed-technical-return', 'help-footer', 'no-overflow'] })
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2))
        console.log(`PASS sidebar ${label}`)
      } catch (error) {
        await page.screenshot({ path: path.join(output, `failure-${label}.png`), fullPage: false }).catch(() => {})
        throw error
      } finally { await context.close() }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2))
    console.log(`Sidebar navigation: ${results.length} layout/theme cases passed.`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
