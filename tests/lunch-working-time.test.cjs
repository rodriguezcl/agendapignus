const test = require('node:test')
const assert = require('node:assert/strict')
const { workingEnd } = require('../api/_lib/workday.cjs')
test('effective duration skips lunch and respects exact boundaries and exceptions', () => {
  assert.equal(workingEnd(720, 180), 960)
  assert.equal(workingEnd(720, 60), 780)
  assert.equal(workingEnd(840, 180), 1020)
  assert.equal(workingEnd(795, 60), 900)
  assert.equal(workingEnd(720, 180, { breakStart: '12:30', breakEnd: '13:00' }), 930)
})
test('lunch extends occupancy without changing duration; completed timestamps remain actual', async () => {
  const { taskOccupiedInterval, serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const task = { serviceId: 's', date: '2026-10-20', time: '12:00', estimatedMinutes: 180 }
  assert.equal(taskOccupiedInterval(task).serviceEndTime, '16:00')
  assert.equal(taskOccupiedInterval(task).estimatedMinutes, 180)
  assert.equal(serviceScheduleConflicts([{ tasks: [task, { serviceId: 'b', time: '15:30' }] }]).length, 1)
  assert.equal(serviceScheduleConflicts([{ tasks: [task, { serviceId: 'b', time: '16:00' }] }]).length, 0)
  assert.equal(taskOccupiedInterval({ ...task, status: 'Completado', completedAt: '2026-10-20T18:10:00Z' }).endTime, '15:10')
})
test('availability and rescheduling reserve noon through 16 and respect closing', async () => {
  const { serviceGaps, planningHoursForDay } = await import('../src/domain/agenda/service-gaps.mjs')
  const { rescheduleSlots } = await import('../src/domain/agenda/reschedule-slots.mjs')
  const day = '2026-10-20', now = new Date('2026-10-19T12:00:00Z')
  const task = { serviceId: 's', time: '12:00', estimatedMinutes: 180 }
  assert.deepEqual(serviceGaps([task], { ...planningHoursForDay(day), fullAvailability: true, day, now }).map(({start,end})=>[start,end]), [['08:30','12:00'],['16:00','17:00']])
  const teams = [{ teamId: 'a', tasks: [] }]
  const slots = rescheduleSlots(day, task, teams, () => teams, now, {})[0].slots
  assert(slots.some(slot=>slot.time==='12:00' && slot.end==='16:00'))
  assert(!slots.some(slot=>slot.time==='14:15'))
})

test('lunch card renders the configured break and is absent on Saturday morning', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { LunchCard, taskMoveScheduleState } = require('./helpers/load-app.cjs')(['LunchCard', 'taskMoveScheduleState'])
  const html = renderToStaticMarkup(React.createElement(LunchCard, { hours: { min: '08:00', max: '17:00', breakStart: '13:00', breakEnd: '14:00' } }))
  assert.match(html, /Almuerzo entre las 13:00 y las 14:00 hs/)
  assert.equal(renderToStaticMarkup(React.createElement(LunchCard, { hours: { min: '08:00', max: '12:00', breakStart: '13:00', breakEnd: '14:00' } })), '')
  const weekly = { _workday: { exceptions: { '2026-10-20|a': { start: '08:00', bookable: '08:30', end: '15:30', breakStart: '12:30', breakEnd: '13:00' } } } }
  const schedule = taskMoveScheduleState('2026-10-20', { time: '12:00', estimatedMinutes: 180 }, weekly, 'a')
  assert.equal(schedule.interval.serviceEndTime, '15:30')
  assert.equal(schedule.valid, true)
  assert.equal(taskMoveScheduleState('2026-10-20', { time: '12:15', estimatedMinutes: 180 }, weekly, 'a').valid, false)
})

test('server rejects overlaps during resumed work, including shared technicians', () => {
  const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
  const task = { taskId: 'a', service: 'Instalación', time: '12:00', estimatedMinutes: 180 }
  const state = (time, separate = false) => ({ services: [], history: [], agenda: { date: '2099-10-20', weekly: {}, teams: separate ? [{ teamId: 'a', memberIds: ['tech'], tasks: [task] }, { teamId: 'b', memberIds: ['tech'], tasks: [{ taskId: 'b', service: 'Reparación', time, estimatedMinutes: 60 }] }] : [{ teamId: 'a', tasks: [task, { taskId: 'b', service: 'Reparación', time, estimatedMinutes: 60 }] }] } })
  assert.throws(() => validateChangedAgendaSchedules(state('15:30')), /conflicto de horarios/)
  assert.doesNotThrow(() => validateChangedAgendaSchedules(state('16:00')))
  assert.throws(() => validateChangedAgendaSchedules(state('15:30', true)), /incompatibles/)
})
