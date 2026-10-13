/* Real browser API smoke test; isolated component, no application/network data. */
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const bundle = buildSync({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import FullscreenToggle from './components/ui/FullscreenToggle.jsx';
      const root = createRoot(document.getElementById('root'));
      window.unmountFullscreen = () => root.unmount(); root.render(<FullscreenToggle/>);`,
    loader: 'jsx', resolveDir: path.resolve(__dirname, '../src')
  },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent'
}).outputFiles[0].text

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.abort())
    await page.setContent('<div id="root"></div>')
    await page.evaluate(() => {
      const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
      window.fullscreenListeners = new Set()
      document.addEventListener = (type, listener, options) => {
        if (type === 'fullscreenchange') window.fullscreenListeners.add(listener)
        return add(type, listener, options)
      }
      document.removeEventListener = (type, listener, options) => {
        if (type === 'fullscreenchange') window.fullscreenListeners.delete(listener)
        return remove(type, listener, options)
      }
    })
    await page.addScriptTag({ content: bundle })
    const enter = () => page.getByRole('button', { name: 'Entrar en pantalla completa' })
    const leave = () => page.getByRole('button', { name: 'Salir de pantalla completa' })
    await enter().click()
    await leave().waitFor()
    assert(await page.evaluate(() => document.fullscreenElement === document.documentElement))
    assert.equal(await leave().getAttribute('aria-pressed'), 'true')
    await leave().click()
    await enter().waitFor()
    assert.equal(await page.evaluate(() => document.fullscreenElement), null)

    // Exiting outside the component follows the same fullscreenchange path as Esc.
    await enter().click()
    await leave().waitFor()
    await page.evaluate(() => document.exitFullscreen())
    await enter().waitFor()
    assert.equal(await enter().getAttribute('aria-pressed'), 'false')

    await page.evaluate(() => { document.documentElement.requestFullscreen = () => Promise.reject(new Error('Permission denied')) })
    await enter().click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(), /El navegador no permitió/)
    assert.equal(await enter().isEnabled(), true)
    assert.equal(await page.evaluate(() => window.fullscreenListeners.size), 1)
    await page.evaluate(() => window.unmountFullscreen())
    assert.equal(await page.evaluate(() => window.fullscreenListeners.size), 0)
    console.log('Fullscreen enters/exits, follows external exit, reports rejection and cleans listener.')

    const unsupported = await browser.newPage()
    await unsupported.setContent('<div id="root"></div>')
    await unsupported.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }))
    await unsupported.addScriptTag({ content: bundle })
    await unsupported.waitForFunction(() => typeof window.unmountFullscreen === 'function')
    assert.equal(await unsupported.getByRole('button').count(), 0)
    console.log('Unsupported browser hides fullscreen action.')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
