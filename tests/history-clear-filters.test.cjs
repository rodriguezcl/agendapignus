const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')

test('clear resets all history filters, selection, page and native fields', () => {
  const calls = {}
  const context = {}
  for (const name of ['setSearch', 'setFromDate', 'setToDate', 'setStatusFilter', 'setServiceFilter', 'setHistoryPage', 'setSelected', 'clearReminderFilter']) {
    context[name] = value => { calls[name] = value === undefined ? true : value }
  }
  const dates = [{ value: '2026-09-18' }, { value: '2026-09-19' }]
  const selects = [{ value: 'Pendiente' }, { value: 'alarma' }]
  context.document = { querySelectorAll: selector => selector.endsWith('input') ? dates : selects }
  const start = source.indexOf('  const clearFilters = () => {', source.indexOf('function HistoryBulkView'))
  const end = source.indexOf('  const historyServiceOptions', start)
  vm.runInNewContext(source.slice(start, end) + '\nclearFilters()', context)
  for (const name of ['setSearch', 'setFromDate', 'setToDate', 'setServiceFilter']) assert.equal(calls[name], '')
  assert.equal(calls.setStatusFilter, 'all')
  assert.equal(calls.setHistoryPage, 1)
  assert.equal(calls.setSelected.length, 0)
  assert.equal(calls.clearReminderFilter, true)
  assert.deepEqual(dates.map(input => input.value), ['', ''])
  assert.deepEqual(selects.map(input => input.value), ['all', ''])
})

test('header owns conditional clear button and reminder banner is removed', () => {
  const history = source.slice(source.indexOf('function History({'), source.indexOf('function HistoryManagementDetail'))
  assert.doesNotMatch(history, /Quitar filtro|className="pending-reminder"/)
  assert.match(history, /className="history-header-actions">\{hasActiveFilters && <button className="secondary" onClick=\{clearFilters\}/)
  assert.match(history, /Boolean\(reminderFilter \|\| search \|\| fromDate \|\| toDate \|\| statusFilter !== 'all' \|\| serviceFilter\)/)
})
