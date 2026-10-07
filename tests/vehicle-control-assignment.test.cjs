const test = require('node:test')
const assert = require('node:assert/strict')
const { synchronizeVehicleControlAssignments: sync } = require('../api/_lib/vehicle-control-assignment.cjs')

test('repairs an existing future misplaced control without changing responsibility or monthly rotation', () => {
  const state = fixture(), day = '2099-01-09'
  const plan = state.agenda.weekly[state.agenda.date]
  state.agenda.weekly = { ...state.agenda.weekly, [day]: plan }
  delete state.agenda.weekly[state.agenda.date]
  state.agenda.date = day; state.history[0].date = day
  plan.teams.push({ teamId: 'leo-team', label: 'Equipo 2', memberIds: ['leo'], members: ['Leonardo'], tasks: [] })
  state.agenda.teams = structuredClone(plan.teams)
  const result = sync(state, state)
  assert.equal(result.history[0].teamId, 'leo-team')
  assert.equal(result.agenda.weekly[day].teams[1].tasks.length, 1)
  assert.deepEqual(result.agenda.weekly._monthlyTeams, state.agenda.weekly._monthlyTeams)
  assert.deepEqual(sync(result, result), result)
})

for (const daily of [false, true]) test(`moves pending control with its responsible technician after ${daily ? 'daily' : 'weekly'} staffing changes`, () => {
  const previous = fixture()
  const day = previous.agenda.date
  const first = previous.agenda.weekly[day].teams[0]
  first.memberIds = ['leo']; first.members = ['Leonardo']
  const second = { teamId: 't2', label: 'Equipo 2', memberIds: ['mariano'], members: ['Mariano'], tasks: [{ taskId: 'ordinary', client: 'Cliente', time: '09:00' }] }
  previous.agenda.weekly[day].teams.push(second)
  previous.agenda.teams = structuredClone(previous.agenda.weekly[day].teams)
  const edited = structuredClone(previous)
  const teams = daily ? edited.agenda.teams : edited.agenda.weekly[day].teams
  teams[0].memberIds = ['mariano']; teams[0].members = ['Mariano']
  teams[1].memberIds = ['leo']; teams[1].members = ['Leonardo']
  const result = sync(edited, previous)
  assert.equal(result.history[0].teamId, 't2')
  assert.deepEqual(result.history[0].technicianIds, ['leo'])
  for (const plan of [result.agenda, result.agenda.weekly[day]]) {
    assert.equal(plan.teams[0].tasks.length, 0)
    assert.equal(plan.teams[1].tasks.filter(task => task.vehicleControl).length, 1)
    assert.ok(plan.teams[1].tasks.some(task => task.taskId === 'ordinary'))
  }
  assert.deepEqual(result.agenda.weekly._monthlyTeams, previous.agenda.weekly._monthlyTeams)
  assert.deepEqual(sync(result, result), result)
  assert.equal(previous.agenda.teams[0].tasks.length, 1)
  const started = structuredClone(edited)
  started.history[0].startedAt = '2026-09-18T15:00:00Z'
  const protectedResult = sync(started, previous)
  assert.deepEqual(protectedResult.history, started.history)
  assert.equal(protectedResult.agenda.weekly[day].teams[0].tasks.length, 1)
})
const fixture = () => {
  const task = { taskId: 'control', historyId: 'control', vehicleControl: true, technicianIds: ['leo'], technicians: ['Leonardo'] }
  const team = { teamId: 't3', label: 'Equipo 3', memberIds: ['mariano'], members: ['Mariano'], tasks: [task] }
  return { history: [{ ...task, id: 'control', sourceTaskId: 'control', date: '2026-09-18', vehicleId: 'ka', status: 'Pendiente' }],
    agenda: { date: '2026-09-18', teams: [structuredClone(team)], weekly: {
      '2026-09-18': { teams: [team] }, _monthlyTeams: { '2026-09': { vehicleAssignments: [{ vehicleId: 'ka', technicianId: 'leo' }] } }
    } } }
}
test('explicit replacement updates history and both agendas, only for this Friday', () => {
  const state = fixture(), edited = structuredClone(state)
  edited.history[0].technicianIds = ['mariano']; edited.history[0].technicians = ['Mariano']
  const next = sync(edited, state)
  assert.deepEqual(next.history[0].technicianIds, ['mariano'])
  assert.deepEqual(next.agenda.teams[0].tasks[0].technicianIds, ['mariano'])
  assert.deepEqual(next.agenda.weekly['2026-09-18'].teams[0].tasks[0].technicianIds, ['mariano'])
  const assignment = next.agenda.weekly._monthlyTeams['2026-09'].vehicleAssignments[0]
  assert.equal(assignment.technicianId, 'leo')
  assert.deepEqual(assignment.weeklyOverrides, { '2026-09-18': 'mariano' })
  assert.deepEqual(sync(next, next), next)
  assert.deepEqual(state.history[0].technicianIds, ['leo'])
})
test('does not rewrite completed controls, recreate removals or guess among multiple replacements', () => {
  for (const status of ['Completado', 'Cancelado', 'Reprogramado']) {
    const state = fixture(); state.history[0].status = status
    assert.deepEqual(sync(state, state), state)
  }
  const removed = fixture(); removed.history = []
  assert.deepEqual(sync(removed, removed).history, [])
  const ambiguous = fixture()
  ambiguous.agenda.weekly['2026-09-18'].teams[0].memberIds.push('santos')
  assert.deepEqual(sync(ambiguous, ambiguous).history[0].technicianIds, ['leo'])
})
test('daily membership edits also synchronize the control', () => {
  const previous = fixture()
  previous.agenda.teams[0].memberIds = ['leo']; previous.agenda.teams[0].members = ['Leonardo']
  previous.agenda.weekly['2026-09-18'].teams = structuredClone(previous.agenda.teams)
  const next = structuredClone(previous)
  next.agenda.teams[0].memberIds = ['mariano']; next.agenda.teams[0].members = ['Mariano']
  const result = sync(next, previous)
  assert.deepEqual(result.history[0].technicianIds, ['mariano'])
  assert.deepEqual(sync(result, result), result)
})
