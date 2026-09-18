const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const code = source.slice(source.indexOf('function historicalAgendaTeams('), source.indexOf('function HistoricalDailyAgenda('))
const recover = vm.runInNewContext(code + '\nhistoricalAgendaTeams', {
  applyRemovedWeeklyTeams: teams => teams,
  applyRemovedWeeklySlots: teams => teams,
  applyRemovedWeeklyTasks: (teams, removed) => teams.map(team => ({ ...team, tasks: team.tasks.filter(task => !removed.includes(task.taskId)) })),
  historyRecordForTask: (task, date, history) => history.find(record => record.date === date && record.id === task.historyId),
  sortTasksByTime: tasks => [...tasks].sort((a, b) => a.time.localeCompare(b.time))
})
test('recupera todos los estados y pagos sin mutar la agenda ni duplicar servicios', () => {
  const date = '2026-09-17'
  const weekly = { [date]: { teams: [{ teamId: 'a', label: 'Equipo 1', tasks: [{ taskId: 't', historyId: 'h', time: '08:00', amount: '1' }] }] } }
  const history = [{ id: 'h', date, teamId: 'a', time: '08:00', status: 'Completado', amount: '260000' }, { id: 'c', date, teamId: 'a', time: '10:00', status: 'Cancelado' }]
  const before = JSON.stringify({ weekly, history })
  const teams = recover(date, weekly, history)
  assert.equal(teams.length, 1)
  assert.equal(teams[0].tasks.length, 2)
  assert.equal(teams[0].tasks[0].amount, '260000')
  assert.equal(teams[0].tasks[1].status, 'Cancelado')
  assert.equal(JSON.stringify({ weekly, history }), before)
})
test('fecha vacía no genera equipos ni servicios predeterminados', () => {
  assert.equal(recover('2026-09-01', {}, []).length, 0)
})
test('la consulta está separada del editor y no expone acciones de escritura', () => {
  const view = source.slice(source.indexOf('function HistoricalDailyAgenda('), source.indexOf('function AgendaWorkspace('))
  assert.doesNotMatch(view, /setTeams|setWeekly|Guardar|Eliminar|onCommit|persistWeeklyService/)
  assert.match(view, /HistoricalServiceFields/)
  assert.match(source, /finishedDay \? 'Ver día' : 'Abrir día'/)
  assert.match(source, /if \(nextDate < currentLocalDate\(\)\) setHistoricalDate\(nextDate\)/)
})
