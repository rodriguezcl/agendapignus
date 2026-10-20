const test = require('node:test')
const assert = require('node:assert/strict')

const fixture = [
  { id: 'a', client: 'José Pérez', date: '2026-10-01', service: 'Instalación de alarma', technicians: ['María'], status: 'Completado' },
  { id: 'b', client: 'Otro cliente', date: '2026-10-02', service: 'Instalación de alarma especial', technicians: ['Pedro'], status: 'Pendiente' },
  { id: 'c', client: 'José Pérez', date: '2026-10-03', service: 'Service de cámaras', technicians: ['María'], status: 'Pendiente' }
]

test('history query combines accent-insensitive search, dates, exact service and status', async () => {
  const { createHistorySearchIndex, filterHistoryRecords } = await import('../src/domain/history/history-query.mjs')
  const index = createHistorySearchIndex(fixture)
  assert.deepEqual(filterHistoryRecords(index, { search: 'JOSE', fromDate: '2026-10-01', toDate: '2026-10-02', serviceFilter: 'instalacion de alarma', statusFilter: 'Completado' }).map(record => record.id), ['a'])
  assert.deepEqual(filterHistoryRecords(index, { serviceFilter: 'instalacion de alarma' }).map(record => record.id), ['a'])
  assert.deepEqual(filterHistoryRecords(index, { search: 'maria', statusFilter: 'Pendiente' }).map(record => record.id), ['c'])
})

test('history query preserves source records and supports the supervisor ordering', async () => {
  const { createHistorySearchIndex, filterHistoryRecords } = await import('../src/domain/history/history-query.mjs')
  const history = structuredClone(fixture)
  const index = createHistorySearchIndex(history)
  const result = filterHistoryRecords(index, { compare: (left, right) => right.date.localeCompare(left.date) })
  assert.deepEqual(result.map(record => record.id), ['c', 'b', 'a'])
  assert.equal(result[2], history[0])
  assert.deepEqual(history, fixture)
  assert.deepEqual(filterHistoryRecords(index, { search: 'sin coincidencias' }), [])
})

test('history query indexes every type in a service with multiple activities', async () => {
  const { createHistorySearchIndex, filterHistoryRecords } = await import('../src/domain/history/history-query.mjs')
  const record = { ...fixture[0], serviceTypes: [{ id: 'alarm', name: 'Alarma' }, { id: 'camera', name: 'Cámaras' }] }
  const index = createHistorySearchIndex([record])
  assert.deepEqual(filterHistoryRecords(index, { serviceFilter: 'camaras' }), [record])
  assert.deepEqual(filterHistoryRecords(index, { search: 'camara' }), [record])
})
