const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
const compiled = buildSync({ stdin: { contents: `export { TicketResolutionFields } from './src/features/tickets/Tickets.jsx'`, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
const loaded = new Module(path.join(root, 'ticket-resolution-test.cjs'), module); loaded.paths = module.paths; loaded._compile(compiled.outputFiles[0].text, loaded.id)
const render = (ticket = {}, value = '') => renderToStaticMarkup(React.createElement(loaded.exports.TicketResolutionFields, { ticket, value, onChange: () => {} }))

test('cerrar pide medio explícito y permite atención remota sin seleccionar un servicio', () => {
  const html = render()
  assert.match(html, /Medio de resolución/)
  assert.match(html, /<select required=""/)
  assert.match(html, /<option value="" disabled="" selected="">Seleccionar medio/)
  for (const label of ['Llamada', 'Chat', 'Correo', 'Visita técnica', 'Otra gestión']) assert.ok(html.includes(label))
  assert.match(html, /sin coordinar una visita/)
  assert.doesNotMatch(html, /no los cancela|Seleccionar servicio/)
})
test('avisa únicamente por visitas coordinadas que siguen pendientes', () => {
  const ticket = { resolutionServiceIds: ['visit'], serviceSchedule: [{ id: 'visit', status: 'Pendiente' }, { id: 'context', status: 'Pendiente' }] }
  assert.match(render(ticket, 'phone'), /Cerrar el ticket no los cancela/)
  for (const status of ['Completado', 'Cancelado', 'Reprogramado', 'Avance registrado']) {
    assert.doesNotMatch(render({ ...ticket, serviceSchedule: [{ id: 'visit', status }, { id: 'context', status: 'Pendiente' }] }), /Cerrar el ticket no los cancela/)
  }
})
