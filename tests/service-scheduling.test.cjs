const test = require('node:test')
const assert = require('node:assert/strict')
const { assertServiceCanBeCompleted, normalizeHistoryCompletionTimes, normalizeStateForSave, validateState } = require('../api/_lib/core.cjs')
const { agendaTaskIsResolvedForPlanning, agendaTaskWasAlreadyScheduled, completedReleaseMinute } = require('../api/_lib/scheduling-validation.cjs')

test('el portal técnico acepta el reloj numérico usado para habilitar servicios', async () => {
  const { serviceHasStarted } = await import('../src/service-start.mjs')
  const clock = new Date('2026-08-30T15:00:00.000Z').getTime()
  assert.equal(serviceHasStarted({ date: '2026-08-30', time: '11:59' }, clock), true)
  assert.equal(serviceHasStarted({ date: '2026-08-30', time: '12:01' }, clock), false)
  assert.equal(serviceHasStarted({ date: '2026-08-31', time: '08:00' }, clock), false)
  assert.equal(serviceHasStarted({ date: '2026-08-29', time: '18:00' }, clock), true)
  assert.equal(serviceHasStarted({ date: '2026-08-30', time: '08:00' }, 'fecha-inválida'), false)
  assert.doesNotThrow(() => assertServiceCanBeCompleted({ date: '2026-08-29', time: '18:00' }, '2026-08-31T12:00:00.000Z'))
})

test('distingue un servicio persistido de un alta o cambio de horario realizado hoy', () => {
  const task = { taskId: 'task-1', historyId: 'history-1', serviceId: 's1', customerId: 'c1', time: '09:00' }
  const record = { id: 'history-1', sourceTaskId: 'task-1', date: '2026-09-01', serviceId: 's1', customerId: 'c1', time: '09:00', status: 'Pendiente' }

  assert.equal(agendaTaskWasAlreadyScheduled(task, '2026-09-01', null, [record]), true)
  assert.equal(agendaTaskWasAlreadyScheduled({ ...task, time: '08:30' }, '2026-09-01', null, [record]), false)
  assert.equal(agendaTaskWasAlreadyScheduled(task, '2026-09-02', null, [record]), false)
  assert.equal(agendaTaskWasAlreadyScheduled(task, '2026-09-01', { teams: [{ tasks: [task] }] }, []), true)
  assert.equal(agendaTaskWasAlreadyScheduled({ ...task, taskId: 'new', historyId: '', customerId: 'c2' }, '2026-09-01', { teams: [{ tasks: [task] }] }, []), false)
})

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

test('una finalización tardía se informa pero no prolonga el conflicto planificado', async () => {
  const { serviceScheduleConflicts, taskOccupiedInterval } = await import('../src/service-scheduling.mjs')
  const completed = { serviceId: 'a', date: '2026-08-31', time: '09:45', estimatedMinutes: 60, status: 'Completado', completedAt: '2026-08-31T14:43:53.330Z' }
  const interval = taskOccupiedInterval(completed)
  assert.equal(interval.actualCompletion, true)
  assert.equal(interval.earlyCompletion, false)
  assert.equal(interval.completedTime, '11:43')
  assert.equal(interval.endTime, '10:45')
  assert.equal(serviceScheduleConflicts([{ tasks: [completed, { serviceId: 'b', time: '11:00', estimatedMinutes: 90 }] }]).length, 0)
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
  assert.equal(normalized.history[0].estimatedMinutesCustomized, false)
  assert.equal(normalized.history[1].estimatedMinutesCustomized, true)
})

test('un cambio del catálogo actualiza pendientes heredados y conserva tiempos manuales o cerrados', () => {
  const previousService = { id: 's1', code: 's1', name: 'Service de alarma', estimatedMinutes: 90, status: 'Activo' }
  const nextService = { ...previousService, estimatedMinutes: 60 }
  const records = [
    { id: 'default', serviceId: 's1', service: previousService.name, status: 'Pendiente', estimatedMinutes: 90 },
    { id: 'manual', serviceId: 's1', service: previousService.name, status: 'Pendiente', estimatedMinutes: 120 },
    { id: 'explicit-default', serviceId: 's1', service: previousService.name, status: 'Pendiente', estimatedMinutes: 90, estimatedMinutesCustomized: false },
    { id: 'completed', serviceId: 's1', service: previousService.name, status: 'Completado', estimatedMinutes: 90 }
  ]
  const state = {
    roles: [], employees: [], services: [nextService], vehicles: [], customers: [], reviews: [], history: records,
    agenda: { teams: [{ tasks: records.slice(0, 3) }], weekly: {} }
  }
  const previous = { ...state, services: [previousService], history: records, agenda: { teams: [{ tasks: records.slice(0, 3) }], weekly: {} } }
  const normalized = normalizeStateForSave(state, previous)
  assert.deepEqual(normalized.history.map(record => record.estimatedMinutes), [60, 120, 60, 90])
  assert.deepEqual(normalized.history.map(record => record.estimatedMinutesCustomized), [false, true, false, true])
  assert.deepEqual(normalized.agenda.teams[0].tasks.map(task => task.estimatedMinutes), [60, 120, 60])
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

test('la API rechaza que un técnico tenga servicios superpuestos en equipos diferentes', () => {
  const service = { id: 's1', code: 's1', name: 'Servicio', description: '', estimatedMinutes: 60, status: 'Activo' }
  const employee = { id: 'tech-1', firstName: 'Técnico', lastName: 'Uno', email: 'tecnico@pignus.test', roleId: 'r1' }
  const state = {
    roles: [{ id: 'r1', code: 'technician', name: 'Técnico' }], employees: [employee], services: [service], vehicles: [], customers: [], reviews: [], history: [],
    agenda: { date: '2099-01-05', teams: [], weekly: { '2099-01-05': { teams: [
      { teamId: 'team-1', label: 'Equipo 1', memberIds: ['tech-1'], members: ['Técnico Uno'], tasks: [{ taskId: 'task-1', time: '10:00', serviceId: 's1', service: 'Servicio', estimatedMinutes: 60 }] },
      { teamId: 'team-2', label: 'Equipo 2', memberIds: ['tech-1'], members: ['Técnico Uno'], tasks: [{ taskId: 'task-2', time: '10:30', serviceId: 's1', service: 'Servicio', estimatedMinutes: 60 }] }
    ] } } }
  }

  assert.throws(() => validateState(state), /Técnico Uno tiene servicios incompatibles.*Equipo 1.*Equipo 2/)
  assert.doesNotThrow(() => validateState({
    ...state,
    employees: [employee, { ...employee, id: 'tech-2', email: 'tecnico2@pignus.test' }],
    agenda: { ...state.agenda, weekly: { '2099-01-05': { teams: state.agenda.weekly['2099-01-05'].teams.map((team, index) => index ? { ...team, memberIds: ['tech-2'], members: ['Técnico Dos'] } : team) } } }
  }))
})

test('la API admite una reserva PIG sin crear un cliente y exige sus datos provisorios', () => {
  const service = { id: 's1', code: 'alarm-installation', name: 'Instalación de alarma', description: '', estimatedMinutes: 150, status: 'Activo' }
  const reservation = { id: 'h1', date: '2026-09-03', serviceId: 's1', service: service.name, customerId: '', client: 'NUEVO ABONADO', clientNameAtService: 'NUEVO ABONADO', address: 'Dirección provisoria', phone: '3515550000', status: 'Pendiente', time: '09:00', estimatedMinutes: 150, subscriberReservation: true }
  const base = { roles: [], employees: [], services: [service], vehicles: [], customers: [], reviews: [], history: [reservation], agenda: { teams: [], weekly: {} } }

  assert.doesNotThrow(() => validateState(base))
  assert.throws(() => validateState({ ...base, history: [{ ...reservation, phone: '' }] }), /reserva PIG debe incluir nombre, dirección y contacto provisorios/)
  assert.throws(() => validateState({ ...base, customers: [{ customerId: 'c1', account: 'PIG-9000' }], history: [{ ...reservation, customerId: 'c1' }] }), /reserva PIG pendiente no puede estar vinculada/)
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

test('la validación del servidor aprovecha la finalización anticipada de un completado de hoy', () => {
  // Fecha histórica estable: esta prueba valida la liberación anticipada, no la
  // restricción independiente que impide reubicar servicios en horas ya pasadas.
  const today = '2026-08-31'
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

test('la validación del servidor no transforma una demora técnica en conflicto de planificación', () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const service = { id: 's1', code: 's1', name: 'Service de alarma', estimatedMinutes: 60, status: 'Activo' }
  const completed = { id: 'h1', sourceTaskId: 'done', date: today, serviceId: 's1', customerId: 'c1', time: '09:45', status: 'Completado', estimatedMinutes: 60, completedAt: `${today}T14:43:53.330Z` }
  const state = {
    roles: [], employees: [], services: [service], vehicles: [], customers: [{ customerId: 'c1', account: 'CLI-001' }, { customerId: 'c2', account: 'CLI-002' }], history: [completed],
    agenda: { date: today, teams: [{ teamId: 'team-1', tasks: [
      { taskId: 'done', historyId: 'h1', serviceId: 's1', customerId: 'c1', time: '09:45', estimatedMinutes: 60 },
      { taskId: 'next', serviceId: 's1', customerId: 'c2', time: '11:00', estimatedMinutes: 90 }
    ] }], weekly: {} }
  }
  const previous = structuredClone(state)
  previous.agenda.teams[0].tasks[1].estimatedMinutes = 75
  assert.doesNotThrow(() => validateState(state, previous))
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
  const previous = { roles: [], employees: [], services: [service], vehicles: [], customers: [], history: [], agenda: { date: '2026-08-30', teams: [], weekly: { '2026-08-31': legacyPlan } } }
  const next = structuredClone(previous)
  next.agenda.teams = [{ teamId: 'current-team', members: [], tasks: [{ taskId: 'new', serviceId: 's1', service: service.name, time: '10:00', estimatedMinutes: 60 }] }]
  assert.doesNotThrow(() => validateState(next, previous))

  next.agenda.weekly['2026-08-31'].teams[0].tasks[1].time = '14:15'
  assert.throws(() => validateState(next, previous), /El equipo conformado por Santos Díaz y Mariano Díaz del lunes, 31 de agosto de 2026 tiene un tiempo estimado inválido en el Servicio 2 \(Instalación de alarma · PIG-7006 CLIENTE\)/)
})
