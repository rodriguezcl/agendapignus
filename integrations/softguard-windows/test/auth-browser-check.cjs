// All requests intercepted. No real credentials or accounts are used.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { ensureSession } = require('../auth.cjs')
async function main() {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER || 'chrome', headless: true })
  try {
    for (const site of ['softguard','agentec']) {
      const context = await browser.newContext()
      let reads = 0, submissions = 0
      const origin = site === 'softguard' ? 'https://softguard.pignusarg.com' : 'https://agenda.pignusarg.com'
      await context.route('**/*', route => {
        if (new URL(route.request().url()).pathname === '/login') { submissions++; return route.fulfill({ contentType: 'text/html', body: '<button>Ready</button>' }) }
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: site === 'softguard'
          ? '<form action="/login" method="post"><input id="field1" name="username"><input id="field2" name="password" type="password"><button id="submitBtn">Enviar</button></form>'
          : '<form action="/login" method="post"><input id="login-email" name="email"><input id="login-password" name="password" type="password"><button>Iniciar sesión</button></form>' })
      })
      const page = await context.newPage()
      const provider = async () => { reads++; return { username: 'synthetic', password: 'synthetic-only' } }
      await page.goto(origin)
      const ready = page.getByRole('button', { name: 'Ready' })
      await ensureSession(page, site, ready, provider)
      await ensureSession(page, site, ready, provider)
      assert.equal(reads, 1); assert.equal(submissions, 1)
      // Simulate an expired session: login must be performed again.
      await page.goto(origin)
      await ensureSession(page, site, ready, provider)
      assert.equal(reads, 2); assert.equal(submissions, 2)
      await page.goto('https://unexpected.test/')
      await assert.rejects(ensureSession(page, site, ready, provider), { code: 'LOGIN_ORIGIN' })
      assert.equal(reads, 2, 'No secrets read for another origin')
      await context.close()
    }
    console.log('PASS: reingreso en ambos sitios, sesion vigente y rechazo de origen inesperado (simulado).')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
