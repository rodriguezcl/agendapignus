const test = require('node:test')
const assert = require('node:assert/strict')

test('un reintento después de una respuesta incierta envía el mismo comando y conserva el borrador', async () => {
  const { cctvRepository, createCctvCommandSession } = await import('../src/infrastructure/repositories/cctv-repository.mjs')
  let nextId = 0
  const session = createCctvCommandSession(() => `command-${++nextId}`)
  const input = { customerId: 'account', expectedVersion: 2, action: 'addNews', payload: { title: 'Informe', body: 'Observación original' } }
  const received = [], oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    received.push({ url, method: options.method, body: JSON.parse(options.body) })
    if (received.length === 1) throw new Error('Conexión interrumpida')
    return { ok: true, json: async () => ({ customer: { customerId: 'account' }, dossier: { version: 3 } }) }
  }
  try {
    await assert.rejects(cctvRepository.save(session.prepare(input)), /Conexión interrumpida/)
    const command = session.prepare(structuredClone(input))
    const saved = await cctvRepository.save(command)
    session.accepted(command)
    assert.deepEqual(received[0], received[1])
    assert.equal(saved.dossier.version, 3)
    assert.equal(input.payload.body, 'Observación original')
    assert.notEqual(session.prepare({ ...input, expectedVersion: 3 }).commandId, command.commandId)
  } finally { globalThis.fetch = oldFetch }
})

test('un conflicto conserva contenido y requiere un comando nuevo después de revisar la versión actual', async () => {
  const { createCctvCommandSession } = await import('../src/infrastructure/repositories/cctv-repository.mjs')
  let id = 0
  const session = createCctvCommandSession(() => String(++id))
  const draft = { customerId: 'account', expectedVersion: 1, action: 'saveMaintenance', payload: { observation: 'Podar árbol norte', nextDate: '2026-12-10' } }
  const original = session.prepare(draft)
  assert.equal(session.prepare(structuredClone(draft)).commandId, original.commandId)
  const reviewed = session.prepare({ ...draft, expectedVersion: 2 })
  assert.notEqual(reviewed.commandId, original.commandId)
  assert.deepEqual(reviewed.payload, original.payload)
  draft.payload.observation = 'Texto corregido'
  assert.equal(original.payload.observation, 'Podar árbol norte')
  assert.notEqual(session.prepare(draft).commandId, original.commandId)
})

test('adjuntos validan formato y tamaño antes del envío y codifican el contenido original', async () => {
  const { encodeCctvFile, CCTV_FILE_LIMIT, cctvAttachmentUrl } = await import('../src/infrastructure/repositories/cctv-repository.mjs')
  const bytes = Buffer.from('%PDF-1.7\nInforme de CCTV')
  const file = { name: 'informe.pdf', type: 'application/pdf', size: bytes.length, arrayBuffer: async () => bytes }
  const encoded = await encodeCctvFile(file)
  assert.deepEqual(encoded, { fileName: 'informe.pdf', mimeType: 'application/pdf', data: bytes.toString('base64') })
  await assert.rejects(encodeCctvFile({ ...file, size: CCTV_FILE_LIMIT + 1 }), /3 MB/)
  await assert.rejects(encodeCctvFile({ ...file, size: 0 }), /contenido/)
  await assert.rejects(encodeCctvFile({ ...file, name: 'imagen.png', type: 'image/png' }), /PDF/)
  assert.equal((await encodeCctvFile({ ...file, name: 'imagen.png', type: 'image/png' }, { allowImages: true })).mimeType, 'image/png')
  assert.equal(cctvAttachmentUrl('cuenta con espacio', 'adjunto&1'), '/api/cctv/attachments?customerId=cuenta+con+espacio&attachmentId=adjunto%261')
})

test('el límite conjunto evita enviar un archivo y esquema que el servidor no puede aceptar', async () => {
  const { cctvRepository } = await import('../src/infrastructure/repositories/cctv-repository.mjs')
  assert.throws(() => cctvRepository.save({ payload: { body: 'á'.repeat(2_200_000) } }), /demasiado grandes/)
})
