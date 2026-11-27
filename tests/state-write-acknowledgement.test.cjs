const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')

const saved = { ok: true, revision: 3, state: { revision: 3, history: [] } }
const options = { method: 'PATCH', body: JSON.stringify({ revision: 2, operations: [] }) }
const goodResponse = () => Response.json(saved)
const interruptedResponse = () => new Response('{"ok":true,"revision":3,"state":')

test('una desconexión, un error de pasarela o una respuesta cortada reintentan el mismo pedido', async () => {
  const { writeState } = await import('../src/infrastructure/repositories/state-repository.mjs')
  for (const fail of [
    () => { throw new TypeError('Failed to fetch') },
    () => new Response('Server error', { status: 500 }),
    () => new Response('Gateway failed', { status: 502 }),
    () => new Response('Gateway timed out', { status: 504 }),
    interruptedResponse,
    () => Response.json({ ok: true, revision: 3 })
  ]) {
    const bodies = []
    let retries = 0
    const result = await writeState(options, 'No se pudo guardar.', {
      retryDelay: 0,
      onRetry: () => { retries++ },
      fetcher: async (_url, request) => {
        bodies.push(request.body)
        return bodies.length === 1 ? fail() : goodResponse()
      }
    })
    assert.deepEqual(result, saved)
    assert.equal(retries, 1)
    assert.deepEqual(bodies, [options.body, options.body])
  }
})

test('respuestas cortadas o de pasarela dejan el resultado sin confirmar al agotar el reintento', async () => {
  const { writeState } = await import('../src/infrastructure/repositories/state-repository.mjs')
  for (const finalResponse of [interruptedResponse, () => new Response('Unavailable', { status: 503 })]) {
    let calls = 0
    await assert.rejects(writeState(options, 'No se pudo guardar.', {
      retryDelay: 0,
      fetcher: async () => ++calls === 1 ? interruptedResponse() : finalResponse()
    }), { code: 'STATE_WRITE_UNCONFIRMED' })
    assert.equal(calls, 2)
  }
})

test('las respuestas de sesión, permiso, validación y conflicto se respetan al primer intento', async () => {
  const { writeState } = await import('../src/infrastructure/repositories/state-repository.mjs')
  for (const status of [400, 401, 403, 409, 422]) {
    let calls = 0
    await assert.rejects(writeState(options, 'No se pudo guardar.', {
      retryDelay: 0,
      fetcher: async () => {
        calls++
        return Response.json({ error: 'Rechazado' }, { status })
      }
    }), { status, message: 'Rechazado' })
    assert.equal(calls, 1)
  }
})

test('un guardado interrumpido no se reenvía al cambiar de sesión', async t => {
  const { stateRepository } = await import('../src/infrastructure/repositories/state-repository.mjs')
  stateRepository.prime({ revision: 2, sessionUser: { id: 'operador' }, history: [] })
  t.after(() => stateRepository.prime(null))
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body))
    stateRepository.prime(null)
    stateRepository.prime({ revision: 2, sessionUser: { id: 'otro' }, history: [] })
    throw new TypeError('Connection closed')
  })
  await assert.rejects(stateRepository.commit([], 2), /sesión cambió/)
  assert.deepEqual(requests, [{ revision: 2, operations: [], expectedActorId: 'operador', responseMode: 'delta-v1' }])
})

test('un delta válido confirma el guardado; una respuesta que no corresponde a la base queda sin confirmar', async t => {
  const { stateRepository } = await import('../src/infrastructure/repositories/state-repository.mjs')
  const base = { revision: 2, sessionUser: { id: 'operador' }, history: [] }
  stateRepository.prime(base)
  t.after(() => stateRepository.prime(null))
  let baseRevision = 2
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ok: true, revision: 3, delta: { baseRevision, revision: 3, changes: {} }
  }))
  assert.deepEqual((await stateRepository.commit([], 2)).state, { ...base, revision: 3 })
  baseRevision = 1
  await assert.rejects(stateRepository.commit([], 3), { code: 'STATE_WRITE_UNCONFIRMED' })
})

test('al perderse la conexión HTTP después de recibir el alta, el servidor recibe el mismo lote en el reintento', async t => {
  const { writeState } = await import('../src/infrastructure/repositories/state-repository.mjs')
  const received = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    received.push(Buffer.concat(chunks).toString())
    if (received.length === 1) {
      res.destroy()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(saved))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const newService = { method: 'PATCH', body: JSON.stringify({
    revision: 2,
    expectedActorId: 'operador',
    operations: [{ path: ['history', { key: 'id', id: 'servicio-1' }], existed: false, exists: true, after: { id: 'servicio-1' } }]
  }) }
  const result = await writeState(newService, 'No se pudo guardar.', {
    fetcher: (path, request) => fetch(new URL(path, origin), request),
    retryDelay: 0
  })
  assert.deepEqual(result, saved)
  assert.deepEqual(received, [newService.body, newService.body])
})
