const test = require('node:test')
const assert = require('node:assert/strict')
const validate = async (changes = {}) => {
  const { ticketCreateErrors } = await import('../src/features/tickets/ticket-create-validation.mjs')
  return ticketCreateErrors({ draft: { categoryId: 'alarm', customerId: 'c1', description: 'Revisar alarma' }, needsCustomer: true, ...changes })
}
test('solicitud interna de Alarmas sigue requiriendo una cuenta seleccionada, no texto de búsqueda', async () => {
  const errors = await validate({ draft: { scope: 'internal', categoryId: 'alarm', customerId: '', description: 'SoftGuard funciona lento' } })
  assert.deepEqual(Object.keys(errors), ['customerId'])
  assert.match(errors.customerId, /Escribir en el buscador no vincula/)
})
test('soporte interno admite un pedido sin cuenta y conserva observaciones obligatorias', async () => {
  assert.deepEqual(await validate({ needsCustomer: false, draft: { categoryId: 'internal', customerId: '', description: 'Revisar Wildix' } }), {})
  assert.ok((await validate({ needsCustomer: false, draft: { categoryId: '', customerId: '', description: '   ' } })).description)
})
test('se explican consulta pendiente, error de consulta y decisión de duplicados sin permitir guardar', async () => {
  for (const flags of [{ checking: true }, { accountPending: true }, { duplicateError: 'Sin conexión' }, { duplicates: [{ id: 't1' }] }]) assert.ok((await validate(flags)).duplicates)
  assert.deepEqual(await validate({ duplicates: [{ id: 't1' }], decision: 'different' }), {})
  assert.deepEqual(await validate({ duplicates: [{ id: 't1' }], decision: 't1' }), {})
})

test('el operador puede crear soporte interno sin cuenta; Alarmas conserva su validación en el servidor', async () => {
  const { DatabaseSync } = require('node:sqlite')
  const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
  const { randomUUID } = require('node:crypto')
  const db = new DatabaseSync(':memory:')
  try {
    const store = createTicketStore({ db })
    await store.ensure()
    const user = { id: 'operator-test', name: 'Operador', roleCode: 'operator' }
    const state = { customers: [], history: [], employees: [] }
    const input = { action: 'create', scope: 'internal', origin: 'internal', categoryId: 'alarm', description: 'SoftGuard y Wildix funcionan lento', automaticTitle: true }
    await assert.rejects(store.run(user, state, { ...input, commandId: randomUUID() }), /requiere seleccionar un abonado/)
    const { ticket } = await store.run(user, state, { ...input, categoryId: 'internal', commandId: randomUUID() })
    assert.equal(ticket.status, 'Nuevo')
    assert.equal(ticket.customerId, '')
    assert.equal(ticket.description, input.description)
  } finally { db.close() }
})
