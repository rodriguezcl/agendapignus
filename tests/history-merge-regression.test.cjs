const test = require('node:test')
const assert = require('node:assert/strict')
const { mergeConcurrentState } = require('../api/_lib/state-merge.cjs')
const { assertNoAccidentalHistoryWipe } = require('../api/_lib/core.cjs')

test('581 trabajos distribuidos en 39 equipos conservan todos sus IDs al guardar una agenda concurrente', () => {
  const base = { history: Array.from({ length: 581 }, (_, i) => ({
    id: `work-${i}`, teamId: `team-${i % 39}`, customerId: `customer-${i % 15}`,
    status: 'Pendiente', detail: 'Original'
  })) }
  const current = structuredClone(base)
  const incoming = structuredClone(base)
  current.history[0].status = 'Completado'
  incoming.history[1].detail = 'Corrección desde agenda diaria'
  const merged = mergeConcurrentState(base, current, incoming)
  assert.equal(merged.history.length, 581)
  assert.deepEqual(merged.history.map(r => r.id), base.history.map(r => r.id))
  assert.equal(merged.history[0].status, 'Completado')
  assert.equal(merged.history[1].detail, 'Corrección desde agenda diaria')
  assert.doesNotThrow(() => assertNoAccidentalHistoryWipe(current.history, merged.history))
})

test('el ID del trabajo prevalece aunque todas las referencias compartidas coincidan', () => {
  const base = { history: ['a', 'b', 'c'].map(id => ({ id, taskId: 'shared', historyId: 'shared', teamId: 'shared', customerId: 'shared', detail: '' })) }
  const current = structuredClone(base)
  const incoming = structuredClone(base)
  current.history[0].detail = 'Servidor'
  incoming.history[1].detail = 'Cliente'
  assert.deepEqual(mergeConcurrentState(base, current, incoming).history.map(r => r.detail), ['Servidor', 'Cliente', ''])
})

test('una fusión rechaza identidades duplicadas en lugar de perder filas silenciosamente', () => {
  const base = { history: [{ id: 'a', detail: '' }, { id: 'a', detail: '' }] }
  const current = structuredClone(base)
  const incoming = structuredClone(base)
  current.history[0].detail = 'Servidor'
  incoming.history[1].detail = 'Cliente'
  assert.throws(() => mergeConcurrentState(base, current, incoming), error => error.code === 'STATE_WRITE_CONFLICT')
})

test('una baja explícita elimina sólo ese trabajo aunque comparta equipo con otros', () => {
  const base = { history: ['a', 'b', 'c'].map(id => ({ id, teamId: 'shared', detail: '' })) }
  const current = structuredClone(base)
  current.history[0].detail = 'Servidor'
  const incoming = { history: base.history.filter(r => r.id !== 'b') }
  assert.deepEqual(mergeConcurrentState(base, current, incoming).history.map(r => r.id), ['a', 'c'])
})
