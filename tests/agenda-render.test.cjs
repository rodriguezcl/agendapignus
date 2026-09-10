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
  const bundle = buildSync({ stdin: { contents: `${source}\nexport { Agenda, WeeklyPlanner };`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
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
})

test('la agenda distingue servicios sin persistir y confirma su alta en historial', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8')

  assert.match(source, /record \? \(record\.status \|\| record\.technicalStatus \|\| 'Pendiente'\) : 'Sin guardar'/)
  assert.match(source, /Guardá la agenda para habilitarlo al técnico\./)
  assert.match(source, /El servidor no confirmó todos los servicios en el historial\./)
})
