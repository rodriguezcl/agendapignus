const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const compiled = buildSync({
  stdin: { contents: `export { DuplicateTicketContent } from './src/features/tickets/Tickets.jsx'; export { TechnicalDuplicatePreview } from './src/components/TechnicianReportModal.jsx'`, loader: 'jsx', resolveDir: root },
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent'
})
const previewModule = new Module(path.join(root, 'duplicate-preview-test.cjs'), module)
previewModule.paths = module.paths
previewModule._compile(compiled.outputFiles[0].text, previewModule.id)

const ticket = {
  id: 'ticket-other', number: '1000032', title: 'Cámara de ingreso sin imagen', description: 'Se corta la imagen durante la noche.',
  categoryId: 'camera', eventType: 'loss', zone: 'Ingreso', status: 'En gestión', priority: 'Alta', assigneeName: 'Soporte', createdAt: '2026-10-23T12:00:00Z',
  messages: [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `public-${index}`, visibility: 'public', byName: `Operador ${index + 1}`, body: `Detalle público ${index + 1}`, createdAt: '2026-10-23T12:00:00Z', attachments: [{ id: 'private-file', fileName: 'archivo-no-autorizado.pdf' }] })),
    { id: 'private', visibility: 'internal', byName: 'Administrador', body: 'Nota interna confidencial' }
  ],
  events: [{ note: 'Gestión interna confidencial' }]
}

for (const [name, Component] of Object.entries(previewModule.exports)) {
  test(`${name}: permite comparar todo el relato público sin abrir información o acciones internas`, () => {
    const html = renderToStaticMarkup(React.createElement(Component, { ticket, config: { categories: [{ id: 'camera', name: 'Cámaras' }], events: [{ id: 'loss', name: 'Pérdida de imagen' }] } }))
    assert.match(html, /Cámara de ingreso sin imagen/)
    assert.match(html, /Se corta la imagen durante la noche/)
    for (let index = 1; index <= 5; index++) assert.ok(html.includes(`Detalle público ${index}`))
    assert.doesNotMatch(html, /confidencial|archivo-no-autorizado|private-file|\/api\/tickets\/attachments/)
    assert.doesNotMatch(html, /<form|<button|<a\s|Guardar gestión|Resolver|Asignar responsable/)
    assert.match(html, /En gestión/)
    assert.match(html, /Soporte/)
  })
}
