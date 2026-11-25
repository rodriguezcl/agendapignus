const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path'), Module = require('node:module')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const { parseDocument } = require('htmlparser2')
const day = '2099-10-08', noop = () => {}
const user = { id: 'admin', roleCode: 'administrator', name: 'Administración' }
let components
test.before(async () => {
  const root = path.resolve(__dirname, '..')
  const contents = `export { PermissionsProvider } from './src/presentation/contexts/permissions-context.jsx'; export { JourneyIdentityField } from './src/components/ServiceJourneys.jsx'; export { WeeklyPlanner } from './src/features/agenda/presentation/WeeklyPlanner.jsx'; export { AgendaWorkspaceForm } from './src/features/agenda/presentation/DailyAgenda.jsx';`
  const built = await require('esbuild').build({ stdin: { contents, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'calendar-fixture', setup(build) { build.onLoad({ filter: /useNationalHolidays\.js$/ }, () => ({ contents: 'export const useNationalHolidays = () => ({ records: [], loading: false, error: "" })', loader: 'js' })) } }] })
  const compiled = new Module(path.join(root, 'test-journey-agenda-ui.cjs'), module)
  compiled.paths = module.paths; compiled._compile(built.outputFiles[0].text, compiled.id); components = compiled.exports
})
function nodes(node, predicate) { return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))] }
function fixture(reported, linked = true) {
  const history = [1, 2, 3, 4].map(index => ({ id: index === 1 ? 'journey' : 'work-' + index, sourceTaskId: 'task-' + index, date: '2099-10-' + String(index + 5).padStart(2, '0'), time: '08:30', client: 'Lucas Flores', customerId: 'lucas', serviceId: 'cctv', service: 'Instalación de cámaras', estimatedMinutes: 120, teamId: 'team', team: 'Equipo 1', technicianIds: ['tech'], technicians: ['Técnico Uno'], status: 'Pendiente', ...(linked ? { serviceJourney: { id: 'journey', index, total: 4 } } : {}) }))
  if (reported) Object.assign(history[0], { status: 'Avance registrado', technicalStatus: 'Avance registrado', technicalObservation: 'Instalación de cañería', technicalReportedAt: '2099-10-06T15:00:00Z' })
  const task = { ...history[2], taskId: 'task-3', historyId: 'work-3' }
  const team = { teamId: 'team', label: 'Equipo 1', memberIds: ['tech'], members: ['Técnico Uno'], tasks: [task] }
  return { history, task, team }
}
function render(name, reported, linked = true) {
  const { history, team } = fixture(reported, linked)
  const weekly = { [day]: { teams: [team] }, _monthlyTeams: { '2099-10': { teams: [{ ...team, tasks: [] }] } } }
  const props = { initialAnchor: day, date: day, weekly, teams: [team], services: [{ id: 'cctv', name: 'Instalación de cámaras', status: 'Activo', estimatedMinutes: 120 }], customers: [{ customerId: 'lucas', name: 'Lucas Flores', account: 'CLI-1' }], activeTechs: [{ id: 'tech', name: 'Técnico Uno' }], history, vehicles: [], authUser: user, setWeekly: noop, setTeams: noop, setDate: noop, setCustomers: noop, setHistory: noop, setNotice: noop, updateTask: noop }
  const before = JSON.stringify(props)
  const html = renderToStaticMarkup(React.createElement(components.PermissionsProvider, { user }, React.createElement(components[name], props)))
  assert.equal(JSON.stringify(props), before)
  const document = parseDocument(html)
  const row = nodes(document, node => node.attribs?.[name === 'WeeklyPlanner' ? 'data-weekly-search-key' : 'data-daily-task-id'] === (name === 'WeeklyPlanner' ? day + '/0/0' : 'task-3'))[0]
  assert.ok(row)
  return { html, row }
}
for (const name of ['WeeklyPlanner', 'AgendaWorkspaceForm']) {
  test(name + ' protects customer and service when an earlier journey has a report', () => {
    const { html, row } = render(name, true)
    for (const value of ['Lucas Flores', 'Instalación de cámaras']) assert.ok(nodes(row, node => node.name === 'input' && node.attribs?.value === value && Object.hasOwn(node.attribs, 'readonly')).length)
    assert.equal(nodes(row, node => node.attribs?.class?.includes('customer-autocomplete')).length, 0)
    assert.equal(nodes(row, node => node.attribs?.class === 'service-types-trigger').length, 0)
    assert.match(html, /Protegido: una jornada ya tiene trabajo registrado/)
  })
  test(name + ' warns that a customer change covers every unstarted journey', () => {
    const { html, row } = render(name, false)
    assert.ok(nodes(row, node => node.attribs?.class?.includes('customer-autocomplete')).length)
    assert.match(html, /El cambio se aplica a todas las jornadas del servicio/)
    assert.match(html, /quitá esta jornada y agregá un servicio nuevo/)
  })
}
test('daily agenda offers Quitar jornada while a normal service still offers Eliminar', () => {
  assert.match(render('AgendaWorkspaceForm', true).html, /aria-label="Quitar jornada 1 del Equipo 1"/)
  const ordinary = render('AgendaWorkspaceForm', false, false)
  assert.match(ordinary.html, /aria-label="Eliminar servicio 1 del Equipo 1"/)
  assert.doesNotMatch(ordinary.html, /El cambio se aplica a todas las jornadas|Quitar jornada|Protegido: una jornada/)
})
test('PIG linking stays available after a report and explicitly preserves every journey', () => {
  const { task, history } = fixture(true)
  const html = renderToStaticMarkup(React.createElement(components.JourneyIdentityField, { record: { ...task, subscriberReservation: true }, history, customer: true, className: 'daily-field-customer' }, React.createElement('input', { 'aria-label': 'Vincular PIG', defaultValue: '' })))
  assert.match(html, /aria-label="Vincular PIG"/)
  assert.match(html, /La vinculación PIG se aplica a todas las jornadas y conserva los informes/)
  assert.match(html, /class="daily-field-customer"/)
  assert.doesNotMatch(html, /readonly/)
})
