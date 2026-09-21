const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToString } = require('react-dom/server')
const { buildSync } = require('esbuild')

test('daily and weekly components render through their actual prop forwarding chain', () => {
  const root = path.resolve(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const bundle = buildSync({ stdin: { contents: `${source}\nexport { Agenda, WeeklyPlanner, ServiceConfirmationButton };`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'test-render.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, path.join(root, 'test-render.cjs'))
  const noop = () => {}
  const props = { date: '2026-01-05', teams: [], weekly: {}, customers: [], services: [], activeTechs: [], history: [], vehicles: [], permissions: {}, databaseReady: true, authUser: null,
    setDate: noop, setTeams: noop, setWeekly: noop, setHistory: noop, setCustomers: noop, setNotice: noop, updateTask: noop, openDaily: noop, persistAgendaRecords: async () => {}, persistWeeklyService: async () => {} }
  assert.doesNotThrow(() => renderToString(React.createElement(compiled.exports.Agenda, props)))
  const weekly = renderToString(React.createElement(compiled.exports.WeeklyPlanner, props))
  assert.match(weekly, /Agenda semanal/)
  assert.doesNotMatch(weekly, /weekly-save-day/)
  const confirmation = awaitingConfirmation => renderToString(React.createElement(compiled.exports.ServiceConfirmationButton, {
    task: { client: 'Cliente', awaitingConfirmation }, day: '2099-01-05', onDraftChange: noop
  }))
  assert.match(confirmation(false), /Marcar A CONFIRMAR/)
  assert.match(confirmation(true), /Confirmar servicio/)
  assert.equal(renderToString(React.createElement(compiled.exports.ServiceConfirmationButton, {
    task: { client: 'Vehículo', vehicleControl: true }, day: '2099-01-05', onDraftChange: noop
  })), '')
})

test('la agenda distingue servicios sin persistir y confirma su alta en historial', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8')

  assert.match(source, /record \? \(record\.status \|\| record\.technicalStatus \|\| 'Pendiente'\) : 'Sin guardar'/)
  assert.match(source, /Guardá la agenda para habilitarlo al técnico\./)
  assert.match(source, /El servidor no confirmó todos los servicios en el historial\./)
})

test('la vista previa permite copiar la agenda con la misma acción del botón exterior', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8')

  assert.match(source, /const copyAgenda = \(\) => \{[\s\S]*?navigator\.clipboard\?\.writeText\(message\)[\s\S]*?return clearAgenda\(\)/)
  assert.match(source, /<button className="primary" onClick=\{copyAgenda\}><Icon name="copy" \/>Copiar agenda<\/button>/)
  assert.match(source, /<Preview title="Vista previa de la agenda" text=\{message\} onCopy=\{copyAgenda\}/)
  assert.match(source, /className="modal-actions preview-modal-actions"[\s\S]*?onClick=\{onCopy\}[\s\S]*?Copiar agenda/)
})

test('la agenda diaria conserva la dotación semanal vigente al recuperar servicios históricos', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const loader = source.slice(source.indexOf('const loadAgendaForDate'), source.indexOf('const activeServices', source.indexOf('const loadAgendaForDate')))

  assert.match(loader, /const plannedTeamKeys = new Set\(byTeam\.keys\(\)\)/)
  assert.match(loader, /if \(!plannedTeamKeys\.has\(teamKey\)\) \{[\s\S]*?record\.technicianIds[\s\S]*?record\.technicians/)
  assert.doesNotMatch(loader, /current\.memberIds = record\.technicianIds\?\.length \? record\.technicianIds : current\.memberIds\s+current\.members = record\.technicians\?\.length \? record\.technicians : current\.members\s+\/\/ Se aceptan/)
})
