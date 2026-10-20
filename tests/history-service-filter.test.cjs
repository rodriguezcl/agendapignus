const { frontendSource } = require('./helpers/frontend-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const app = frontendSource()

test('el filtro de servicio usa coincidencia exacta y se combina con los otros filtros', () => {
  const line = app.split('\n').find(line => line.includes('const matchingRecords = useMemo'))
  for (const expression of ['filterHistoryRecords(searchIndex', 'serviceFilter', 'fromDate', 'toDate', 'statusFilter', 'search']) assert.ok(line.includes(expression))
})

test('el filtro enumera servicios históricos y restablece selección, página y limpieza', () => {
  assert.match(app, /historyServiceOptions = useMemo\(\(\) => \[\.\.\.new Map\(history.flatMap/)
  assert.match(app, /setHistoryPage\(1\); setSelected\(\[\]\).*serviceFilter/)
  assert.match(app, /const clearFilters = \(\) => \{[\s\S]*?setServiceFilter\(''\)/)
  assert.match(app, /onClick=\{clearFilters\}/)
  assert.match(app, /all.textContent = 'Todos los servicios'/)
})
