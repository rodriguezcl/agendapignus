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
  assert(actual[0].slots.some(slot => slot.time === '14:45' && slot.end === '15:45'))
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
  assert(rows[2].slots.some(slot => slot.time === '12:00'))
  assert(rows[2].slots.some(slot => slot.time === '12:15' && slot.end === '14:15'))
  assert(rows[2].slots.some(slot => slot.time === '14:00'))
  assert(rows[2].slots.some(slot => slot.time === '16:00'))
  assert(!rows[2].slots.some(slot => slot.time === '16:15'))
})

test('la jornada configurada también excluye toda la ventana de almuerzo de 13 a 14', async () => {
  const { rescheduleSlots } = await import('../src/domain/agenda/reschedule-slots.mjs')
  const teams = [{ teamId: 'a', tasks: [] }]
  const slots = rescheduleSlots('2026-10-20', { estimatedMinutes: 60 }, teams, () => teams, new Date('2026-10-19T12:00:00Z'), {})[0].slots
  assert(slots.some(slot => slot.time === '12:00' && slot.end === '13:00'))
  assert(!slots.some(slot => slot.time >= '13:00' && slot.time < '14:00'))
  assert(slots.some(slot => slot.time === '14:00'))
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

test('ofrece reprogramar en los huecos del guardia hasta las 20, descontando los otros equipos', async () => {
  const { rescheduleSlots } = await import('../src/domain/agenda/reschedule-slots.mjs')
  const { availableRescheduleTeams } = await import('../src/domain/agenda/reschedule-availability.mjs')
  const teams = [
    { teamId: 'diurno', memberIds: ['santos', 'rodrigo'], tasks: [{ serviceId: 's', time: '08:30', estimatedMinutes: 390 }] },
    { teamId: 'guardia', memberIds: ['santos'], tasks: [{ serviceId: 's', time: '17:30', estimatedMinutes: 60 }] },
    { teamId: 'otro', memberIds: ['pascual'], tasks: [] }
  ]
  const available = (day, time, record) => availableRescheduleTeams(teams, record, day, time)
  const before = JSON.stringify(teams)
  const rows = rescheduleSlots('2026-10-23', { estimatedMinutes: 60 }, teams, available, new Date('2026-10-22T12:00:00Z'), {})
  assert.deepEqual(rows[1].slots.map(slot => slot.time), ['16:00', '16:15', '16:30', '18:30', '18:45', '19:00'])
  assert.equal(rows[1].slots.at(-1).end, '20:00')
  assert.equal(rows[0].slots.length, 0)
  assert.equal(rows[2].slots.at(-1).end, '16:00')
  assert.equal(JSON.stringify(teams), before)
})
