const test = require('node:test')
const assert = require('node:assert/strict')
const { endpointFor, verifyEndpoint, main } = require('../scripts/configure-ticket-mail-schedule.cjs')

test('la programación sólo acepta el endpoint HTTPS sin credenciales ni redirecciones', async () => {
  assert.equal(endpointFor('https://agenda.pignusarg.com'), 'https://agenda.pignusarg.com/api/tickets/mail/process')
  for (const value of ['http://agenda.pignusarg.com', 'https://user:secret@agenda.pignusarg.com', 'https://agenda.pignusarg.com?secret=x', 'https://agenda.pignusarg.com/otro', 'https://agenda.pignusarg.com:8443', undefined]) {
    assert.throws(() => endpointFor(value))
  }
  const calls = []
  await verifyEndpoint('https://agenda.pignusarg.com/api/tickets/mail/process', 'credencial-ficticia', async (url, options) => {
    calls.push({ url, options })
    return { status: 405, json: async () => ({ error: 'Método no permitido.' }) }
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer credencial-ficticia')
  assert.equal(calls[0].options.body, undefined)
})

test('la habilitación rechaza despliegues sin autenticar o que no sean el procesador', async () => {
  for (const status of [200, 301, 401, 404, 500]) await assert.rejects(verifyEndpoint('https://example.com', 'secret', async () => ({ status })))
  await assert.rejects(verifyEndpoint('https://example.com', 'secret', async () => ({ status: 405, json: async () => ({ error: 'Otra aplicación' }) })))
})

test('las operaciones remotas de programación exigen una acción y confirmación explícitas', async () => {
  for (const argv of [[], ['--prepare'], ['--enable'], ['--disable'], ['--status', '--enable', '--confirm']]) await assert.rejects(main(argv, {}))
})
