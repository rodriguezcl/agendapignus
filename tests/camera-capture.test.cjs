const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('servidor local permite solicitar cámara al servir la aplicación', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.cjs'), 'utf8')
  const start = source.indexOf('function setBrowserSecurityHeaders(res) {')
  const end = source.indexOf('\nfunction serveApplication', start)
  const headers = {}
  vm.runInNewContext(source.slice(start, end) + '\nsetBrowserSecurityHeaders(res)', {
    secureCookies: false, res: { setHeader(name, value) { headers[name] = value } }
  })
  assert.equal(headers['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()')
})

test('Vercel permite cámara propia sin habilitar micrófono ni geolocalización', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'))
  const policy = config.headers.find(rule => rule.source === '/(.*)').headers.find(header => header.key === 'Permissions-Policy').value
  assert.equal(policy, 'camera=(self), microphone=(), geolocation=()')
})

test('errores de cámara explican cómo recuperarse sin ofrecer galería', async t => {
  const { captureCameraPhoto } = await import('../src/infrastructure/media/camera-capture.mjs')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  t.after(() => original ? Object.defineProperty(globalThis, 'navigator', original) : delete globalThis.navigator)
  for (const [name, message] of [['NotAllowedError', /permisos de este sitio/], ['PermissionDeniedError', /permisos de este sitio/], ['NotFoundError', /No se encontró una cámara/], ['NotReadableError', /Cerrá otras aplicaciones/]]) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { async getUserMedia(options) {
      assert.deepEqual(options, { video: { facingMode: { ideal: 'environment' } }, audio: false })
      throw Object.assign(new Error('Permission denied'), { name })
    } } } })
    await assert.rejects(captureCameraPhoto(), message)
  }
})
