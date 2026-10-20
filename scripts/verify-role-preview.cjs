// Exercise the real application with synthetic state; no request reaches a server.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const catalog = require('../api/_lib/permission-catalog.cjs')
const { userForEmployee, visibleStateForUser } = require('../api/_lib/core.cjs')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/role-preview')
fs.mkdirSync(output, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const built = buildSync({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx';\n${cssImports}\ncreateRoot(document.getElementById('root')).render(<App/>);`,
    loader: 'jsx', resolveDir: path.join(root, 'src')
  },
  bundle: true, write: false, outdir: 'out', format: 'iife',
  external: ['/logo-pignus.png', '/pignus-owl-white.svg'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' },
  loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent'
})
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const permissionSet = (...ids) => ({ __catalogV2: true, ...Object.fromEntries(catalog.CATALOG.map(item => [item.id, ids.includes(item.id)])) })

function fixture() {
  const roles = [
    { id: 'qa-admin', code: 'administrator', name: 'Administrador', description: 'Acceso completo a la plataforma', permissions: permissionSet() },
    { id: 'qa-preview', code: 'qa-preview', name: 'Operador QA', permissions: permissionSet('weekly.view', 'records.read', 'planning.ready', 'collections.view', 'records.financial') },
    { id: 'qa-empty', code: 'qa-empty', name: 'Rol sin acceso', permissions: permissionSet() },
    { id: 'qa-technical', code: 'qa-technical', name: 'Técnico QA', permissions: permissionSet('technical.view', 'records.read', 'technical.start', 'technical.advance', 'technical.complete') }
  ]
  const employee = { id: 'qa-admin-user', roleId: 'qa-admin', role: 'Administrador', firstName: 'Administración', lastName: 'QA', name: 'Administración QA', email: 'administracion@example.test', status: 'Activo', technicalEnabled: false }
  return {
    revision: 1, roles, employees: [employee], history: [], customers: [], vehicles: [],
    services: [{ id: 'qa-service', name: 'Instalación de alarma', code: 'alarm-installation', status: 'Activo', estimatedMinutes: 60 }],
    agenda: { date: '2026-10-20', teams: [], weekly: {} }
  }
}

async function openPreview(page) {
  const launcher = page.getByRole('button', { name: 'Vista previa del rol', exact: true }).first()
  await launcher.click()
  const dialog = page.getByRole('dialog', { name: 'Vista previa del rol', exact: true })
  await dialog.waitFor()
  const bounds = await dialog.boundingBox()
  if (page.viewportSize().width === 1440) assert(bounds.width >= 1000, 'Desktop preview uses a readable two-column width')
  return { launcher, dialog }
}

async function checkFocusTrap(page, dialog) {
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')
  const count = await focusable.count()
  assert(count > 2, 'Preview has keyboard-accessible controls')
  await focusable.first().focus()
  for (let index = 0; index < count + 2; index++) {
    await page.keyboard.press('Tab')
    assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab stays inside the preview dialog')
  }
  await focusable.first().focus()
  await page.keyboard.press('Shift+Tab')
  assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Shift+Tab stays inside the preview dialog')
}

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const results = []
  try {
    for (const width of (process.env.PERMISSION_WIDTHS || '1440,390').split(',').map(Number)) {
      for (const theme of (process.env.PERMISSION_THEMES || 'light,dark').split(',')) {
        const page = await browser.newPage({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
        page.setDefaultTimeout(15000)
        const state = fixture(), errors = [], writes = [], unexpected = []
        const before = JSON.stringify(state)
        const actor = userForEmployee(state.employees[0], state.roles)
        const projected = visibleStateForUser(state, actor)
        page.on('pageerror', error => errors.push(error.message))
        await page.addInitScript(({ theme, id }) => localStorage.setItem(`pignus-theme-account:${id}`, theme), { theme, id: actor.id })
        await page.clock.setFixedTime(new Date('2026-10-20T12:00:00-03:00'))
        await page.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url())
          if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
          if (url.hostname !== 'role-preview.test') {
            unexpected.push(`${request.method()} ${url.hostname}${url.pathname}`)
            return route.abort()
          }
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
          if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
          if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
          if (url.pathname === '/logo-pignus.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'public/logo-pignus.png')) })
          if (url.pathname === '/pignus-owl-white.svg') return route.fulfill({ contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, 'public/pignus-owl-white.svg')) })
          if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
          if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { active: true } })
          if (request.method() !== 'GET') {
            writes.push(`${request.method()} ${url.pathname}`)
            return route.fulfill({ status: 403, json: { error: 'Unexpected mutation in a role preview' } })
          }
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: actor, state: projected } })
          if (url.pathname === '/api/auth/session-status') return route.fulfill({ json: { active: true, sessionUser: actor } })
          if (url.pathname === '/api/state') return route.fulfill({ json: projected })
          if (url.pathname === '/api/state/revision') return route.fulfill({ json: { revision: state.revision } })
          if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { holidays: [], days: [], requests: [], attachments: [], records: [] } })
          unexpected.push(`${request.method()} ${url.pathname}`)
          return route.abort()
        })
        try {
          await page.goto('http://role-preview.test/')
          await page.locator('.topbar').waitFor()
          if (width < 760) await page.locator('.sidebar-toggle').click()
          await page.locator('.sidebar nav').getByRole('button', { name: 'Configuración', exact: true }).click()
          await page.locator('.role-picker').getByRole('button', { name: 'Operador QA', exact: true }).click()
          const checkbox = id => page.locator('.role-capability').filter({ has: page.locator(`[id="role-permission-${id}"]`) }).getByRole('checkbox')
          const available = (dialog, id) => dialog.locator(`[data-permission-id="${id}"][data-enabled="true"]`)
          const moduleButton = (dialog, id) => dialog.getByRole('navigation', { name: 'Módulos del rol en vista previa', exact: true }).locator(`[data-module-id="${id}"]`)
          const selectModule = id => page.locator('.role-module-picker select').selectOption(id)

          await page.getByLabel('Nombre del rol', { exact: true }).fill('Agente borrador QA')
          await checkbox('planning.ready').uncheck()
          let { launcher, dialog } = await openPreview(page)
          assert((await dialog.innerText()).includes('Agente borrador QA'), 'Preview uses the unsaved name')
          assert.equal(await moduleButton(dialog, 'weekly').count(), 1)
          assert.equal(await moduleButton(dialog, 'collections').count(), 1)
          await moduleButton(dialog, 'weekly').click()
          assert.equal(await available(dialog, 'planning.ready').count(), 0, 'Revoked actions are not available')
          assert.equal(await available(dialog, 'records.read').count(), 1, 'Allowed shared reading capability is available')
          await dialog.getByRole('button', { name: /^Notificaciones del rol/ }).click()
          assert.equal(await available(dialog, 'notifications.collections').count(), 0, 'Explicitly disabled financial notices stay disabled')
          await checkFocusTrap(page, dialog)
          await page.keyboard.press('Escape')
          await dialog.waitFor({ state: 'hidden' })
          assert(await launcher.evaluate(element => element === document.activeElement), 'Escape restores focus to the preview launcher')
          assert.equal(await page.getByLabel('Nombre del rol', { exact: true }).inputValue(), 'Agente borrador QA')
          assert.equal(await checkbox('planning.ready').isChecked(), false, 'Closing preview preserves the draft')

          await selectModule('notifications')
          await checkbox('notifications.collections').check()
          ;({ dialog } = await openPreview(page))
          await dialog.getByRole('button', { name: /^Notificaciones del rol/ }).click()
          assert.equal(await available(dialog, 'notifications.collections').count(), 1, 'Enabled financial notices appear before saving')
          await page.screenshot({ path: path.join(output, `notifications-${theme}-${width}.png`), fullPage: false })
          await dialog.getByRole('button', { name: 'Volver a configurar', exact: true }).click()

          await selectModule('weekly')
          await checkbox('weekly.view').uncheck()
          ;({ dialog } = await openPreview(page))
          assert.equal(await moduleButton(dialog, 'weekly').count(), 0, 'Revoked modules leave the simulated menu')
          assert.equal(await available(dialog, 'planning.ready').count(), 0)
          await dialog.getByRole('button', { name: 'Cerrar vista previa', exact: true }).click()
          await selectModule('collections')
          await checkbox('records.financial').uncheck()
          ;({ dialog } = await openPreview(page))
          await dialog.getByRole('button', { name: /^Notificaciones del rol/ }).click()
          assert.equal(await available(dialog, 'notifications.collections').count(), 0, 'Removing financial access removes dependent notices')
          await dialog.getByRole('button', { name: 'Volver a configurar', exact: true }).click()
          await page.getByRole('button', { name: 'Descartar cambios', exact: true }).click()

          await page.locator('.role-picker').getByRole('button', { name: 'Rol sin acceso', exact: true }).click()
          ;({ dialog } = await openPreview(page))
          for (const [id] of catalog.MODULES) assert.equal(await moduleButton(dialog, id).count(), 0, `Empty role has no ${id} navigation`)
          assert.equal(await dialog.locator('[data-permission-id][data-enabled="true"]').count(), 0, 'Empty role grants nothing')
          await page.screenshot({ path: path.join(output, `empty-${theme}-${width}.png`), fullPage: false })
          await dialog.getByRole('button', { name: 'Volver a configurar', exact: true }).click()

          await page.locator('.role-picker').getByRole('button', { name: 'Técnico QA', exact: true }).click()
          ;({ dialog } = await openPreview(page))
          const technician = dialog.getByRole('checkbox', { name: /^Empleado habilitado como técnico/ })
          await technician.uncheck()
          assert.equal(await moduleButton(dialog, 'technical').count(), 0, 'Technical portal requires employee enablement')
          await technician.check()
          await moduleButton(dialog, 'technical').click()
          assert.equal(await available(dialog, 'technical.start').count(), 1)
          assert.equal(await available(dialog, 'technical.advance').count(), 1)
          await page.screenshot({ path: path.join(output, `technical-${theme}-${width}.png`), fullPage: false })
          await dialog.getByRole('button', { name: 'Volver a configurar', exact: true }).click()

          await page.locator('.role-picker').getByRole('button', { name: 'Administrador Acceso completo a la plataforma', exact: true }).click()
          ;({ dialog } = await openPreview(page))
          for (const [id] of catalog.MODULES.filter(([id]) => id !== 'technical')) assert.equal(await moduleButton(dialog, id).count(), 1, `Administrator can preview ${id}`)
          await dialog.getByRole('button', { name: /^Notificaciones del rol/ }).click()
          for (const id of catalog.NOTIFICATION_IDS) assert.equal(await available(dialog, id).count(), 1, `Administrator receives ${id}`)
          assert.match(await dialog.locator('.role-preview-notifications').innerText(), /adelant/i, 'Administrator preview includes advance requests')
          await page.screenshot({ path: path.join(output, `admin-${theme}-${width}.png`), fullPage: false })
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Preview does not overflow the viewport')
          assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Preview dialog does not overflow horizontally')
          await dialog.getByRole('button', { name: 'Volver a configurar', exact: true }).click()
          const currentActor = await page.evaluate(() => globalThis.__pignusCurrentUser)
          assert.equal(currentActor.id, actor.id, 'Preview never impersonates another employee')
          assert.equal(currentActor.roleCode, 'administrator', 'Preview never replaces session authority')
          assert.equal(await page.locator('.topbar .page-heading h1').innerText(), 'Configuración')
          assert.equal(JSON.stringify(state), before, 'Synthetic stored state is unchanged')
          assert.deepEqual(writes, [], 'Preview and local draft configuration issue no writes')
          assert.deepEqual(unexpected, [], 'All fixture requests are accounted for')
          assert.deepEqual(errors, [], 'No browser exceptions')
          results.push({ width, theme, writes: writes.length, errors: errors.length, checks: ['unsaved-draft', 'effective-dependencies', 'notification-preferences', 'financial-dependency', 'empty-role', 'technical-enablement', 'administrator-notices', 'focus-trap', 'escape-restoration', 'responsive', 'session-preserved'] })
          console.log(`PASS role preview ${theme}/${width}`)
        } catch (error) {
          await page.screenshot({ path: path.join(output, `failure-${theme}-${width}.png`), fullPage: false }).catch(() => {})
          throw error
        } finally {
          await page.close({ runBeforeUnload: false })
        }
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
