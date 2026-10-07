const test = require('node:test')
const assert = require('node:assert/strict')

test('a technician reschedule request offers the same future slots as a pending visit', async () => {
  const { rescheduleSlots } = await import('../src/domain/agenda/reschedule-slots.mjs')
  const { availableRescheduleTeams } = await import('../src/domain/agenda/reschedule-availability.mjs')
  const teams = [{ teamId: 'a', memberIds: ['1'], tasks: [{ service: 'Service de alarma', time: '12:31', estimatedMinutes: 60 }] }]
  const available = (day, time, record) => availableRescheduleTeams(teams, record, day, time)
  const record = { id: 'costa-verde', service: 'Service de cámaras', date: '2026-10-07', time: '14:45', estimatedMinutes: 60, status: 'Reprogramación pendiente', technicalStatus: 'Reprogramación solicitada', technicianRequest: 'Reprogramación solicitada' }
  const before = JSON.stringify(record)
  const now = new Date('2026-10-07T20:00:00Z')
  const actual = rescheduleSlots('2026-10-08', record, teams, available, now)
  const expected = rescheduleSlots('2026-10-08', { ...record, status: 'Pendiente', technicalStatus: '', technicianRequest: '' }, teams, available, now)
  assert.deepEqual(actual, expected)
  assert(actual[0].slots.some(slot => slot.time === '14:00' && slot.end === '15:00'))
  assert(!actual[0].slots.some(slot => slot.time === '12:00'))
  assert.equal(JSON.stringify(record), before, 'preview must preserve the original request')
})
test('reschedule slots respect duration, shared technicians, lunch and closing time', async () => {
  const { rescheduleSlots } = await import('../src/domain/agenda/reschedule-slots.mjs')
  const { availableRescheduleTeams } = await import('../src/domain/agenda/reschedule-availability.mjs')
  const teams = [{ teamId: 'a', memberIds: ['1'], tasks: [{ service: 'Alarma', time: '09:00', estimatedMinutes: 60 }] }, { teamId: 'b', memberIds: ['1'], tasks: [] }, { teamId: 'c', memberIds: ['2'], tasks: [] }]
  const available = (day, time, record) => availableRescheduleTeams(teams, record, day, time)
  const rows = rescheduleSlots('2026-09-30', { estimatedMinutes: 60 }, teams, available, new Date('2026-09-29T12:00:00Z'))
  assert(!rows[0].slots.some(slot => slot.time === '09:00'))
  assert(!rows[1].slots.some(slot => slot.time === '09:00'))
  assert(rows[2].slots.some(slot => slot.time === '09:00'))
  assert(!rows[2].slots.some(slot => slot.time === '13:00'))
  assert(rows[2].slots.some(slot => slot.time === '16:00'))
  assert(!rows[2].slots.some(slot => slot.time === '16:15'))
})
test('today excludes past starts, Sunday offers none, and Friday ends at 16', async () => {
  const { rescheduleSlots } = await import('../src/domain/agenda/reschedule-slots.mjs')
  const teams = [{ teamId: 'a' }], available = () => teams
  const now = new Date('2026-09-30T13:07:00Z')
  const slots = day => rescheduleSlots(day, { estimatedMinutes: 60 }, teams, available, now)[0].slots
  assert.equal(slots('2026-09-30')[0].time, '10:15')
  assert.equal(slots('2026-09-29').length, 0)
  assert.equal(slots('2026-10-04').length, 0)
  assert.equal(slots('2026-10-02').at(-1).time, '15:00')
})
