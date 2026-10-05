const test = require('node:test')
const assert = require('node:assert/strict')
const { validateServiceTypes } = require('../api/_lib/multi-service.cjs')
const catalog = [{ id: 1, name: 'Instalación de alarma', code: 'alarm-installation' }, { id: 2, name: 'Instalación de cámaras' }, { id: 3, name: 'Service de cerco eléctrico' }]
test('multiple types share one duration and preserve legacy single-type records', async () => {
  const { multiServicePatch, serviceTypesLabel, selectedServiceIds } = await import('../src/domain/services/multi-service.mjs')
  const patch = multiServicePatch({ estimatedMinutes: 315 }, ['2', '3', '1', '2'], catalog)
  assert.equal(patch.estimatedMinutes, 315)
  assert.equal(patch.estimatedMinutesCustomized, true)
  assert.deepEqual(selectedServiceIds(patch), ['1', '2', '3'])
  assert.equal(serviceTypesLabel(patch), 'Instalación de alarma + Instalación de cámaras + Service de cerco eléctrico')
  assert.equal(serviceTypesLabel({ serviceId: 2, service: 'Instalación de cámaras' }), 'Instalación de cámaras')
  assert.equal(multiServicePatch(patch, ['1'], catalog).estimatedMinutes, 315)
})
test('weekly save creates one history entry and one task carrying all types', async () => {
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
  const { multiServicePatch } = await import('../src/domain/services/multi-service.mjs')
  const patch = multiServicePatch({ estimatedMinutes: 300 }, ['1', '2', '3'], catalog)
  const task = { taskId: 't', historyId: 'h', time: '08:30', ...patch }
  const record = { id: 'h', sourceTaskId: 't', date: '2026-10-06', ...patch }
  const snapshot = { services: catalog, customers: [], history: [], agenda: { date: '2026-10-06', teams: [], weekly: {} } }
  const ops = weeklyServiceOperations(snapshot, { day: record.date, team: { teamId: 'team', tasks: [] }, task, record })
  const result = applyStateOperations(snapshot, ops)
  assert.equal(result.history.length, 1)
  assert.equal(result.agenda.teams[0].tasks.length, 1)
  assert.deepEqual(result.history[0].serviceTypes, result.agenda.weekly[record.date].teams[0].tasks[0].serviceTypes)
  assert.doesNotThrow(() => validateServiceTypes(result))
})
test('server rejects invalid selections and completed visits protect their types', () => {
  const { assertCompletedServiceChange } = require('../api/_lib/completed-service-policy.cjs')
  const record = { serviceId: 1, serviceTypes: [{ id: 1, name: 'Instalación de alarma' }] }
  const state = record => ({ services: catalog, history: [record] })
  assert.doesNotThrow(() => validateServiceTypes(state(record)))
  assert.throws(() => validateServiceTypes(state({ ...record, serviceTypes: [] })))
  assert.throws(() => validateServiceTypes(state({ ...record, serviceTypes: [{ id: 99 }] })))
  assert.throws(() => validateServiceTypes(state({ ...record, serviceTypes: [{ id: 1 }, { id: 1 }] })))
  assert.throws(() => assertCompletedServiceChange({ ...record, status: 'Completado' }, { ...record, status: 'Completado', serviceTypes: [{ id: 1 }, { id: 2 }] }))
})

test('a multi-type visit starts once and history edits keep all types in agenda', async () => {
  const { multiServicePatch } = await import('../src/domain/services/multi-service.mjs')
  const { startTechnicianServiceRecord } = require('../api/_lib/technician-service-start.cjs')
  const { synchronizeAgendaHistoryRecord } = require('../api/_lib/history-record-operation.cjs')
  const record = { id: 'h', sourceTaskId: 't', date: '2026-10-06', time: '08:30', status: 'Pendiente', technicianIds: [1], ...multiServicePatch({ estimatedMinutes: 300 }, ['1', '2', '3'], catalog) }
  const started = startTechnicianServiceRecord(record, { id: 1, name: 'Técnico' }, '2026-10-06T12:00:00Z')
  assert.deepEqual(started.serviceTypes, record.serviceTypes)
  assert.equal(started.estimatedMinutes, 300)
  assert.equal(startTechnicianServiceRecord(started, { id: 1 }, '2026-10-06T12:10:00Z').startedAt, started.startedAt)
  const updated = { ...started, technicalStatus: 'Completado', technicalObservation: 'Se realizaron los tres trabajos.', status: 'Completado' }
  const agenda = synchronizeAgendaHistoryRecord({ teams: [{ tasks: [{ taskId: 't', historyId: 'h' }] }] }, record, updated)
  assert.deepEqual(agenda.teams[0].tasks[0].serviceTypes, record.serviceTypes)
  assert.equal(agenda.teams[0].tasks[0].status, 'Completado')
})
