const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')

test('monthly meeting uses duration; vehicle controls and ordinary services retain their rules', async () => {
  const { taskReservationMinutes } = await import('../src/domain/agenda/service-scheduling.mjs')
  assert.equal(taskReservationMinutes({ service: 'Reunión Mensual', estimatedMinutes: 15 }), 15)
  assert.equal(taskReservationMinutes({ service: ' REUNION  MENSUAL ', estimatedMinutes: 30 }), 30)
  assert.equal(taskReservationMinutes({ service: 'Service de alarma', estimatedMinutes: 15 }), 60)
  assert.equal(taskReservationMinutes({ vehicleControl: true, estimatedMinutes: 15 }), 15)
  const state = { services: [], history: [], agenda: { date: '2096-09-21', teams: [
    { teamId: 'a', memberIds: ['t'], members: ['Técnico'], tasks: [{ service: 'Reunión Mensual', time: '15:15', estimatedMinutes: 15 }] },
    { teamId: 'b', memberIds: ['t'], members: ['Técnico'], tasks: [{ service: 'Control', vehicleControl: true, time: '15:30', estimatedMinutes: 15 }] }
  ] } }
  assert.doesNotThrow(() => validateChangedAgendaSchedules(state, {}))
  state.agenda.teams[0].tasks[0].estimatedMinutes = 30
  assert.doesNotThrow(() => validateChangedAgendaSchedules(state, {}))
  state.agenda.teams[1].tasks[0].vehicleControl = false
  assert.throws(() => validateChangedAgendaSchedules(state, {}), /incompatibles/)
})

test('theme is account-scoped locally and omitted preferences do not mutate shared state', async () => {
  const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  assert.match(source, /pignus-theme-account:\$\{themeAccountKey\}/)
  assert.doesNotMatch(source, /preferences: isSupervisor|setTheme\(data.preferences.theme\)/)
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  assert.deepEqual(stateOperations({ preferences: { theme: 'dark' }, history: [] }, { history: [] }), [])
})

test('meeting-control exception is symmetric in editor and availability, without mutating tasks', async () => {
  const { serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const { availableRescheduleTeams } = await import('../src/domain/agenda/reschedule-availability.mjs')
  const meeting = { service: 'Reunión Mensual', time: '15:00', estimatedMinutes: 60 }
  const control = { service: 'Control', vehicleControl: true, time: '15:30', estimatedMinutes: 15, status: 'Pendiente' }
  const original = structuredClone(control)
  assert.equal(serviceScheduleConflicts([{ tasks: [meeting, control] }]).length, 0)
  for (const [record, task] of [[meeting, control], [control, meeting]]) {
    assert.equal(availableRescheduleTeams([{ teamId: 'a', memberIds: ['t'], tasks: [task] }], record, '2096-09-21', record.time).length, 1)
  }
  assert.equal(serviceScheduleConflicts([{ tasks: [meeting, { ...control, vehicleControl: false }] }]).length, 1)
  assert.deepEqual(control, original)
})
