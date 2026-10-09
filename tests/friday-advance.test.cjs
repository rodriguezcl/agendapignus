const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const saturday = '2026-10-10'
const friday = '2026-10-09'
const fixture = () => {
  const task = { taskId: 'task', historyId: 'record', client: 'Cliente', service: 'Instalación', time: '08:30', estimatedMinutes: 90, detail: 'Conservar observaciones', photoUrl: '/photo.jpg' }
  const team = { teamId: 'saturday', memberIds: ['rodrigo'], members: ['Rodrigo'], tasks: [task, { taskId: 'other', client: 'Otro cliente', time: '11:00' }] }
  const history = [{ ...task, id: 'record', sourceTaskId: 'task', date: saturday, teamId: team.teamId, technicianIds: ['rodrigo'], technicians: ['Rodrigo'], status: 'Pendiente', extra: { preserve: true } }]
  return { task, team, state: { history, agenda: { date: saturday, teams: [structuredClone(team)], weekly: { [saturday]: { teams: [team] } } } } }
}
const prepare = async () => {
  const { fridayAdvanceDestination } = await import('../src/domain/agenda/friday-advance.mjs')
  const { weeklyServiceMoveOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const data = fixture()
  const target = fridayAdvanceDestination(saturday, data.team, {}, friday)
  const command = { advanceToFriday: true, sourceDay: saturday, sourceTeamId: data.team.teamId, day: friday, team: target.team,
    task: { ...data.task, time: '16:00' }, record: { ...data.state.history[0], date: friday, time: '16:00', teamId: target.team.teamId } }
  return { ...data, command, move: weeklyServiceMoveOperations }
}
test('adelanta sin duplicar historial, conserva detalles y otros servicios y crea equipo individual', async () => {
  const { state, command, move } = await prepare()
  const next = applyStateOperations(state, move(state, command))
  assert.equal(next.history.length, 1)
  assert.equal(next.history[0].id, 'record')
  assert.equal(next.history[0].date, friday)
  assert.deepEqual(next.history[0].extra, { preserve: true })
  assert.equal(next.history[0].photoUrl, '/photo.jpg')
  assert.deepEqual(next.agenda.weekly[friday].teams[0].memberIds, ['rodrigo'])
  assert.equal(next.agenda.weekly[friday].teams[0].tasks[0].detail, 'Conservar observaciones')
  for (const teams of [next.agenda.teams, next.agenda.weekly[saturday].teams]) assert.deepEqual(teams[0].tasks.map(t => t.taskId), ['other'])
  assert.equal(state.agenda.weekly[saturday].teams[0].tasks.length, 2)
})
test('reutiliza solamente equipos individuales del mismo técnico', async () => {
  const { fridayAdvanceDestination: destination } = await import('../src/domain/agenda/friday-advance.mjs')
  const { team } = fixture()
  const duo = { teamId: 'duo', memberIds: ['rodrigo', 'santos'], members: ['Rodrigo', 'Santos'] }
  const solo = { teamId: 'solo', memberIds: ['rodrigo'], members: ['Rodrigo'], tasks: [] }
  assert.equal(destination(saturday, team, { teams: [duo] }, friday).plan.teams.length, 2)
  assert.equal(destination(saturday, team, { teams: [duo, solo] }, friday).team.teamId, 'solo')
  assert.throws(() => destination(saturday, team, {}, saturday), /ya pasó/)
  assert.throws(() => destination(friday, team, {}, friday), /sábado/)
})
test('rechaza cambios concurrentes de guardia sin perder el servicio original', async () => {
  const { state, command, move } = await prepare()
  const operations = move(state, command)
  state.agenda.weekly[saturday].teams[0].memberIds = ['santos']
  assert.throws(() => applyStateOperations(state, operations), error => error.code === 'RECORD_WRITE_CONFLICT')
  assert.equal(state.history[0].date, saturday)
  assert.throws(() => move(state, command), /técnico/)
})
test('rechaza horarios fuera de guardia y servicios cerrados', async () => {
  const { state, command, move } = await prepare()
  command.task.time = '15:00'
  assert.throws(() => move(state, command), /16:00/)
  command.task.time = '20:00'
  assert.throws(() => move(state, command), /20:00/)
  command.task.time = '19:00'
  assert.throws(() => move(state, command), /20:00/)
  command.task.time = '16:00'
  state.history[0].status = 'Completado'
  assert.throws(() => move(state, command), /pendientes/)
})
test('un servicio de Rodrigo en otro equipo del viernes impide el solapamiento', async () => {
  const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
  const { state, command, move } = await prepare()
  // Future dates make this independent of the current clock.
  command.sourceDay = '2099-10-10'
  command.day = '2099-10-09'
  state.agenda.weekly[command.sourceDay] = state.agenda.weekly[saturday]
  delete state.agenda.weekly[saturday]
  state.history[0].date = command.sourceDay
  command.record.date = command.day
  state.agenda.date = command.sourceDay
  state.agenda.weekly[command.day] = { teams: [{ teamId: 'duo', memberIds: ['rodrigo', 'santos'], members: ['Rodrigo', 'Santos'], tasks: [{ taskId: 'overlap', service: 'Visita', time: '16:00', estimatedMinutes: 90 }] }] }
  const next = applyStateOperations(state, move(state, command))
  assert.throws(() => validateChangedAgendaSchedules(next, state), /incompatibles/)
})
