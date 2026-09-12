const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { removeHistoryRecord } = require('../api/_lib/history-record-removal.cjs')

const team = tasks => ({
  teamId: 'team-2',
  label: 'Equipo 2',
  memberIds: ['santos'],
  members: ['Santos'],
  tasks
})

test('omite un control y elimina su pendiente de todas las proyecciones en una sola operación', async () => {
  const { weeklyTaskRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const control = { taskId: 'control-partner', historyId: 'history-partner', time: '15:30', vehicleControl: true }
  const other = { taskId: 'other-task', historyId: 'other-history', time: '11:00' }
  const snapshot = {
    roles: [], employees: [], services: [], vehicles: [], customers: [], reviews: [], preferences: {},
    history: [
      { id: 'history-partner', sourceTaskId: 'control-partner', status: 'Pendiente' },
      { id: 'other-history', sourceTaskId: 'other-task', status: 'Pendiente' }
    ],
    agenda: {
      date: '2026-09-11',
      teams: [team(structuredClone([other, control]))],
      weekly: { '2026-09-11': { teams: [team(structuredClone([other, control]))], removedTaskIds: [] } }
    }
  }

  const operations = weeklyTaskRemovalOperations(snapshot, {
    day: '2026-09-11', teamId: 'team-2', teamIndex: 0, taskId: control.taskId,
    historyId: control.historyId, taskIndex: 1, time: '15:30'
  })
  assert.ok(operations.length < 8)
  assert.equal(operations.some(item => item.path[0] === 'customers'), false)
  assert.equal(operations.some(item => item.path.length === 1), false)

  const next = applyStateOperations(snapshot, operations)
  assert.deepEqual(next.agenda.weekly['2026-09-11'].teams[0].tasks, [other])
  assert.deepEqual(next.agenda.teams[0].tasks, [other])
  assert.deepEqual(next.history.map(record => record.id), ['other-history'])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].removedTaskIds, ['task:control-partner', 'history:history-partner'])
  assert.deepEqual(applyStateOperations(next, operations), next)
})

test('la baja puntual conserva historiales cerrados y conflictos concurrentes', async () => {
  const { weeklyTaskRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const task = { taskId: 'service-1', historyId: 'history-1', time: '10:00', detail: 'Original' }
  const snapshot = {
    history: [{ id: 'history-1', sourceTaskId: 'service-1', status: 'Completado' }],
    agenda: { weekly: { '2026-09-11': { teams: [team([task])] } } }
  }
  const command = { day: '2026-09-11', teamId: 'team-2', teamIndex: 0, taskId: 'service-1', historyId: 'history-1', taskIndex: 0 }
  const operations = weeklyTaskRemovalOperations(snapshot, command)
  const next = applyStateOperations(snapshot, operations)
  assert.deepEqual(next.history, snapshot.history)
  assert.deepEqual(next.agenda.weekly['2026-09-11'].teams[0].tasks, [])

  const concurrent = structuredClone(snapshot)
  concurrent.agenda.weekly['2026-09-11'].teams[0].tasks[0].detail = 'Cambio de otra sesión'
  assert.throws(() => applyStateOperations(concurrent, operations), error => error.statusCode === 409 && error.code === 'RECORD_WRITE_CONFLICT')
})

test('el costo de preparar la omisión no depende del padrón de abonados', async () => {
  const { weeklyTaskRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const control = { taskId: 'control-partner', historyId: 'history-partner', vehicleControl: true }
  const snapshot = {
    customers: Array.from({ length: 20_000 }, (_, index) => ({ customerId: `customer-${index}`, name: `Abonado ${index}` })),
    history: [{ id: 'history-partner', sourceTaskId: 'control-partner', status: 'Pendiente' }],
    agenda: { weekly: { '2026-09-11': { teams: [team([control])] } } }
  }
  const operations = weeklyTaskRemovalOperations(snapshot, { day: '2026-09-11', teamId: 'team-2', teamIndex: 0, taskId: control.taskId, historyId: control.historyId, taskIndex: 0 })
  assert.equal(operations.some(item => item.path[0] === 'customers'), false)
  assert.equal(JSON.stringify(operations).includes('Abonado 19999'), false)
})

test('elimina desde Historial un control vencido y deja la excepción semanal persistente', async () => {
  const { historyRecordRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const control = { taskId: 'control-kangoo', historyId: 'history-kangoo', time: '15:30', vehicleControl: true }
  const record = { id: 'history-kangoo', sourceTaskId: 'control-kangoo', date: '2026-09-11', status: 'Pendiente', vehicleControl: true }
  const snapshot = {
    history: [record],
    agenda: {
      date: '2026-09-12',
      teams: [],
      weekly: { '2026-09-11': { teams: [team([control])], removedTaskIds: [] } }
    }
  }

  const operations = historyRecordRemovalOperations(snapshot, record)
  const next = applyStateOperations(snapshot, operations)
  assert.deepEqual(next.history, [])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].teams[0].tasks, [])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].removedTaskIds, ['task:control-kangoo', 'history:history-kangoo'])
  assert.deepEqual(applyStateOperations(next, operations), next)
})

test('elimina desde Historial un control cuya tarjeta semanal ya no existe sin que se regenere', async () => {
  const { historyRecordRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const record = { id: 'history-partner', sourceTaskId: 'control-partner', date: '2026-09-11', status: 'Pendiente', vehicleControl: true }
  const snapshot = {
    history: [record],
    agenda: { weekly: { '2026-09-11': { teams: [team([])], removedTaskIds: [] } } }
  }
  const next = applyStateOperations(snapshot, historyRecordRemovalOperations(snapshot, record))
  assert.deepEqual(next.history, [])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].removedTaskIds, ['task:control-partner', 'history:history-partner'])
})

test('elimina un control heredado aunque sus identificadores ya no coincidan', async () => {
  const { historyRecordRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
  const record = { id: 'legacy-history', sourceTaskId: 'obsolete-task', date: '2026-09-11', time: '15:30', vehicleControl: true, vehicleId: 'kangoo', client: 'Renault Kangoo' }
  const control = { taskId: 'current-task', historyId: 'current-history', time: '15:30', vehicleControl: true, vehicleId: 'kangoo', client: 'Renault Kangoo' }
  const snapshot = {
    history: [record],
    agenda: { weekly: { '2026-09-11': { teams: [team([control])], removedTaskIds: [] } } }
  }

  const next = applyStateOperations(snapshot, historyRecordRemovalOperations(snapshot, record))

  assert.deepEqual(next.history, [])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].teams[0].tasks, [])
  assert.deepEqual(next.agenda.weekly['2026-09-11'].removedTaskIds, ['task:current-task', 'history:current-history'])
})

test('la eliminación autoritativa ignora nombres desalineados y retira todas las proyecciones', () => {
  const record = { id: 'history-kangoo', sourceTaskId: 'control-kangoo', date: '2026-09-11', vehicleControl: true, vehicleId: 'kangoo', technicianIds: ['rodrigo'], technicians: ['Pascual'] }
  const task = { taskId: 'control-kangoo', historyId: 'history-kangoo', vehicleControl: true, vehicleId: 'kangoo', technicianIds: ['rodrigo'], technicians: ['Rodrigo'] }
  const snapshot = {
    history: [record],
    agenda: {
      date: '2026-09-11', teams: [team([task])],
      weekly: { '2026-09-11': { teams: [team([task])], removedTaskIds: [] } }
    }
  }

  const result = removeHistoryRecord(snapshot, record.id)

  assert.equal(result.changed, true)
  assert.deepEqual(result.state.history, [])
  assert.deepEqual(result.state.agenda.teams[0].tasks, [])
  assert.deepEqual(result.state.agenda.weekly['2026-09-11'].teams[0].tasks, [])
  assert.deepEqual(result.state.agenda.weekly['2026-09-11'].removedTaskIds.sort(), ['history:history-kangoo', 'task:control-kangoo'].sort())
})
