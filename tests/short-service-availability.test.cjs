const test = require('node:test')
const assert = require('node:assert/strict')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const service = (time, estimatedMinutes, extra = {}) => ({ serviceId: 'alarm', service: 'Service de alarma', time, estimatedMinutes, ...extra })

test('viernes: servicio de 15 minutos deja disponibilidad antes del control vehicular y respeta almuerzo', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [{ memberIds: ['leonardo'], tasks: [
    service('08:30', 150), service('11:00', 60), service('12:00', 60),
    service('13:30', 15), service('15:45', 15, { vehicleControl: true, technicianIds: ['leonardo'] })
  ] }]
  assert.deepEqual(teamServiceGaps(teams, 0, {
    min: '08:00', bookable: '08:30', max: '20:00', fullAvailability: true,
    day: '2026-10-30', now: '2026-10-29T12:00:00Z'
  }), [{ beforeIndex: 4, start: '14:15', end: '15:45' }])
})

test('oculta huecos menores a 45 minutos y respeta ocupaciones de técnicos compartidos', async () => {
  const { teamServiceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const teams = [
    { memberIds: ['tech'], tasks: [service('09:00', 15), service('09:30', 15), service('09:59', 15)] },
    { memberIds: ['tech'], tasks: [service('08:30', 15)] }
  ]
  assert.deepEqual(teamServiceGaps(teams, 0, { min: '08:30', max: '10:14', fullAvailability: true }), [])
})

for (const acrossTeams of [false, true]) test(`servidor respeta 15 minutos y rechaza solapamientos reales: ${acrossTeams ? 'técnico compartido' : 'mismo equipo'}`, () => {
  for (const time of ['09:15', '09:14']) {
    const tasks = [service('09:00', 15, { taskId: 'first' }), service(time, 15, { taskId: 'second' })]
    const teams = acrossTeams
      ? tasks.map((task, index) => ({ teamId: String(index), memberIds: ['tech'], members: ['Técnico'], tasks: [task] }))
      : [{ teamId: '1', memberIds: ['tech'], members: ['Técnico'], tasks }]
    const next = { services: [{ id: 'alarm', name: 'Service de alarma', estimatedMinutes: 60 }], history: [], agenda: { date: '2099-01-05', teams, weekly: {} } }
    const previous = structuredClone(next)
    previous.agenda.teams.at(-1).tasks.at(-1).estimatedMinutes = 30
    if (time === '09:15') assert.doesNotThrow(() => validateChangedAgendaSchedules(next, previous))
    else assert.throws(() => validateChangedAgendaSchedules(next, previous), /conflicto de horarios|servicios incompatibles/)
  }
})

for (const duration of [15, 30, 44, 45, 60]) test(`disponibilidad continua de ${duration} minutos al inicio, entre servicios y al cierre`, async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  for (const position of ['inicio', 'entre', 'cierre']) {
    const start = 9 * 60
    const tasks = [
      ...(position !== 'inicio' ? [service('08:30', 30)] : []),
      ...(position !== 'cierre' ? [service(time(start + duration), 15)] : [])
    ]
    const gaps = serviceGaps(tasks, { min: position === 'inicio' ? '09:00' : '08:30', max: time(start + duration + (position === 'cierre' ? 0 : 15)), fullAvailability: true })
    assert.deepEqual(gaps.map(({ start, end }) => [start, end]), duration >= 45 ? [['09:00', time(start + duration)]] : [], position)
  }
})

test('no suma huecos separados por el almuerzo y recalcula el mínimo con la hora actual', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  assert.deepEqual(serviceGaps([], { min: '12:30', max: '14:30', fullAvailability: true }), [])
  const options = { min: '08:30', max: '17:00', fullAvailability: true, day: '2026-11-17' }
  assert.deepEqual(serviceGaps([], { ...options, now: '2026-11-17T19:15:00Z' }).map(({ start, end }) => [start, end]), [['16:15', '17:00']])
  assert.deepEqual(serviceGaps([], { ...options, now: '2026-11-17T19:15:01Z' }), [])
})
