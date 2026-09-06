const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8')

test('todos los modales se cierran desde el fondo o con Escape', () => {
  assert.match(source, /document\.querySelectorAll\('\.modal-layer, \.modal-backdrop'\)/)
  assert.match(source, /event\.target\.matches\('\.modal-layer, \.modal-backdrop'\)/)
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(source, /dismiss\(layers\[layers\.length - 1\]\)/)
  assert.match(source, /document\.addEventListener\('click', closeFromBackdrop\)/)
  assert.match(source, /document\.addEventListener\('keydown', closeFromEscape, true\)/)
})

test('el cierre global no activa acciones y respeta operaciones en curso', () => {
  assert.match(source, /\.close-modal:not\(:disabled\)/)
  assert.match(source, /\.modal-close:not\(:disabled\)/)
  assert.match(source, /\.modal-actions \.secondary:not\(:disabled\)/)
  assert.match(source, /\.confirm-actions \.secondary:not\(:disabled\)/)
  assert.match(source, /className = 'primary modal-dismiss'/)
})
