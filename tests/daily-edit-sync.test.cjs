const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
const effect = marker => {
  const at = source.indexOf(marker)
  const start = source.lastIndexOf('  useEffect(() => {', at)
  return source.slice(start, source.indexOf('\n  }, [', at)) + '\n  })'
}
const toDaily = effect('// Compatibilidad con equipos históricos cuyos teamId semanal y diario no')
const toWeekly = effect('// Ambos módulos escriben sobre el mismo día: los cambios de la agenda del día')
const date = '2026-09-18'
const teams = address => [{ teamId: 'team-1', label: 'Equipo 1', memberIds: ['pascual'], members: ['Pascual'], tasks: [{ taskId: 'reservation', historyId: 'history-1', subscriberReservation: true, client: 'LUZ ALCARAZ', address, phone: '123', amount: '25000', internalNote: 'Conservar nota' }] }]
function render(state, module = 'agenda', reverseEffect = toDaily) {
  const updates = []
  const context = {
    module, date, weekly: state.weekly, teams: state.teams,
    pastDayBlocked: false, loadedAgendaDate: { current: date }, advancedGuard: null,
    sundayBlocked: false, holidayBlocked: false, holidayCalendarUnavailable: false,
    sortTasksByTime: tasks => tasks,
    useEffect: callback => callback(),
    setWeekly: updater => updates.push(() => { state.weekly = updater(state.weekly) }),
    setTeams: updater => updates.push(() => { state.teams = updater(state.teams) })
  }
  // React runs child passive effects before the parent's effects. Both capture
  // the same render, before their queued updates are committed.
  if (module === 'agenda') vm.runInNewContext(toWeekly, context)
  vm.runInNewContext(reverseEffect, context)
  updates.forEach(update => update())
}

test('regression fixture reproduces alternating reservation addresses without the guard', () => {
  const state = { teams: teams('Corregida'), weekly: { [date]: { teams: teams('Anterior') } } }
  const oldEffect = toDaily.replace("    if (module === 'agenda') return", '')
  render(state, 'agenda', oldEffect)
  assert.equal(state.teams[0].tasks[0].address, 'Anterior')
  render(state, 'agenda', oldEffect)
  assert.equal(state.teams[0].tasks[0].address, 'Corregida')
  render(state, 'agenda', oldEffect)
  assert.equal(state.teams[0].tasks[0].address, 'Anterior')
})

test('daily reservation edits converge and remain stable through repeated renders', () => {
  const state = { teams: teams('Corregida'), weekly: { [date]: { teams: teams('Anterior') } } }
  for (let index = 0; index < 6; index++) {
    render(state)
    assert.equal(state.teams[0].tasks[0].address, 'Corregida')
    assert.equal(state.weekly[date].teams[0].tasks[0].address, 'Corregida')
    assert.equal(state.teams[0].tasks[0].subscriberReservation, true)
  }
  const stable = state.weekly
  render(state)
  assert.equal(state.weekly, stable)
  state.teams = teams('Segunda corrección')
  render(state)
  assert.equal(state.weekly[date].teams[0].tasks[0].address, 'Segunda corrección')
  assert.equal(state.weekly[date].teams[0].tasks[0].internalNote, 'Conservar nota')
})

test('weekly-to-daily compatibility still works outside the daily editor by task identity', () => {
  const state = { teams: teams('Anterior'), weekly: { [date]: { teams: teams('Semanal') } } }
  state.teams[0].teamId = 'legacy-daily-team'
  render(state, 'weekly')
  assert.equal(state.teams[0].tasks[0].address, 'Semanal')
  assert.match(source, /\}, \[weekly, date, module\]\)/)
})
