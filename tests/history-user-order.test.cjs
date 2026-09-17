const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('historial de usuario usa el mismo criterio operativo que administración', async () => {
  const { sortOperationalHistory } = await import('../src/domain/history/history-order.mjs')
  const records = [
    { id: 'vehicle', date: '2026-09-18', time: '15:30', status: 'Pendiente', vehicleControl: true },
    { id: 'late', date: '2026-09-17', time: '14:00', status: 'Pendiente' },
    { id: 'early', date: '2026-09-17', time: '08:30', status: 'Pendiente' }
  ]
  assert.deepEqual(records.sort(sortOperationalHistory).map(record => record.id), ['early', 'late', 'vehicle'])
  const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  const readOnly = source.slice(source.indexOf('function HistoryReadOnly('), source.indexOf('function HistoryView('))
  assert.match(readOnly, /sort\(supervisorView \? sortHistoryByDateAndTime : sortOperationalHistory\)/)
})
