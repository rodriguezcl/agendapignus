// Exercise the real sales form with synthetic lookup/booking responses. No live writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const bundle = buildSync({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import SalesBooking from './features/registration/SalesBooking.jsx';createRoot(document.getElementById('root')).render(<SalesBooking/>);`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.png': 'dataurl' }, logLevel: 'silent' })
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text, css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text
const item = { coordinates: [-31.4167, -64.1833], label: 'San Martín 200, Córdoba', approximate: false, source: 'photon' }
;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage(), errors = [], calls = []
      let release, pending, mode = 'one'
      page.on('pageerror', e => errors.push(e.message))
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/qa.js') return route.fulfill({ contentType: 'text/javascript', body: js })
        if (url.pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/review') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="root"></div><script src="/qa.js"></script>' })
        if (url.pathname === '/api/sales/bookings') {
          if (route.request().method() === 'GET') return route.fulfill({ json: { items: [] } })
          const input = route.request().postDataJSON(); calls.push(input)
          if (input.action === 'locate') {
            if (mode === 'slow') { pending?.(); await new Promise(resolve => { release = resolve }) }
            return route.fulfill({ json: { items: mode === 'many' ? [item, { ...item, label: 'Otra coincidencia', coordinates: [-31.42, -64.19] }] : mode === 'none' ? [] : [item], message: 'No encontramos esa dirección. Marcá el lugar en el mapa.' } })
          }
          return route.fulfill({ json: { slots: [], reason: 'Sin horarios en esta prueba.' } })
        }
        return route.fulfill({ status: 204 })
      })
      await page.goto('https://sales-location.test/review')
      await page.getByLabel('Nombre y apellido').fill('Cliente Prueba')
      await page.getByLabel('Teléfono de contacto').fill('3511234567')
      await page.getByLabel('Tipo de formulario').selectOption('residencial')
      const address = page.getByLabel('Dirección completa'), lat = page.getByLabel('Latitud', { exact: true })
      await address.fill('San Martín 200, Córdoba'); await address.blur()
      await page.getByText('Ubicación encontrada:', { exact: false }).waitFor()
      await page.getByText('Ingresar coordenadas manualmente').click()
      assert.equal(await lat.inputValue(), '-31.4167')
      assert.equal(await page.locator('.leaflet-interactive').count(), 1)
      await page.getByRole('button', { name: 'Consultar horarios' }).click()
      await page.getByText('Sin horarios en esta prueba.').waitFor()
      assert.equal(calls.at(-1).locationConfirmed, true)
      assert.deepEqual(calls.at(-1).coordinates, item.coordinates)
      mode = 'many'; await address.fill('Otra calle 300'); await address.blur()
      await page.getByLabel('Ubicaciones encontradas').selectOption('1')
      assert.equal(await lat.inputValue(), '-31.42')
      mode = 'none'; await address.fill('Dirección desconocida'); await address.blur()
      await page.getByText('No encontramos esa dirección.', { exact: false }).waitFor()
      assert.equal(await lat.inputValue(), '')
      // A delayed search must never overwrite a user-selected point.
      mode = 'slow'; const started = new Promise(resolve => { pending = resolve })
      await address.fill('Búsqueda lenta 400'); await address.blur(); await started
      await page.locator('.sales-location-map').click({ position: { x: 100, y: 100 } })
      const manualLat = await lat.inputValue(); release()
      await page.waitForTimeout(200)
      assert.equal(await lat.inputValue(), manualLat)
      assert.ok(await page.getByText('Ubicación marcada en el mapa.', { exact: true }).isVisible())
      // Editing the address invalidates the old point; a new search supplies a new one.
      mode = 'one'; await address.fill('Nueva dirección 500'); assert.equal(await lat.inputValue(), ''); await address.blur()
      await page.getByText('Ubicación encontrada:', { exact: false }).waitFor()
      await address.fill(''); await address.blur()
      await page.locator('.sales-location-map').click({ position: { x: 120, y: 120 } })
      await page.getByRole('button', { name: 'Consultar horarios' }).click(); await page.getByText('Sin horarios en esta prueba.').waitFor()
      assert.equal(calls.at(-1).address, ''); assert.equal(calls.at(-1).locationSource, 'manual')
      assert.equal(calls.at(-1).locationConfirmed, true)
      assert.ok(await page.locator('.sales-booking').evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'no horizontal overflow')
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ width, automatic: true, choice: true, manual: true, staleResponseIgnored: true }))
      await context.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
