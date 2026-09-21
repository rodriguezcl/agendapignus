const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')

test('el filtro de servicio usa coincidencia exacta y se combina con los otros filtros', () => {
  const line = app.split('\n').find(line => line.includes('const matchingRecords = history.filter'))
  for (const expression of ['normalizeSearchText(record.service) === serviceFilter', 'fromDate', 'toDate', 'statusFilter', 'normalizedSearch']) assert.ok(line.includes(expression))
})

test('el filtro enumera servicios históricos y restablece selección, página y limpieza', () => {
  assert.match(app, /historyServiceOptions = useMemo\(\(\) => \[\.\.\.new Map\(history.filter/)
  assert.match(app, /setHistoryPage\(1\); setSelected\(\[\]\).*serviceFilter/)
  assert.match(app, /const clearFilters = \(\) => \{[\s\S]*?setServiceFilter\(''\)/)
  assert.match(app, /onClick=\{clearFilters\}/)
  assert.match(app, /all.textContent = 'Todos los servicios'/)
})
