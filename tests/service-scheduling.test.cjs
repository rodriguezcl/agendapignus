const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeStateForSave, validateState } = require('../api/_lib/core.cjs')
const { agendaTaskIsResolvedForPlanning } = require('../api/_lib/scheduling-validation.cjs')

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

test('los servicios completados y los cancelados de fechas pasadas no participan en conflictos de agenda', () => {
  const service = { id: 's1', code: 's1', name: 'Servicio', description: '', estimatedMinutes: 120, status: 'Activo' }
  const completed = { id: 'h1', sourceTaskId: 'done', date: '2000-01-01', serviceId: 's1', customerId: 'c1', time: '09:00', status: 'Completado', estimatedMinutes: 120 }
  const cancelled = { id: 'h2', sourceTaskId: 'cancelled', date: '2000-01-01', serviceId: 's1', customerId: 'c3', time: '09:15', status: 'Cancelado', estimatedMinutes: 120 }
  const state = {
    roles: [], employees: [], services: [service], vehicles: [], customers: [
      { customerId: 'c1', account: 'CLI-001' },
      { customerId: 'c2', account: 'CLI-002' },
      { customerId: 'c3', account: 'CLI-003' }
    ], history: [completed, cancelled],
    agenda: { date: '2000-01-01', teams: [{ teamId: 'team-1', tasks: [
      { taskId: 'done', historyId: 'h1', serviceId: 's1', customerId: 'c1', time: '09:00', estimatedMinutes: 120 },
      { taskId: 'cancelled', historyId: 'h2', serviceId: 's1', customerId: 'c3', time: '09:15', estimatedMinutes: 120 },
      { taskId: 'pending', serviceId: 's1', customerId: 'c2', time: '09:30', estimatedMinutes: 60 }
    ] }], weekly: {} }
  }
  assert.doesNotThrow(() => validateState(state))
  assert.equal(agendaTaskIsResolvedForPlanning({ taskId: 'cancelled' }, '2026-08-28', [{ ...cancelled, date: '2026-08-28' }], '2026-08-30'), true)
  assert.equal(agendaTaskIsResolvedForPlanning({ taskId: 'cancelled' }, '2026-08-30', [{ ...cancelled, date: '2026-08-30' }], '2026-08-30'), false)
  assert.equal(agendaTaskIsResolvedForPlanning({ taskId: 'cancelled' }, '2026-08-28', [{ ...cancelled, date: '2026-08-28', status: 'Pendiente' }], '2026-08-30'), false)
})

test('los solapamientos históricos sin cambios no bloquean otro día y el mensaje usa fecha y equipo reales', () => {
  const service = { id: 's1', code: 's1', name: 'Servicio', description: '', estimatedMinutes: 60, status: 'Activo' }
  const legacyPlan = { teams: [{ teamId: 'legacy-team', label: 'Equipo 1', memberIds: [], tasks: [
    { taskId: 'old-a', serviceId: 's1', service: 'Servicio', time: '08:30', estimatedMinutes: 60 },
    { taskId: 'old-b', serviceId: 's1', service: 'Servicio', time: '08:30', estimatedMinutes: 60 }
  ] }] }
  const previous = { roles: [], employees: [], services: [service], vehicles: [], customers: [], history: [], agenda: { date: '2026-08-27', teams: [], weekly: { '2026-02-03': legacyPlan } } }
  const next = structuredClone(previous)
  next.agenda.teams = [{ teamId: 'current-team', label: 'Equipo 1', memberIds: [], tasks: [{ taskId: 'new', serviceId: 's1', service: 'Servicio', time: '10:00', estimatedMinutes: 60 }] }]
  assert.doesNotThrow(() => validateState(next, previous))

  next.agenda.weekly['2026-02-03'].teams[0].tasks[1].estimatedMinutes = 120
  assert.throws(() => validateState(next, previous), /Agenda semanal 03\/02\/2026, Equipo 1: las franjas de 08:30 y 08:30 se superponen/)
})
