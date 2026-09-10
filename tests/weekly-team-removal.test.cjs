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

test('elimina un equipo y sus pendientes en una sola operación atómica e idempotente', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  const pendingTask = { taskId: 'task-santos', historyId: 'history-santos', service: 'Servicio de alarma' }
  const completedTask = { taskId: 'task-completed', historyId: 'history-completed', service: 'Instalación de alarma' }
  const teams = [team('team-1', 1, 'Pascual'), team('team-2', 2, 'Santos', [pendingTask, completedTask]), team('team-3', 3, 'Leonardo')]
  const snapshot = {
    roles: [], employees: [], services: [], vehicles: [], customers: [], reviews: [], preferences: {},
    history: [
      { id: 'history-santos', sourceTaskId: 'task-santos', status: 'Pendiente' },
      { id: 'history-completed', sourceTaskId: 'task-completed', status: 'Completado' },
      { id: 'history-other', sourceTaskId: 'task-other', status: 'Pendiente' }
    ],
    agenda: { date: '2026-09-11', teams: structuredClone(teams), weekly: { '2026-09-11': { teams: structuredClone(teams), removedTeams: [] } } }
  }

  const operations = weeklyTeamRemovalOperations(snapshot, { day: '2026-09-11', teamId: 'team-2', teamIndex: 1 })
  assert.ok(operations.length < 12)
  assert.equal(operations.some(item => item.path[0] === 'customers'), false)
  assert.equal(operations.some(item => item.path.length === 1), false)
  const next = applyStateOperations(snapshot, operations)
  assert.deepEqual(next.agenda.weekly['2026-09-11'].teams.map(item => [item.teamId, item.label]), [['team-1', 'Equipo 1'], ['team-3', 'Equipo 2']])
  assert.deepEqual(next.agenda.teams.map(item => item.teamId), ['team-1', 'team-3'])
  assert.deepEqual(next.history.map(record => record.id), ['history-completed', 'history-other'])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].removedTeams, [{ id: 'team:team-2', teamId: 'team-2', teamNumber: 2 }])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].removedTaskIds, [
    'task:task-santos', 'history:history-santos', 'task:task-completed', 'history:history-completed'
  ])
  assert.deepEqual(applyStateOperations(next, operations), next)
})

test('el costo de preparar la baja no depende del padrón de abonados', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  const target = team('team-2', 2, 'Santos', [{ taskId: 'task-santos', historyId: 'history-santos' }])
  const snapshot = {
    customers: Array.from({ length: 20_000 }, (_, index) => ({ customerId: `customer-${index}`, name: `Abonado ${index}` })),
    history: [{ id: 'history-santos', sourceTaskId: 'task-santos', status: 'Pendiente' }],
    agenda: { weekly: { '2026-09-11': { teams: [target] } } }
  }
  const operations = weeklyTeamRemovalOperations(snapshot, { day: '2026-09-11', teamId: 'team-2', teamIndex: 0 })
  assert.equal(operations.some(item => item.path[0] === 'customers'), false)
  assert.equal(JSON.stringify(operations).includes('Abonado 19999'), false)
})

test('rechaza la baja si otra sesión modificó el equipo antes de confirmar', async () => {
  const { weeklyTeamRemovalOperations } = await import('../src/features/state/application/weekly-team-removal.mjs')
  const target = team('team-2', 2, 'Santos', [{ taskId: 'task-santos', historyId: 'history-santos', detail: 'Original' }])
  const snapshot = { history: [{ id: 'history-santos', sourceTaskId: 'task-santos', status: 'Pendiente' }], agenda: { weekly: { '2026-09-11': { teams: [target] } } } }
  const operations = weeklyTeamRemovalOperations(snapshot, { day: '2026-09-11', teamId: 'team-2', teamIndex: 0 })
  const concurrent = structuredClone(snapshot)
  concurrent.agenda.weekly['2026-09-11'].teams[0].tasks[0].detail = 'Cambiado por otra sesión'
  assert.throws(() => applyStateOperations(concurrent, operations), error => error.statusCode === 409 && error.code === 'RECORD_WRITE_CONFLICT')
})
