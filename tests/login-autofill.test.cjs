const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('lee las credenciales después de que Face ID termina de completar el formulario', async () => {
  const { LOGIN_AUTOFILL_SETTLE_MS, readSettledLoginCredentials } = await import('../src/features/auth/application/login-autofill.mjs')
  const form = { elements: { email: { value: '' }, password: { value: '' } } }
  let waited
  const credentials = await readSettledLoginCredentials(form, async milliseconds => {
    waited = milliseconds
    form.elements.email.value = ' usuario@pignus.test '
    form.elements.password.value = 'ClaveCorrecta123'
  })
  assert.equal(waited, LOGIN_AUTOFILL_SETTLE_MS)
  assert.deepEqual(credentials, { email: 'usuario@pignus.test', password: 'ClaveCorrecta123' })
})

test('el login es compatible con autocompletado nativo y evita solicitudes duplicadas', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')
  const login = source.slice(source.indexOf('function Login('), source.indexOf('export default function App()'))
  assert.match(login, /submissionInProgressRef\.current/)
  assert.match(login, /readSettledLoginCredentials\(form\)/)
  assert.match(login, /fetchAuthWithRetry\('\/api\/auth\/login'/)
  assert.match(login, /name="email"[\s\S]*?defaultValue=""[\s\S]*?name="password"[\s\S]*?defaultValue=""/)
  assert.doesNotMatch(login, /value=\{password\}/)
})
