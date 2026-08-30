const test = require('node:test')
const assert = require('node:assert/strict')
const { assertServiceCanBeCompleted, normalizeHistoryCompletionTimes, normalizeStateForSave, validateState } = require('../api/_lib/core.cjs')
const { agendaTaskIsResolvedForPlanning, completedReleaseMinute } = require('../api/_lib/scheduling-validation.cjs')

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

test('una finalización anticipada libera el equipo en el siguiente cuarto de hora', async () => {
  const { serviceScheduleConflicts, taskOccupiedInterval } = await import('../src/service-scheduling.mjs')
  const completed = { serviceId: 'a', date: '2026-08-30', time: '08:30', estimatedMinutes: 150, status: 'Completado', completedAt: '2026-08-30T13:02:10.000Z' }
  const interval = taskOccupiedInterval(completed)
  assert.equal(interval.completedTime, '10:02')
  assert.equal(interval.releaseTime, '10:15')
  assert.equal(interval.endTime, '10:15')
  assert.equal(completedReleaseMinute(completed), 10 * 60 + 15)
  assert.equal(serviceScheduleConflicts([{ tasks: [completed, { serviceId: 'b', time: '10:00', estimatedMinutes: 60 }] }]).length, 1)
  assert.equal(serviceScheduleConflicts([{ tasks: [completed, { serviceId: 'b', time: '10:15', estimatedMinutes: 60 }] }]).length, 0)
})

test('la ventana liberada sólo admite un nuevo servicio que termine antes del siguiente', async () => {
  const { serviceScheduleConflicts } = await import('../src/service-scheduling.mjs')
  const completed = { serviceId: 'a', date: '2026-08-30', time: '08:30', estimatedMinutes: 150, status: 'Completado', completedAt: '2026-08-30T13:02:10.000Z' }
  const next = { serviceId: 'c', time: '14:00', estimatedMinutes: 60 }
  assert.equal(serviceScheduleConflicts([{ tasks: [completed, { serviceId: 'b', time: '12:00', estimatedMinutes: 120 }, next] }]).length, 0)
  assert.equal(serviceScheduleConflicts([{ tasks: [completed, { serviceId: 'b', time: '12:15', estimatedMinutes: 120 }, next] }]).length, 1)
})

test('el servidor registra, conserva y limpia la hora real según la transición de estado', () => {
  const now = '2026-08-30T15:00:00.000Z'
  const pending = { id: 'h1', date: '2026-08-30', time: '10:00', status: 'Pendiente' }
  const completed = normalizeHistoryCompletionTimes([{ ...pending, status: 'Completado', completedAt: '2000-01-01T00:00:00.000Z' }], [pending], now)[0]
  assert.equal(completed.completedAt, now)
  assert.equal(normalizeHistoryCompletionTimes([{ ...completed, detail: 'actualizado' }], [completed], '2026-08-30T16:00:00.000Z')[0].completedAt, now)
  assert.equal('completedAt' in normalizeHistoryCompletionTimes([{ ...completed, status: 'Pendiente' }], [completed], now)[0], false)
  assert.throws(() => assertServiceCanBeCompleted({ date: '2026-08-31', time: '08:00' }, now), /antes de su fecha y hora/)
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
  ] }], weekly: {} } }), /conflicto de horarios/)
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

test('la validación del servidor usa la finalización real de un completado de hoy', () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const service = { id: 's1', code: 's1', name: 'Servicio', estimatedMinutes: 60, status: 'Activo' }
  const completed = { id: 'h-live', sourceTaskId: 'done-live', date: today, serviceId: 's1', customerId: 'c1', time: '08:30', status: 'Completado', estimatedMinutes: 150, completedAt: `${today}T13:02:10.000Z` }
  const state = start => ({
    roles: [], employees: [], services: [service], vehicles: [], customers: [
      { customerId: 'c1', account: 'CLI-001' }, { customerId: 'c2', account: 'CLI-002' }, { customerId: 'c3', account: 'CLI-003' }
    ], history: [completed],
    agenda: { date: today, teams: [{ teamId: 'team-1', tasks: [
      { taskId: 'done-live', historyId: 'h-live', serviceId: 's1', customerId: 'c1', time: '08:30', estimatedMinutes: 150 },
      { taskId: 'inserted', serviceId: 's1', customerId: 'c2', time: start, estimatedMinutes: 120 },
      { taskId: 'next', serviceId: 's1', customerId: 'c3', time: '14:00', estimatedMinutes: 60 }
    ] }], weekly: {} }
  })
  const previous = state('11:45')
  assert.doesNotThrow(() => validateState(state('12:00'), previous))
  assert.throws(() => validateState(state('12:15'), previous), /conflicto de horarios/)
})

test('los solapamientos históricos sin cambios no bloquean otro día y el mensaje usa fecha, integrantes y servicios reales', () => {
  const service = { id: 's1', code: 's1', name: 'Servicio', description: '', estimatedMinutes: 60, status: 'Activo' }
  const legacyPlan = { teams: [{ teamId: 'legacy-team', label: 'Equipo 1', memberIds: [], members: ['Santos Díaz', 'Mariano Díaz'], tasks: [
    { taskId: 'old-a', serviceId: 's1', service: 'Servicio', time: '08:30', estimatedMinutes: 60 },
    { taskId: 'old-b', serviceId: 's1', service: 'Servicio', time: '08:30', estimatedMinutes: 60 }
  ] }] }
  const previous = { roles: [], employees: [], services: [service], vehicles: [], customers: [], history: [], agenda: { date: '2026-08-27', teams: [], weekly: { '2026-02-03': legacyPlan } } }
  const next = structuredClone(previous)
  next.agenda.teams = [{ teamId: 'current-team', label: 'Equipo 1', memberIds: [], tasks: [{ taskId: 'new', serviceId: 's1', service: 'Servicio', time: '10:00', estimatedMinutes: 60 }] }]
  assert.doesNotThrow(() => validateState(next, previous))

  next.agenda.weekly['2026-02-03'].teams[0].tasks[1].estimatedMinutes = 120
  assert.throws(() => validateState(next, previous), /El equipo conformado por Santos Díaz y Mariano Díaz del martes, 3 de febrero de 2026 tiene un conflicto de horarios entre el Servicio 1 \(Servicio\) a las 08:30 y el Servicio 2 \(Servicio\) a las 08:30/)
})

test('una duración histórica inválida sin cambios no bloquea y al editarla informa día, integrantes y servicio', () => {
  const service = { id: 's1', code: 's1', name: 'Instalación de alarma', description: '', estimatedMinutes: 60, status: 'Activo' }
  const legacyPlan = { teams: [{ teamId: 'legacy-team', label: 'Equipo 1', members: ['Santos Díaz', 'Mariano Díaz'], tasks: [
    { taskId: 'old-a', serviceId: 's1', service: service.name, client: 'PIG-7009 CLIENTE', time: '08:30', estimatedMinutes: 60 },
    { taskId: 'old-b', serviceId: 's1', service: service.name, client: 'PIG-7006 CLIENTE', time: '14:00', estimatedMinutes: 0 }
  ] }] }
  const previous = { roles: [], employees: [], services: [service], vehicles: [], customers: [], history: [], agenda: { date: '2026-09-01', teams: [], weekly: { '2026-08-31': legacyPlan } } }
  const next = structuredClone(previous)
  next.agenda.teams = [{ teamId: 'current-team', members: [], tasks: [{ taskId: 'new', serviceId: 's1', service: service.name, time: '10:00', estimatedMinutes: 60 }] }]
  assert.doesNotThrow(() => validateState(next, previous))

  next.agenda.weekly['2026-08-31'].teams[0].tasks[1].time = '14:15'
  assert.throws(() => validateState(next, previous), /El equipo conformado por Santos Díaz y Mariano Díaz del lunes, 31 de agosto de 2026 tiene un tiempo estimado inválido en el Servicio 2 \(Instalación de alarma · PIG-7006 CLIENTE\)/)
})
