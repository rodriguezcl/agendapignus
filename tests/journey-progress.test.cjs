const test = require('node:test')
const assert = require('node:assert/strict')
const { activeJourneyIndexes, assertJourneyReport, validateServiceJourneys } = require('../api/_lib/service-journeys.cjs')
const { visibleStateForUser } = require('../api/_lib/core.cjs')

const visits = () => [1, 2, 3].map(index => ({
  id: index === 1 ? 'group' : `visit-${index}`, date: `2099-01-0${index + 4}`, time: '09:00',
  estimatedMinutes: 60, status: 'Pendiente', customerId: 'client', serviceId: 'alarm',
  technicianIds: ['tech'], serviceJourney: { id: 'group', index, total: 3 }
}))

test('la etiqueta renderizada desaparece y el detalle conserva la planificación original', () => {
  const path = require('node:path'), Module = require('node:module'), React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { buildSync } = require('esbuild')
  const entry = path.resolve(__dirname, '../src/components/ServiceJourneys.jsx')
  const bundle = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' } })
  const compiled = new Module(entry, module); compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, entry)
  const { ServiceJourneys, ServiceJourneysContext, JourneyHistory } = compiled.exports
  const history = visits()
  const render = Component => renderToStaticMarkup(React.createElement(ServiceJourneysContext.Provider, { value: { history } }, React.createElement(Component, { record: history[0] })))
  assert.match(render(ServiceJourneys), /Jornada 1 de 3/)
  history[1].status = history[2].status = 'Cancelado'
  assert.equal(render(ServiceJourneys), '')
  assert.match(render(JourneyHistory), /Planificación original e informes/)
  assert.match(render(JourneyHistory), /Jornada 3 de 3/)
  assert.match(render(JourneyHistory), /Cancelado/)
})

test('la numeración vigente excluye cancelaciones y desaparece si queda una jornada', async () => {
  const ui = await import('../src/domain/agenda/journey-progress.mjs')
  const history = visits()
  history[1].status = 'Cancelado'
  assert.equal(ui.journeyLabel(history[0], history), 'Jornada 1 de 2')
  assert.equal(ui.journeyLabel(history[2], history), 'Jornada 2 de 2')
  assert.equal(ui.journeyLabel(history[1], history), '')
  assert.equal(ui.journeyReportType(history[0], history), 'Avance registrado')
  assert.throws(() => assertJourneyReport(history[0], 'Completado', history), /intermedia/)
  history[2].status = 'Cancelado'
  assert.equal(ui.journeyLabel(history[0], history), '')
  assert.equal(ui.journeyReportType(history[0], history), 'Completado')
  assert.deepEqual(ui.activeJourneyIndexes(history[0], history), activeJourneyIndexes(history[0], history))
  assert.doesNotThrow(() => assertJourneyReport(history[0], 'Completado', history))
  assert.throws(() => assertJourneyReport(history[0], 'Avance registrado', history), /intermedia/)
  assert.equal(ui.journeyLabel({}), '')
  assert.equal(ui.journeyReportType({}), 'Completado')
})

test('cancelar una jornada posterior conserva avances existentes y permite su cierre explícito', () => {
  const history = visits()
  history[0].status = 'Avance registrado'
  history[0].technicalStatus = 'Avance registrado'
  history[0].technicalObservation = 'Cableado terminado'
  const previous = { history }
  const next = structuredClone(previous)
  next.history[1].status = next.history[2].status = 'Cancelado'
  assert.doesNotThrow(() => validateServiceJourneys(next, previous))
  assert.equal(next.history[0].status, 'Avance registrado')
  const closed = structuredClone(next)
  closed.history[0].status = 'Completado'
  assert.doesNotThrow(() => validateServiceJourneys(closed, next))
  assert.equal(closed.history[0].technicalObservation, history[0].technicalObservation)
  assert.deepEqual(closed.history.map(record => record.serviceJourney), history.map(record => record.serviceJourney))
})

test('la última jornada vigente exige resolver todas las anteriores no canceladas', () => {
  const history = visits()
  history[1].technicalStatus = 'Cancelado'
  assert.throws(() => assertJourneyReport(history[2], 'Completado', history), /anteriores/)
  history[0].status = 'Avance registrado'
  assert.doesNotThrow(() => assertJourneyReport(history[2], 'Completado', history))
})

test('la vista parcial del técnico recibe el total vigente sin exponer visitas ocultas', async () => {
  const ui = await import('../src/domain/agenda/journey-progress.mjs')
  const history = visits()
  history[1].status = 'Cancelado'; history[1].awaitingConfirmation = true
  history[2].status = 'Cancelado'; history[2].awaitingConfirmation = true
  const state = { history, vehicles: [] }
  const visible = visibleStateForUser(state, { id: 'tech', roleCode: 'technician' })
  assert.equal(visible.history.length, 1)
  assert.deepEqual(visible.history[0].journeyActiveIndexes, [1])
  assert.equal(ui.journeyLabel(visible.history[0], visible.history), '')
  assert.equal(ui.journeyReportType(visible.history[0], visible.history), 'Completado')
  assert.equal(history[0].journeyActiveIndexes, undefined)
  // Pending visits hidden by confirmation still prevent premature completion.
  history[2].status = 'Pendiente'
  const updated = visibleStateForUser(state, { id: 'tech', roleCode: 'technician' })
  assert.equal(ui.journeyReportType(updated.history[0], updated.history), 'Avance registrado')
})
