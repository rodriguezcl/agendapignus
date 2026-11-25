const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path'), Module = require('node:module')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
function component() {
 const file = path.resolve(__dirname, '../src/components/HistoryRescheduleModal.jsx')
 const output = require('esbuild').buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react','react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
 const compiled = new Module(file, module); compiled.paths = module.paths
 compiled._compile(output.outputFiles[0].text, file)
 return compiled.exports.default
}
test('Historial fija fecha y ofrece solo el último cuarto de hora del control', () => {
 const ControlModal = component()
 const record = { id: 'vehicle-control-2099-10-09-car', vehicleControl: true, vehicleControlScheduledFriday: '2099-10-09', date: '2099-10-12', teamId: 'team', status: 'Pendiente', estimatedMinutes: 15 }
 const team = { teamId: 'team', label: 'Equipo 1', memberIds: ['tech'], members: ['Técnico Uno'], tasks: [] }
 for (const [weekly, date, time] of [[{},'2099-10-09','15:45'], [{_holidayOverrides:{'2099-10-09':{status:'closed'}}},'2099-10-08','16:45'], [{_holidayOverrides:{'2099-10-09':{status:'closed'},'2099-10-08':{status:'closed'}}},'2099-10-07','16:45']]) {
  const html = renderToStaticMarkup(React.createElement(ControlModal, { record, estimatedMinutes: 15, minimumDate: '2099-01-01', scheduling: { weekly, assignedTeamsForDate: ()=>[team], teamsForDate: ()=>[team] } }))
  assert.match(html, new RegExp('type="date"[^>]*disabled=""[^>]*value="'+date+'"|type="date"[^>]*value="'+date+'"[^>]*disabled=""'))
  assert.match(html, new RegExp('>'+time+'</button>'))
  assert.doesNotMatch(html, />08:30<\/button>/)
 }
})
