const test = require('node:test')
const assert = require('node:assert/strict')
const { defaults, validateWorkday, workdayForDate } = require('../api/_lib/workday.cjs')

test('la jornada se conserva frente a escrituras de usuarios no administrativos', () => {
  const { authorizeIncomingState } = require('../api/_lib/core.cjs')
  const current = { roles: [], employees: [], services: [], vehicles: [], customers: [], history: [], reviews: [], agenda: { teams: [], weekly: { _workday: { weekdays: { 1: defaults(1) } } } } }
  const next = structuredClone(current)
  next.agenda.weekly._workday.weekdays[1].end = '23:00'
  const result = authorizeIncomingState(next, current, { roleCode: 'user', permissions: { weekly: true, weeklyHours: true } })
  assert.equal(result.agenda.weekly._workday.weekdays[1].end, '17:00')
})

test('jornada distingue ingreso, preparación y excepciones por día y equipo', () => {
  const row = defaults(1)
  const weekly = { _workday: { weekdays: { 1: { ...row, bookable: '08:45' } }, exceptions: { '2026-10-19': { ...row, bookable: '09:00' }, '2026-10-19|a': { ...row, end: '12:00' } } } }
  validateWorkday(weekly._workday)
  assert.equal(workdayForDate('2026-10-26', weekly).bookable, '08:45')
  assert.equal(workdayForDate('2026-10-19', weekly, 'b').bookable, '09:00')
  assert.equal(workdayForDate('2026-10-19', weekly, 'a').end, '12:00')
  assert.equal(workdayForDate('2026-10-18', weekly), null)
  assert.throws(() => validateWorkday({ weekdays: { 1: { ...row, bookable: '07:00' } } }), /Revisá/)
  assert.throws(() => validateWorkday({ weekdays: { 1: { ...row, end: '25:00' } } }), /Revisá/)
})

test('disponibilidad completa incluye equipos vacíos y huecos iniciales, y recupera cancelaciones', async () => {
  const { planningHoursForDay, serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const options = { ...planningHoursForDay('2026-10-20'), fullAvailability: true, day: '2026-10-20', now: '2026-10-19T12:00:00Z' }
  assert.deepEqual(serviceGaps([], options), [{ beforeIndex: 0, start: '08:30', end: '13:00' }, { beforeIndex: 0, start: '14:00', end: '17:00' }])
  const tasks = [{ serviceId: 's', time: '10:00', estimatedMinutes: 120 }]
  assert.deepEqual(serviceGaps(tasks, options), [{ beforeIndex: 0, start: '08:30', end: '10:00' }, { beforeIndex: 1, start: '12:00', end: '13:00' }, { beforeIndex: 1, start: '14:00', end: '17:00' }])
  assert.equal(serviceGaps([{ ...tasks[0], status: 'Cancelado' }], options)[0].end, '13:00')
})
