const test = require('node:test')
const assert = require('node:assert/strict')
const { completedReleaseMinute, validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const { startServiceEarly } = require('../api/_lib/service-advance.cjs')
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
const done = (seconds = '03.537') => ({ id: 'done', sourceTaskId: 'done-task', serviceId: 'alarm', service: 'Service de alarma', date: today, time: '10:30', status: 'Completado', technicalStatus: 'Completado', estimatedMinutes: 60, completedAt: `${today}T13:57:${seconds}Z` })

test('seconds never create a phantom overlap at the visible completion minute', async () => {
  const { taskOccupiedInterval, serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  for (const seconds of ['00.000', '03.537', '29.900', '59.999']) for (const status of ['Completado', 'Avance registrado']) {
    const previous = { ...done(seconds), status, technicalStatus: status }, snapshot = structuredClone(previous)
    const next = { serviceId: 'alarm', time: '10:57', estimatedMinutes: 60 }
    assert.equal(completedReleaseMinute(previous), 657)
    assert.equal(taskOccupiedInterval(previous).end, 657)
    assert.equal(serviceScheduleConflicts([{ tasks: [previous, next] }]).length, 0)
    assert.equal(serviceScheduleConflicts([{ tasks: [previous, { ...next, time: '10:56' }] }]).length, 1)
    assert.deepEqual(previous, snapshot, 'real timestamp is not modified')
  }
})

test('automatic early start after finishing at 10:57 is consistent with planning', async () => {
  const { serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const next = startServiceEarly({ id: 'next', serviceId: 'alarm', date: today, time: '11:45', status: 'Pendiente', technicianIds: ['tech'], estimatedMinutes: 60 }, { id: 'tech' }, `${today}T13:57:24.462Z`)
  assert.equal(next.time, '10:57')
  assert.equal(next.originalScheduledTime, '11:45')
  assert.equal(next.startedAt, `${today}T13:57:24.462Z`)
  assert.equal(serviceScheduleConflicts([{ tasks: [done(), next] }]).length, 0)
})

for (const acrossTeams of [false, true]) test(`server accepts adjacent minutes and rejects real overlaps (${acrossTeams ? 'shared technician' : 'same team'})`, () => {
  const state = time => {
    const previous = done(), next = { id: 'next', sourceTaskId: 'next-task', serviceId: 'alarm', service: 'Service de alarma', date: today, time, status: 'Pendiente', estimatedMinutes: 60 }
    const tasks = [previous, next].map(record => ({ ...record, taskId: record.sourceTaskId, historyId: record.id }))
    const teams = acrossTeams ? tasks.map((task, index) => ({ teamId: String(index), memberIds: ['tech'], members: ['Técnico'], tasks: [task] })) : [{ teamId: '1', memberIds: ['tech'], members: ['Técnico'], tasks }]
    return { services: [{ id: 'alarm', name: 'Service de alarma', estimatedMinutes: 60 }], history: [previous, next], agenda: { date: today, teams, weekly: {} } }
  }
  for (const time of ['10:57', '10:56']) {
    const next = state(time), previous = structuredClone(next)
    // A real schedule edit triggers validation without scheduling in the past.
    previous.agenda.teams.at(-1).tasks.at(-1).estimatedMinutes = 90
    if (time === '10:57') assert.doesNotThrow(() => validateChangedAgendaSchedules(next, previous))
    else assert.throws(() => validateChangedAgendaSchedules(next, previous), /conflicto de horarios|servicios incompatibles/)
  }
})

test('availability uses the same minute boundary and invalid completion does not release slots', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const { taskOccupiedInterval } = await import('../src/domain/agenda/service-scheduling.mjs')
  const options = { min: '08:30', max: '17:00', fullAvailability: true }
  const gaps = serviceGaps([done('59.999')], options)
  assert(gaps.some(gap => gap.start === '10:57' && gap.end === '13:00'))
  for (const patch of [{ status: 'Pendiente', technicalStatus: '' }, { completedAt: 'invalid' }, { completedAt: '2000-01-01T13:57:00Z' }, { completedAt: `${today}T12:00:00Z` }]) {
    const record = { ...done(), ...patch }
    assert.equal(completedReleaseMinute(record), null)
    assert.equal(taskOccupiedInterval(record).endTime, '11:30')
  }
})
