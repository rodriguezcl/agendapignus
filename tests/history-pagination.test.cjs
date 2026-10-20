const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { HistoryReadOnly } = require('./helpers/load-app.cjs')(['HistoryReadOnly'])

test('read-only history bounds rendered records while retaining the result total', () => {
  const history = Array.from({ length: 120 }, (_, index) => ({
    id: `record-${index}`, date: '2026-10-20', time: '09:00',
    client: `Cliente ${index}`, service: 'Service', status: 'Completado'
  }))
  const html = renderToStaticMarkup(React.createElement(HistoryReadOnly, { history, supervisorView: true }))
  assert.equal((html.match(/class="history-row"/g) || []).length, 50)
  assert.match(html, /Página 1 de 3/)
  assert.match(html, /120 servicios/)
  assert.match(html, /Paginación del historial/)
  assert.doesNotMatch(html, /Guardar cambios|Eliminar servicio/)
})

test('an empty or short read-only history has no unnecessary page controls', () => {
  for (const history of [[], [{ id: 'single', date: '2026-10-20', client: 'Cliente', service: 'Service' }]]) {
    const html = renderToStaticMarkup(React.createElement(HistoryReadOnly, { history }))
    assert.doesNotMatch(html, /Paginación del historial/)
  }
})
