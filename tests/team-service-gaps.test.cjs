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
  assert.deepEqual(teamServiceGaps(teams, 1, options), [])
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

test('libera cancelaciones y fin anticipado; no ofrece fragmentos menores a una hora', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: ['santos'], tasks: [] },
    { memberIds: ['santos'], tasks: [service('08:30', 390, { status: 'Cancelado' })] }
  ]
  assert.equal(teamServiceGaps(teams, 0, options)[0].start, '08:30')
  teams[1].tasks = [service('08:30', 210, { status: 'Completado', date: options.day, completedAt: '2026-10-23T13:00:00-03:00' }), service('14:45', 75)]
  assert.equal(teamServiceGaps(teams, 0, options).some(gap => gap.start === '14:00'), false)
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
