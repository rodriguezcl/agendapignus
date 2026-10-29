const test = require('node:test')
const assert = require('node:assert/strict')
const options = { min: '08:00', bookable: '08:30', max: '20:00', fullAvailability: true, day: '2026-10-23', now: '2026-10-21T12:00:00Z' }
const service = (time, estimatedMinutes, extra = {}) => ({ serviceId: 'installation', time, estimatedMinutes, ...extra })

test('equipo de guardia no ofrece horas ocupadas por Santos en otro equipo el viernes', async () => {
  const { teamServiceGaps, planningHoursForDay } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: ['santos', 'rodrigo'], tasks: [service('08:30', 390)] },
    { memberIds: ['santos'], tasks: [service('17:30', 60)] },
    { memberIds: ['otro'], tasks: [] }
  ]
  const snapshot = JSON.stringify(teams)
  assert.deepEqual(teamServiceGaps(teams, 1, options), [
    { beforeIndex: 0, start: '16:00', end: '17:30' },
    { beforeIndex: 1, start: '18:30', end: '20:00' }
  ])
  assert.deepEqual(teamServiceGaps(teams, 0, options), [], 'el equipo mixto no extiende el horario del compañero')
  assert.deepEqual(teamServiceGaps(teams, 2, options).map(g => [g.start, g.end]), [['08:30', '13:00'], ['14:00', '16:00']])
  assert.equal(planningHoursForDay(options.day).max, '20:00', 'se conserva el horario excepcional de guardia')
  assert.equal(JSON.stringify(teams), snapshot)
})

test('intersecta disponibilidad de todos los integrantes y mantiene los índices de sus propias tarjetas', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: [1, '2'], tasks: [service('15:00', 60)] },
    { memberIds: ['1'], tasks: [service('08:30', 90)] },
    { memberIds: [2], tasks: [service('11:00', 120)] }
  ]
  assert.deepEqual(teamServiceGaps(teams, 0, options), [
    { beforeIndex: 0, start: '10:00', end: '11:00' },
    { beforeIndex: 0, start: '14:00', end: '15:00' }
  ])
})

test('libera cancelaciones y fin anticipado; ofrece ventanas para servicios cortos', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: ['santos'], tasks: [] },
    { memberIds: ['santos'], tasks: [service('08:30', 390, { status: 'Cancelado' })] }
  ]
  assert.equal(teamServiceGaps(teams, 0, options)[0].start, '08:30')
  teams[1].tasks = [service('08:30', 210, { status: 'Completado', date: options.day, completedAt: '2026-10-23T13:00:00-03:00' }), service('14:45', 75)]
  assert.deepEqual(teamServiceGaps(teams, 0, options).find(gap => gap.start === '14:00'), {beforeIndex:0,start:'14:00',end:'14:45'})
  teams[1].tasks = [service('08:30', 210, { status: 'Completado', date: options.day, completedAt: '2026-10-23T10:00:00-03:00' })]
  assert.equal(teamServiceGaps(teams, 0, options)[0].start, '10:00')
})

test('un control de otro responsable no bloquea al colaborador compartido', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: ['santos'], tasks: [] },
    { memberIds: ['santos', 'rodrigo'], tasks: [service('10:00', 15, { vehicleControl: true, technicianIds: ['rodrigo'] })] }
  ]
  assert.equal(teamServiceGaps(teams, 0, options)[0].end, '13:00')
  teams[1].tasks[0].technicianIds = ['santos']
  assert.deepEqual(teamServiceGaps(teams, 0, options).map(g => [g.start, g.end]), [['08:30', '10:00'], ['10:15', '13:00'], ['14:00', '16:00']])
})

test('recalcula el horario extendido al cambiar el técnico o cancelar la guardia', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: ['santos'], tasks: [service('17:30', 60)] },
    { memberIds: ['santos'], tasks: [] },
    { memberIds: ['rodrigo'], tasks: [] }
  ]
  const closesAt = index => teamServiceGaps(teams, index, options).at(-1).end
  assert.equal(closesAt(1), '20:00')
  assert.equal(closesAt(2), '16:00')
  teams[0].memberIds = ['rodrigo']
  assert.equal(closesAt(1), '16:00')
  assert.equal(closesAt(2), '20:00')
  teams[0].tasks[0].status = 'Cancelado'
  assert.equal(closesAt(2), '16:00')
  teams[0].tasks[0].status = 'Completado'
  assert.equal(closesAt(2), '20:00', 'una guardia completada conserva la jornada extendida')
})

test('la disponibilidad de guardia respeta el reloj, las duraciones y el cierre configurado', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: ['santos', 'rodrigo'], tasks: [service('08:30', 390)] },
    { memberIds: ['santos'], tasks: [service('17:30', 60)] }
  ]
  const gaps = extra => teamServiceGaps(teams, 1, { ...options, ...extra }).map(g => [g.start, g.end])
  assert.deepEqual(gaps({ now: '2026-10-23T19:10:00Z' }), [['16:15', '17:30'], ['18:30', '20:00']])
  assert.deepEqual(gaps({ now: '2026-10-23T22:15:00Z' }), [['19:15', '20:00']])
  assert.deepEqual(gaps({ max: '19:30' }), [['16:00', '17:30'], ['18:30', '19:30']])
  assert.deepEqual(gaps({ max: '21:00' }), [['16:00', '17:30'], ['18:30', '20:00']])
  teams[1].tasks[0].estimatedMinutes = 90
  assert.deepEqual(gaps({}), [['16:00', '17:30'], ['19:00', '20:00']])
})

test('un turno vacío o control vehicular por la tarde no habilita una guardia adelantada', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [{ memberIds: ['santos'], tasks: [{ time: '17:30', manualSlot: true }] }]
  assert.equal(teamServiceGaps(teams, 0, options).at(-1).end, '16:00')
  teams[0].tasks = [service('17:30', 15, { vehicleControl: true, client: 'Vehículo' })]
  assert.equal(teamServiceGaps(teams, 0, options).at(-1).end, '16:00')
})
