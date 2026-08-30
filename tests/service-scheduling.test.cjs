const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeStateForSave, validateState } = require('../api/_lib/core.cjs')

test('usa la duración real y conserva la reserva operativa mínima', async () => {
  const { serviceScheduleConflicts, taskOccupiedInterval } = await import('../src/service-scheduling.mjs')
  const team = tasks => [{ tasks }]

  assert.equal(taskOccupiedInterval({ time: '09:00', estimatedMinutes: 30 }).endTime, '10:00')
  assert.equal(taskOccupiedInterval({ time: '09:00', estimatedMinutes: 120 }).endTime, '11:00')
  const minimumConflict = serviceScheduleConflicts(team([
    { serviceId: 'a', time: '09:00', estimatedMinutes: 30 },
    { serviceId: 'b', time: '09:45', estimatedMinutes: 30 }
  ]))[0]
  assert.equal(minimumConflict.firstTask.serviceId, 'a')
  assert.equal(minimumConflict.secondTask.serviceId, 'b')
  assert.equal(serviceScheduleConflicts(team([
    { serviceId: 'a', time: '09:00', estimatedMinutes: 120 },
    { serviceId: 'b', time: '10:30', estimatedMinutes: 60 }
  ])).length, 1)
  assert.equal(serviceScheduleConflicts(team([
    { serviceId: 'a', time: '09:00', estimatedMinutes: 120 },
    { serviceId: 'b', time: '11:00', estimatedMinutes: 60 }
  ])).length, 0)
})

test('oculta horarios predeterminados que caen dentro de una franja ocupada', async () => {
  const { removeOverlappingDefaultSlots } = await import('../src/service-scheduling.mjs')
  const tasks = removeOverlappingDefaultSlots([
    { serviceId: 'a', time: '09:00', estimatedMinutes: 360 },
    { time: '14:00' },
    { time: '16:00' }
  ])
  assert.deepEqual(tasks.map(task => task.time), ['09:00', '16:00'])
})

test('copia el valor del catálogo a registros antiguos y conserva ajustes particulares', () => {
  const service = { id: 's1', code: 's1', name: 'Instalación de cámaras', description: '', estimatedMinutes: 180, status: 'Activo' }
  const base = {
    roles: [], employees: [], services: [service], vehicles: [], customers: [], reviews: [],
    history: [{ id: 'h1', serviceId: 's1', service: service.name }, { id: 'h2', serviceId: 's1', service: service.name, estimatedMinutes: 300 }],
    agenda: { teams: [{ tasks: [{ serviceId: 's1', service: service.name }, { serviceId: 's1', service: service.name, estimatedMinutes: 240 }] }], weekly: {} }
  }
  const normalized = normalizeStateForSave(base, { reviews: [] })
  assert.equal(normalized.history[0].estimatedMinutes, 180)
  assert.equal(normalized.history[1].estimatedMinutes, 300)
  assert.equal(normalized.agenda.teams[0].tasks[0].estimatedMinutes, 180)
  assert.equal(normalized.agenda.teams[0].tasks[1].estimatedMinutes, 240)
})

test('la API rechaza duraciones inválidas y solapamientos por equipo', () => {
  const service = { id: 's1', code: 's1', name: 'Servicio', description: '', estimatedMinutes: 60, status: 'Activo' }
  const base = { roles: [], employees: [], services: [service], vehicles: [], customers: [], history: [], agenda: { weekly: {} } }
  assert.throws(() => validateState({ ...base, agenda: { teams: [{ tasks: [{ serviceId: 's1', time: '09:00', estimatedMinutes: 0 }] }], weekly: {} } }), /tiempo estimado/)
  assert.throws(() => validateState({ ...base, agenda: { teams: [{ tasks: [
    { serviceId: 's1', time: '09:00', estimatedMinutes: 120 },
    { serviceId: 's1', time: '10:30', estimatedMinutes: 60 }
  ] }], weekly: {} } }), /se superponen/)
})
