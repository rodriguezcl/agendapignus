const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')

const team = (id, number, technician, tasks = []) => ({
  teamId: id,
  label: `Equipo ${number}`,
  memberIds: [technician.toLowerCase()],
  members: [technician],
  tasks
})

test('administrador puede omitir el único control pendiente, pero no uno completado ni otros servicios', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  const record = { id: 'control', sourceTaskId: 'control-task', teamId: 't', date: '2026-09-25', vehicleControl: true, status: 'Pendiente' }
  const target = team('t', 1, 'Santos', [{ ...record, taskId: record.sourceTaskId, historyId: record.id }])
  const snapshot = { history: [record], agenda: { date: record.date, teams: [target], weekly: { [record.date]: { teams: [target] } } } }
  const command = { day: record.date, teamId: 't', allowVehicleControlRemoval: true }
  assert.throws(() => weeklyTeamRemovalOperations(snapshot, { ...command, allowVehicleControlRemoval: false }), /No se puede eliminar/)
  const operations = weeklyTeamRemovalOperations(snapshot, command)
  const next = applyStateOperations(snapshot, operations)
  assert.deepEqual(next.history, [])
  assert.deepEqual(next.agenda.teams, [])
  const { authorizeIncomingState } = require('../api/_lib/core.cjs')
  assert.throws(() => authorizeIncomingState(next, snapshot, { roleCode: 'user', permissions: { weekly: true } }), error => error.statusCode === 403)
  assert.ok(next.agenda.weekly[record.date].removedTaskIds.includes('history:control'))
  const completed = structuredClone(snapshot)
  completed.history[0].status = 'Completado'
  assert.throws(() => weeklyTeamRemovalOperations(completed, command), /No se puede eliminar/)
  assert.throws(() => applyStateOperations(completed, operations), error => error.code === 'TEAM_HAS_SERVICES')
  const mixed = structuredClone(snapshot)
  mixed.agenda.weekly[record.date].teams[0].tasks.push({ taskId: 'other', service: 'Alarma' })
  assert.throws(() => weeklyTeamRemovalOperations(mixed, command), /No se puede eliminar/)
})

test('quita un equipo mensual con técnicos aunque el día sólo haya materializado otro equipo', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  const target = team('monthly-1', 1, 'Santos')
  const other = team('monthly-2', 2, 'Pascual')
  const snapshot = { history: [], agenda: { date: '2026-09-25', teams: [other], weekly: { '2026-09-25': { teams: [other] } } } }
  const command = { day: '2026-09-25', teamId: target.teamId, teamIndex: 0, fallbackPlan: { teams: [target, other] } }
  const next = applyStateOperations(snapshot, weeklyTeamRemovalOperations(snapshot, command))
  assert.deepEqual(next.agenda.teams, [other])
  assert.deepEqual(next.agenda.weekly[command.day].teams, [other])
  assert.equal(next.agenda.weekly[command.day].removedTeams[0].teamId, target.teamId)
  assert.deepEqual(weeklyTeamRemovalOperations(next, command), [])
})

test('baja diaria elimina la asignación y materializa la exclusión mensual sin tocar otros días', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  const target = team('monthly-1', 1, 'Santos')
  const snapshot = { history: [], agenda: { date: '2026-09-25', teams: [target], weekly: { '2026-09-24': { teams: [target] } } } }
  const next = applyStateOperations(snapshot, weeklyTeamRemovalOperations(snapshot, { day: '2026-09-25', teamId: target.teamId, teamIndex: 0, fallbackPlan: { teams: [target] } }))
  assert.deepEqual(next.agenda.teams, [])
  assert.deepEqual(next.agenda.weekly['2026-09-25'].teams, [])
  assert.deepEqual(next.agenda.weekly['2026-09-24'], snapshot.agenda.weekly['2026-09-24'])
})


test('bloquea servicios pendientes, completados y controles sin eliminar historial', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  for (const status of ['Pendiente', 'Completado', 'Cancelado']) {
    const target = team('t', 1, 'Santos', [{ taskId: 'job', service: 'Alarma', status }])
    const snapshot = { history: [], agenda: { weekly: { '2026-09-25': { teams: [target] } } } }
    assert.throws(() => weeklyTeamRemovalOperations(snapshot, { day: '2026-09-25', teamId: 't' }), /No se puede eliminar/)
  }
})

test('protege historial aunque la tarjeta esté ausente y bloquea servicios concurrentes en servidor', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  const target = team('t', 1, 'Santos', [{ taskId: 'slot', time: '14:00' }])
  const snapshot = { history: [], agenda: { weekly: { '2026-09-25': { teams: [target] } } } }
  const command = { day: '2026-09-25', teamId: 't' }
  const operations = weeklyTeamRemovalOperations(snapshot, command)
  const next = applyStateOperations(snapshot, operations)
  assert.deepEqual(next.history, [])
  assert.deepEqual(next.agenda.weekly[command.day].teams, [])
  assert.deepEqual(applyStateOperations(next, operations), next)
  const concurrent = structuredClone(snapshot)
  concurrent.history.push({ id: 'job', teamId: 't', date: command.day, status: 'Completado' })
  assert.throws(() => weeklyTeamRemovalOperations(concurrent, command), /No se puede eliminar/)
  assert.throws(() => applyStateOperations(concurrent, operations), error => error.code === 'TEAM_HAS_SERVICES')
})
