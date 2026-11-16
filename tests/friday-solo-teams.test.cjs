const test = require('node:test')
const assert = require('node:assert/strict')
const { unifyFridaySoloTeams } = require('../api/_lib/friday-solo-teams.cjs')
const day = '2026-11-20'
const options = { today: '2026-11-16' }
const task = (id, time, extra = {}) => ({ taskId: id, historyId: `history-${id}`, serviceId: 'alarm', time, status: 'Pendiente', estimatedMinutes: 60, ...extra })
function fixture({ accompanied = false, onlyGuard = false, daily = true } = {}) {
  const morning = { teamId: 'morning', label: 'Equipo 3', memberIds: accompanied ? [7, 8] : [7], members: accompanied ? ['Pascual', 'Compañero'] : ['Pascual'], tasks: [task('morning-job', '08:30'), task('control', '15:45', { vehicleControl: true, estimatedMinutes: 15, technicianIds: [7] })] }
  const guard = { teamId: 'guard', label: 'Equipo 4', memberIds: [7], members: ['Pascual'], tasks: [task('guard-job', '16:30', { detail: 'Conservar detalle' })] }
  const teams = onlyGuard ? [guard] : [morning, guard]
  return { history: teams.flatMap(team => team.tasks.map(t => ({ ...t, id: t.historyId, sourceTaskId: t.taskId, date: day, teamId: team.teamId, team: team.label, technicianIds: team.memberIds, technicians: team.members }))), agenda: { ...(daily ? { date: day, teams: structuredClone(teams) } : {}), weekly: { _monthlyTeams: { '2026-11': { teams: [{ ...morning, tasks: [] }] } }, [day]: { teams } } } }
}

test('Pascual solo: reúne mañana, control y guardia sin duplicar ni cambiar servicios', () => {
  const state = fixture(), before = structuredClone(state)
  const next = unifyFridaySoloTeams(state, {}, options)
  assert.deepEqual(state, before)
  assert.equal(next.agenda.weekly[day].teams.length, 1)
  assert.equal(next.agenda.weekly[day].teams[0].teamId, 'morning')
  assert.deepEqual(next.agenda.weekly[day].teams[0].tasks.map(t => t.time), ['08:30', '15:45', '16:30'])
  assert.deepEqual(next.agenda.teams, next.agenda.weekly[day].teams)
  assert.deepEqual(next.history.map(({ teamId, team, ...record }) => record), state.history.map(({ teamId, team, ...record }) => record))
  assert(next.history.every(r => r.teamId === 'morning'))
  assert.deepEqual(unifyFridaySoloTeams(next, {}, options), next)
})

test('acompañado por la mañana y solo en la guardia: mantiene ambos equipos', () => {
  const state = fixture({ accompanied: true })
  assert.equal(unifyFridaySoloTeams(state, {}, options), state)
})

test('adelanto cargado antes de materializar la mañana reutiliza el equipo mensual individual', () => {
  const state = fixture({ onlyGuard: true, daily: false })
  const next = unifyFridaySoloTeams(state, {}, options)
  assert.equal(next.agenda.weekly[day].teams.length, 1)
  assert.equal(next.agenda.weekly[day].teams[0].teamId, 'morning')
  assert.equal(next.history[0].teamId, 'morning')
})

test('cambiar luego de acompañado a solo también unifica', () => {
  const previous = fixture({ accompanied: true })
  const state = fixture()
  state.agenda.weekly._monthlyTeams = previous.agenda.weekly._monthlyTeams
  assert.equal(unifyFridaySoloTeams(state, previous, options).agenda.weekly[day].teams.length, 1)
})

test('guardar otro módulo o una fecha pasada no reorganiza la agenda', () => {
  const state = fixture()
  assert.equal(unifyFridaySoloTeams(state, structuredClone(state), options), state)
  assert.equal(unifyFridaySoloTeams(state, {}, { today: '2026-11-21' }), state)
})

test('reconstruir con plantilla mensual no restaura el equipo eliminado', async () => {
  const { mergeStoredTeamsWithDefaults, applyRemovedWeeklyTeams } = await import('../src/features/agenda/application/agenda-model.mjs')
  const state = fixture(), next = unifyFridaySoloTeams(state, {}, options)
  const plan = next.agenda.weekly[day]
  const displayed = applyRemovedWeeklyTeams(mergeStoredTeamsWithDefaults(state.agenda.weekly._monthlyTeams['2026-11'].teams, plan.teams), plan.removedTeams)
  assert.equal(displayed.length, 1)
  assert.equal(displayed[0].tasks.length, 3)
})

test('conserva el equipo del informe iniciado y no reescribe su identidad', () => {
  const state = fixture({ daily: false })
  state.history[0] = { ...state.history[0], status: 'Completado', completedAt: `${day}T11:00:00Z`, technicalStatus: 'Completado' }
  const next = unifyFridaySoloTeams(state, {}, options)
  assert.deepEqual(next.history[0], state.history[0])
  assert.equal(next.agenda.weekly[day].teams.length, 1)
})

test('no mezcla jornadas distintas ni guardias canceladas o controles', () => {
  for (const scenario of ['hours', 'cancelled', 'control']) {
    const state = fixture()
    if (scenario === 'hours') state.agenda.weekly._workday = { exceptions: { [`${day}|guard`]: { start: '16:00', bookable: '16:00', end: '20:00' } } }
    if (scenario === 'cancelled') state.agenda.weekly[day].teams[1].tasks[0].status = 'Cancelado'
    if (scenario === 'control') state.agenda.weekly[day].teams[1].tasks[0].vehicleControl = true
    assert.equal(unifyFridaySoloTeams(state, {}, options), state)
  }
})


test('la normalización real de guardado unifica un viernes futuro', () => {
  const { normalizeStateForSave } = require('../api/_lib/core.cjs')
  const state = JSON.parse(JSON.stringify(fixture({ daily: false })).replaceAll('2026-11-20', '2099-11-20').replaceAll('2026-11', '2099-11'))
  const normalized = normalizeStateForSave(state, { history: [], agenda: {}, services: [], employees: [] })
  assert.equal(normalized.agenda.weekly['2099-11-20'].teams.length, 1)
  assert(normalized.history.every(record => record.teamId === 'morning'))
})

test('un cambio de integrantes desde la agenda diaria también se consolida', () => {
  const previous = fixture({ accompanied: true }), state = structuredClone(previous)
  state.agenda.teams[0].memberIds = [7]
  state.agenda.teams[0].members = ['Pascual']
  const next = unifyFridaySoloTeams(state, previous, options)
  assert.equal(next.agenda.weekly[day].teams.length, 1)
  assert.equal(next.agenda.teams.length, 1)
})

test('si después suma un compañero por la mañana, la guardia vuelve a quedar individual', () => {
  const previous = unifyFridaySoloTeams(fixture(), {}, options)
  const changed = structuredClone(previous)
  for (const teams of [changed.agenda.teams, changed.agenda.weekly[day].teams]) {
    teams[0].memberIds = [7, 8]; teams[0].members = ['Pascual', 'Compañero']
  }
  const next = unifyFridaySoloTeams(changed, previous, options)
  const teams = next.agenda.weekly[day].teams
  assert.equal(teams.length, 2)
  assert.deepEqual(teams[0].memberIds, [7, 8])
  assert.deepEqual(teams[0].tasks.map(task => task.time), ['08:30', '15:45'])
  assert.deepEqual(teams[1].memberIds, [7])
  assert.deepEqual(teams[1].tasks.map(task => task.time), ['16:30'])
  assert.deepEqual(next.history.find(record => record.id === 'history-guard-job').technicianIds, [7])
  assert.deepEqual(next.agenda.teams, teams)
  assert.deepEqual(unifyFridaySoloTeams(next, next, options), next)
})

test('agregar compañero desde agenda diaria separa la guardia también en la semanal', () => {
  const previous = unifyFridaySoloTeams(fixture(), {}, options)
  const changed = structuredClone(previous)
  changed.agenda.teams[0].memberIds = [7, 8]
  changed.agenda.teams[0].members = ['Pascual', 'Compañero']
  const next = unifyFridaySoloTeams(changed, previous, options)
  assert.equal(next.agenda.weekly[day].teams.length, 2)
  assert.deepEqual(next.agenda.teams, next.agenda.weekly[day].teams)
  assert.deepEqual(next.agenda.teams[1].memberIds, [7])
})
