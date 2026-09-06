const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = relativePath => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')

test('la sesión vence tras 30 minutos de inactividad real en ambos servidores', () => {
  for (const source of [read('api/index.js'), read('server.cjs')]) {
    assert.match(source, /SESSION_IDLE_TIMEOUT_MS = 30 \* 60 \* 1000/)
    assert.match(source, /Max-Age=\$\{SESSION_IDLE_TIMEOUT_MS \/ 1000\}/)
  }
})

test('la actividad humana renueva la sesión y las comprobaciones automáticas no lo hacen', () => {
  const hook = read('src/features/auth/application/useSessionLifecycle.js')
  const repository = read('src/infrastructure/repositories/session-repository.mjs')
  assert.match(hook, /ACTIVITY_EVENTS = \['pointerdown', 'keydown', 'touchstart', 'scroll'\]/)
  assert.match(hook, /sessionRepository\.touch\(\)/)
  assert.match(hook, /sessionRepository\.status\(\)/)
  assert.match(hook, /Date\.now\(\) - lastActivityAt >= SESSION_IDLE_TIMEOUT_MS/)
  assert.match(repository, /\/api\/auth\/session-status/)
  assert.match(repository, /\/api\/auth\/activity/)
})

test('la verificación liviana expulsa la sesión desplazada sin descargar el estado', () => {
  const app = read('src/App.jsx')
  const hook = read('src/features/auth/application/useSessionLifecycle.js')
  assert.match(app, /useSessionLifecycle\(\{/)
  assert.match(hook, /SESSION_STATUS_INTERVAL_MS = 5 \* 1000/)
  assert.match(hook, /error\.status === 401/)
  assert.doesNotMatch(read('src/infrastructure/repositories/session-repository.mjs'), /\/api\/state/)
})
