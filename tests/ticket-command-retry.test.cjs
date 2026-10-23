const test = require('node:test')
const assert = require('node:assert/strict')

test('reintentar un aporte tras perder la respuesta conserva el comando y la versión original', async () => {
  const { prepareTicketCommand } = await import('../src/features/tickets/ticket-command-retry.mjs')
  let version = 1, reads = 0, identifiers = 0
  const intent = { draft: { customerId: 'account-1', serviceId: 'visit-1', description: 'También se corta de noche' }, decision: 'ticket-1', attachments: [], duplicateToken: 'review-1' }
  const prepare = async () => { reads++; return { action: 'contribute', id: 'ticket-1', version, note: intent.draft.description } }
  const createId = () => `command-${++identifiers}`
  const first = await prepareTicketCommand(null, intent, prepare, createId)
  const saved = new Map()
  let additions = 0
  const send = command => { if (!saved.has(command.id)) { saved.set(command.id, command.payload); additions++; version++ } }
  send(first) // The server saved the message, but the response was lost.
  const retry = await prepareTicketCommand(first, structuredClone(intent), prepare, createId)
  send(retry)
  assert.strictEqual(retry, first)
  assert.equal(retry.payload.version, 1)
  assert.equal(reads, 1)
  assert.equal(identifiers, 1)
  assert.equal(additions, 1)
})

test('cambiar el motivo, caso, adjuntos o contexto prepara una solicitud nueva', async () => {
  const { prepareTicketCommand } = await import('../src/features/tickets/ticket-command-retry.mjs')
  const base = { draft: { customerId: 'a', serviceId: 'visit-1', description: 'Detalle' }, decision: 'ticket-1', attachments: [], duplicateToken: 'review-1' }
  let identifiers = 0
  const createId = () => `command-${++identifiers}`
  const first = await prepareTicketCommand(null, base, async () => ({ version: 1 }), createId)
  for (const intent of [
    { ...base, draft: { ...base.draft, description: 'Otro detalle' } },
    { ...base, decision: 'ticket-2' },
    { ...base, attachments: [{ data: 'image-data' }] },
    { ...base, draft: { ...base.draft, customerId: 'b' } },
    { ...base, draft: { ...base.draft, serviceId: 'visit-2' } },
    { ...base, duplicateToken: 'review-2' }
  ]) {
    const next = await prepareTicketCommand(first, intent, async () => ({ version: 2 }), createId)
    assert.notEqual(next.id, first.id)
    assert.equal(next.payload.version, 2)
  }
})

test('invalidar el comando después de un conflicto vuelve a consultar la versión', async () => {
  const { prepareTicketCommand } = await import('../src/features/tickets/ticket-command-retry.mjs')
  let reads = 0, identifiers = 0
  const prepare = async () => ({ version: ++reads })
  const createId = () => `command-${++identifiers}`
  const first = await prepareTicketCommand(null, { decision: 'ticket-1' }, prepare, createId)
  const afterConflict = await prepareTicketCommand(null, { decision: 'ticket-1' }, prepare, createId)
  assert.notEqual(afterConflict.id, first.id)
  assert.equal(afterConflict.payload.version, 2)
})
