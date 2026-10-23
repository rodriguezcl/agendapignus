'use strict'
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
const { fail } = require('./lib.cjs')
const execute = promisify(execFile)
async function credentials(site) {
  if (!['softguard', 'agentec', 'connector'].includes(site)) throw fail('CREDENTIALS_UNAVAILABLE', 'Sitio no permitido.')
  try {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Credenciales.ps1'), '-Accion', 'Leer', '-Sitio', site], { windowsHide: true, timeout: 15000, maxBuffer: 16384 })
    const value = JSON.parse(stdout.replace(/^\uFEFF/, ''))
    if (!value.username || !value.password) throw Error('empty')
    return value
  } catch { throw fail('CREDENTIALS_UNAVAILABLE', 'Configurá los accesos cifrados en esta PC con el usuario Windows de la tarea.') }
}
async function ensureSession(page, site, ready, readCredentials = credentials) {
  const expectedOrigin = site === 'softguard' ? 'https://softguard.pignusarg.com' : 'https://agenda.pignusarg.com'
  const assertOrigin = () => {
    if (new URL(page.url()).origin !== expectedOrigin) throw fail('LOGIN_ORIGIN', 'El acceso redirigió a un sitio inesperado. No se enviaron credenciales.')
  }
  assertOrigin()
  const login = page.locator(site === 'softguard' ? '#field2' : '#login-password')
  try { await ready.or(login).first().waitFor({ state: 'visible', timeout: 30000 }) }
  catch { throw fail('ACCESS_UNAVAILABLE', 'El sitio no mostró el acceso ni la pantalla esperada.') }
  if (await ready.isVisible()) return
  assertOrigin()
  const value = await readCredentials(site)
  try {
    await page.locator(site === 'softguard' ? '#field1' : '#login-email').fill(value.username)
    await login.fill(value.password)
    assertOrigin()
    if (site === 'softguard') await page.locator('#submitBtn').click()
    else await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
    await ready.waitFor({ state: 'visible', timeout: 30000 })
  } catch { throw fail('AUTH_REJECTED', 'No se pudo recuperar el acceso. Revisá las credenciales o los permisos; no se repetirán intentos de contraseña en esta ejecución.') }
  finally { value.password = ''; value.username = '' }
}
module.exports = { ensureSession, credentials }
