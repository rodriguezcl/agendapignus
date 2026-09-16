const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('el encabezado del historial se fija sin espacio superior que exponga filas', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/constitution-ui.css'), 'utf8')
  const rule = css.match(/\.history-bulk \.table-head\s*\{([^}]+)\}/)[1]
  assert.match(rule, /position: sticky !important/)
  assert.match(rule, /top: 0 !important/)
  assert.match(rule, /z-index:/)
})
