const test = require('node:test')
const assert = require('node:assert/strict')

test('el límite JSON cubre también una respuesta cuyo cuerpo nunca termina', async () => {
  const { requestJson } = await import('../src/infrastructure/http/json-request.mjs')
  let aborted = false
  const fetcher = async (url, options) => ({
    ok: true,
    status: 200,
    json: () => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
  })
  await assert.rejects(requestJson('/api/state', {}, 'No se pudo cargar.', fetcher, 5), /demoró demasiado/)
  assert.equal(aborted, true)
})
