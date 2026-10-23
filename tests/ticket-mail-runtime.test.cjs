const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildMailSanitizer } = require('../scripts/build-mail-sanitizer.cjs')

const root = path.resolve(__dirname, '..')
const runtime = path.join(root, 'api', '_lib', 'mail-sanitizer-runtime.cjs')

test('correo carga y prepara firmas en el runtime CommonJS de Vercel sin require(ESM)', () => {
  buildMailSanitizer()
  const child = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', `
    const assert = require('node:assert/strict')
    const { workerAuthorized } = require('./api/_lib/ticket-mail-service.cjs')
    const { normalizeSignature } = require('./api/_lib/ticket-mail-signature.cjs')
    const { prepareTicketReply } = require('./api/_lib/ticket-mail.cjs')
    require('./api/_lib/ticket-mail-worker.cjs')
    assert.equal(workerAuthorized({ headers: {} }, {}), false)
    const signature = normalizeSignature({ enabled: true, html: '<p><strong>Soporte</strong><script>evil()</script><img src="https://example.com/logo.png" onerror="evil()"></p>' })
    assert.ok(signature.html.includes('<strong>Soporte</strong>'))
    assert.doesNotMatch(signature.html, /script|onerror|evil/)
    const reply = prepareTicketReply({ id: 'runtime-test', number: '1000001', title: 'Consulta', requesterEmail: 'customer@example.com' }, { text: 'Respuesta' }, { id: 'operator', name: 'Operador' }, { enabled: true, mode: 'live', mailboxKey: 'runtime-test', address: 'support@example.com', signature })
    assert.match(reply.outbox.payload.text, /Respuesta[\\s\\S]*Soporte/)
    assert.ok(reply.outbox.payload.html.includes('<strong>Soporte</strong>'))
    assert.equal(reply.entry.text, reply.outbox.payload.text)
  `], { cwd: root, env: { ...process.env, VERCEL: '1' }, encoding: 'utf8', timeout: 30000 })
  assert.equal(child.status, 0, child.stderr || child.stdout)
})

test('producción falla si falta el bundle y no recurre silenciosamente a require(ESM)', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'agentec-mail-runtime-'))
  try {
    const file = path.join(fixture, 'mail-sanitizer-runtime.cjs')
    fs.copyFileSync(runtime, file)
    const child = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', `
      const assert = require('node:assert/strict')
      assert.throws(() => require(process.argv[1]), error => error.code === 'MODULE_NOT_FOUND' && error.message.includes('_vendor/sanitize-html.cjs'))
    `, file], { env: { ...process.env, VERCEL: '1' }, encoding: 'utf8', timeout: 10000 })
    assert.equal(child.status, 0, child.stderr || child.stdout)
  } finally {
    fs.unlinkSync(path.join(fixture, 'mail-sanitizer-runtime.cjs'))
    fs.rmdirSync(fixture)
  }
})
