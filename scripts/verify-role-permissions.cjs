// Run the real application against synthetic state. Every request is intercepted.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const catalog = require('../api/_lib/permission-catalog.cjs')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/role-permissions')
fs.mkdirSync(output, { recursive: true })
const themeSource = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const data = themeSource.slice(themeSource.indexOf('const themeReviewUser ='), themeSource.indexOf('const themeReviewNavigation ='))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const source = `
${fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')}
import {createRoot} from 'react-dom/client';
${cssImports}
${data}
const admin = {...themeReviewRoles[0],permissions:{__catalogV2:true}};
window.__user={...themeReviewUser,roleId:admin.id,permissions:admin.permissions};
window.__seed={revision:1,roles:[admin,{id:'qa-role',code:'qa-role',name:'Prueba permisos',permissions:{__catalogV2:true,'weekly.view':true,'records.read':true,'planning.ready':true}}],employees:[{...window.__user,status:'Activo'}],services:themeReviewServices,customers:[],vehicles:[],history:[],agenda:{date:'2026-10-20',teams:[],weekly:{}}};
createRoot(document.getElementById('root')).render(<App/>);
`
const built = buildSync({ stdin: { contents: source, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const html = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const results = []
  try {
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const errors = [], mutations = []
      let failSave = false
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(theme => localStorage.setItem('pignus-theme-account:admin-review', theme), theme)
      await page.clock.setFixedTime(new Date('2026-10-20T12:00:00-03:00'))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== 'role-permissions.test') return route.abort()
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/api/auth/activity') return route.fulfill({ json: { ok: true } })
        if (url.pathname === '/api/state' && request.method() === 'PATCH') {
          const payload = request.postDataJSON()
          mutations.push(payload)
          if (failSave) return route.fulfill({ status: 409, json: { code: 'RECORD_WRITE_CONFLICT', error: 'Otra persona modificó este rol.' } })
          assert(payload.operations.every(operation => operation.path[0] === 'roles'), 'Role changes do not write unrelated state')
          const state = await page.evaluate(payload => {
            for (const operation of payload.operations) {
              const index = window.__seed.roles.findIndex(role => String(role.id) === String(operation.path[1].id))
              if (index < 0) window.__seed.roles.push(operation.after)
              else window.__seed.roles[index] = operation.after
            }
            window.__seed.revision++
            return window.__seed
          }, payload)
          return route.fulfill({ json: { revision: state.revision, state } })
        }
        if (request.method() !== 'GET') { mutations.push({ unexpected: url.pathname }); return route.fulfill({ status: 403, json: { error: 'Unexpected mutation' } }) }
        if (url.pathname.startsWith('/api/')) {
          const { state, user } = await page.evaluate(() => ({ state: window.__seed, user: window.__user }))
          if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user, state } })
          if (url.pathname === '/api/state') return route.fulfill({ json: state })
          if (url.pathname.includes('revision')) return route.fulfill({ json: { revision: state.revision } })
          return route.fulfill({ json: { holidays: [], days: [], requests: [], attachments: [], records: [] } })
        }
        return route.abort()
      })
      await page.goto('http://role-permissions.test/')
      await page.locator('.topbar').waitFor()
      if (width < 760) await page.locator('.sidebar-toggle').click()
      await page.locator('.sidebar nav').getByRole('button', { name: 'Configuración', exact: true }).click()
      await page.locator('.role-picker').getByRole('button', { name: 'Prueba permisos' }).click()
      const checkbox = id => page.locator('.role-capability').filter({ has: page.locator(`[id="role-permission-${id}"]`) }).getByRole('checkbox')
      await checkbox('weekly.view').uncheck()
      assert.equal(await checkbox('planning.ready').isDisabled(), true)
      assert.equal(await checkbox('planning.ready').isChecked(), false)
      assert.equal(mutations.length, 0, 'Editing remains a local draft')
      await checkbox('weekly.view').check()
      assert.equal(await checkbox('records.read').isChecked(), false, 'Re-enabling a prerequisite does not resurrect dependants')
      await checkbox('records.read').check()
      assert.equal(await checkbox('planning.ready').isChecked(), false)
      assert.equal(await checkbox('planning.ready').isDisabled(), false)
      await page.getByText('Alcance de consultas y acciones', { exact: true }).click()
      await page.getByLabel('Servicios que puede consultar', { exact: true }).selectOption('assigned')
      await page.getByLabel('Servicios sobre los que puede actuar', { exact: true }).selectOption('assigned')
      await page.getByRole('button', { name: 'Guardar rol', exact: true }).click()
      await page.getByText('El rol y sus permisos se guardaron correctamente.', { exact: true }).waitFor()
      assert.equal(mutations.length, 1)
      assert.equal(mutations[0].operations[0].after.permissions['planning.ready'], false)
      assert.equal(mutations[0].operations[0].after.permissions['scope.services.read.assigned'], true)
      assert.equal(catalog.isGranular(mutations[0].operations[0].after), true)
      // A rejected stale write keeps the user's draft available.
      failSave = true
      await page.getByLabel('Nombre del rol', { exact: true }).fill('Borrador conservado')
      await page.getByRole('button', { name: 'Guardar rol', exact: true }).click()
      await page.locator('.role-permission-editor [role="alert"]').waitFor()
      assert.equal(await page.getByLabel('Nombre del rol', { exact: true }).inputValue(), 'Borrador conservado')
      await page.getByRole('button', { name: 'Descartar cambios', exact: true }).click()
      await page.locator('.role-module-picker select').selectOption('technical')
      assert.equal(await checkbox('technical.start').isDisabled(), true)
      await checkbox('technical.view').check()
      await checkbox('technical.start').check()
      await checkbox('technical.advance').check()
      await checkbox('technical.complete').check()
      await checkbox('technical.start').uncheck()
      assert.equal(await checkbox('technical.advance').isChecked(), false)
      assert.equal(await checkbox('technical.advance').isDisabled(), true)
      assert.equal(await checkbox('technical.complete').isChecked(), true)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow')
      await page.screenshot({ path: path.join(output, `roles-${theme}-${width}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Descartar cambios', exact: true }).click()
      await page.locator('.role-picker').getByRole('button', { name: 'Administrador Acceso completo a la plataforma' }).click()
      assert.equal(await checkbox('technical.view').isDisabled(), true, 'The administrative role remains protected')
      assert.equal(await checkbox('technical.view').isChecked(), true)
      failSave = false
      await page.getByRole('button', { name: 'Nuevo rol', exact: true }).click()
      await page.getByLabel('Nombre del rol', { exact: true }).fill('Consulta semanal QA')
      await page.locator('.role-module-picker select').selectOption('weekly')
      await checkbox('weekly.view').check()
      await page.getByRole('button', { name: 'Guardar rol', exact: true }).click()
      await page.waitForFunction(() => window.__seed.roles.some(role => role.name === 'Consulta semanal QA'))
      assert.equal(mutations.length, 3)
      assert.equal(mutations[2].operations[0].existed, false)
      assert.equal(mutations[2].operations[0].after.permissions['weekly.view'], true)
      assert.equal(mutations[2].operations[0].after.permissions['planning.ready'], false)
      assert.deepEqual(errors, [])
      results.push({ width, theme, mutations: mutations.length, errors, checks: ['dependencies', 'atomic-save', 'scopes', 'stale-draft', 'independent-completion', 'responsive', 'protected-admin', 'create-with-minimal-rights'] })
      console.log(`PASS roles ${theme}/${width}`)
      await page.close({ runBeforeUnload: false })
    }
  } finally { await browser.close() }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
