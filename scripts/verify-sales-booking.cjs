// Synthetic browser fixture. All HTTP requests intercepted; no real reservations.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const out = path.resolve('tmp/visual-qa/sales-booking'); fs.mkdirSync(out, { recursive: true })
const styles = [...fs.readFileSync('src/main.jsx', 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g), ...fs.readFileSync('src/App.jsx', 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => `import './src/${m[1].replace(/^\.\//, '')}';`).join('\n')
buildSync({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import Sales from './src/features/registration/SalesBooking.jsx';import{PermissionsProvider}from'./src/presentation/contexts/permissions-context.jsx';${styles}
const theme=location.search.includes('dark')?'dark':'light';document.body.classList.toggle('dark',theme==='dark');createRoot(document.getElementById('root')).render(<PermissionsProvider user={{id:'seller',roleCode:'custom',permissions:{__catalogV2:true,'sales.view':true,'sales.reserve':true}}}><div className="app-shell" data-theme={theme}><main style={{margin:0,padding:16}}><Sales/></main></div></PermissionsProvider>);` }, outfile: path.join(out, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', external: ['/pignus-owl-white.svg', '/logo-pignus.png'], loader: { '.png': 'dataurl' }, logLevel: 'silent' })
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const [width, theme] of [[390, 'light'], [1280, 'light'], [390, 'dark']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [], calls = []
      page.on('pageerror', e => errors.push(e.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname !== 'sales.test') return route.abort()
        if (url.pathname.startsWith('/fixture.')) return route.fulfill({ path: path.join(out, url.pathname.slice(1)), contentType: url.pathname.endsWith('css') ? 'text/css' : 'application/javascript' })
        if (url.pathname === '/api/sales/bookings') {
          if (route.request().method() === 'GET') return route.fulfill({ json: { items: [] } })
          const input = route.request().postDataJSON(); calls.push(input)
          if (input.action === 'slots') return route.fulfill({ json: { slots: [{ teamId: 'team', teamLabel: 'Equipo 1', members: ['Técnico Prueba'], time: '10:30', end: '13:00', beforeMinutes: 30, afterMinutes: null, noFollowing: true, reviewLocation: false }], reason: '' } })
          return route.fulfill({ json: { reservation: { id: 'fixture', client: input.client, address: input.address, date: input.date, time: input.time, team: 'Equipo 1', status: 'Pendiente', awaitingConfirmation: true, form: 'Pendiente', link: '/alta#fixture-token' } } })
        }
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>' })
      })
      await page.goto(`https://sales.test/?${theme}`)
      await page.getByLabel('Nombre y apellido').fill('Cliente de prueba')
      await page.getByLabel('Teléfono de contacto').fill('3511234567')
      await page.getByLabel('Dirección completa').fill('Calle Prueba 123, Córdoba')
      await page.getByLabel('Latitud', { exact: true }).fill('-31.4167')
      await page.getByLabel('Longitud', { exact: true }).fill('-64.1833')
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Consultar horarios' }).click()
      await page.getByLabel('Horarios compatibles según estimación').selectOption('team|10:30')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      await page.screenshot({ path: path.join(out, `${width}-${theme}.png`), fullPage: true })
      // Changing the address must invalidate both point confirmation and slots.
      await page.getByLabel('Dirección completa').fill('Otra calle 456, Córdoba')
      assert.equal(await page.getByRole('checkbox').isChecked(), false)
      assert.equal(await page.getByLabel('Horarios compatibles según estimación').count(), 0)
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Consultar horarios' }).click()
      await page.getByLabel('Horarios compatibles según estimación').selectOption('team|10:30')
      await page.getByRole('button', { name: 'Reservar a confirmar y generar enlace' }).click()
      await page.getByRole('heading', { name: 'Formulario de Cliente de prueba' }).waitFor()
      assert.equal(calls.filter(c => c.action === 'reserve').length, 1)
      assert.equal(calls.at(-1).locationConfirmed, true)
      assert.deepEqual(calls.at(-1).coordinates, [-31.4167, -64.1833])
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(out, `${width}-${theme}-saved.png`), fullPage: true })
      await page.close()
    }
    console.log('OK: reservas en móvil/escritorio, claro/oscuro, coordenadas, invalidación de horarios y enlace único; sin desbordes.')
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
