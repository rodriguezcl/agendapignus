const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { TechnicianReportModal } = require('./helpers/load-app.cjs')(['TechnicianReportModal'])

function render(record) {
  return renderToStaticMarkup(React.createElement(TechnicianReportModal, {
    record: { id: 'visit-1', technicianIds: ['tech-1', 'tech-2'], ...record },
    type: 'Completado', serviceLabel: 'Servicio de alarma', onClose() {}, onSubmit() {}
  }))
}

test('El informe permite solicitar seguimiento cuando el servicio todavía no tiene uno', () => {
  assert.match(render({}), /Solicitar acción \/ seguimiento/)
})

test('El informe con seguimiento oculto no ofrece enviar otra solicitud que sería descartada', () => {
  const html = render({ hasFollowup: true })
  assert.doesNotMatch(html, /Solicitar acción \/ seguimiento/)
  assert.match(html, />Continuar<\/button>/)
})

test('El informe con seguimiento propio conserva el bloqueo de una segunda solicitud', () => {
  assert.doesNotMatch(render({ followup: { id: 'followup:visit-1', createdById: 'tech-1' } }), /Solicitar acción \/ seguimiento/)
})
