const test = require('node:test')
const assert = require('node:assert/strict')
const load = () => import('../src/domain/agenda/reschedule-availability.mjs')
const record = { id: 'r', sourceTaskId: 't', service: 'Service', estimatedMinutes: 90 }
const teams = () => [
  { teamId: '1', memberIds: ['a'], tasks: [{ service: 'Instalación', time: '13:00', estimatedMinutes: 120 }] },
  { teamId: '2', memberIds: ['b'], tasks: [{ service: 'Service', time: '15:00', estimatedMinutes: 60 }] },
  { teamId: '3', memberIds: ['c'], tasks: [{ time: '14:00' }, { service: 'Service', time: '15:30', estimatedMinutes: 60 }] }
]
test('filters complete slots using full duration without mutating inputs', async () => {
  const { availableRescheduleTeams, completeRescheduleSlot } = await load()
  const input = teams(), before = structuredClone(input)
  for (const [day, time] of [['', '14:00'], ['2026-09-21', ''], ['2026-09-21', '14:'], ['2026-09-21', '24:00']]) {
    assert.equal(completeRescheduleSlot(day, time), false)
    assert.deepEqual(availableRescheduleTeams(input, record, day, time), [])
  }
  assert.deepEqual(availableRescheduleTeams(input, record, '2026-09-21', '14:00').map(t => t.teamId), ['3'])
  assert.deepEqual(input, before)
})
test('shared technicians are unavailable; the moved service does not conflict with itself', async () => {
  const { availableRescheduleTeams } = await load()
  const input = teams()
  input[2].memberIds = ['a']
  assert.deepEqual(availableRescheduleTeams(input, record, '2026-09-21', '14:00'), [])
  input[0].tasks = [{ ...record, taskId: 't', time: '14:00' }]
  assert.deepEqual(availableRescheduleTeams(input, record, '2026-09-21', '14:00').map(t => t.teamId), ['1', '3'])
})
test('vehicle controls reserve 15 minutes', async () => {
  const { availableRescheduleTeams } = await load()
  const input = [{ teamId: '1', memberIds: ['a'], tasks: [{ service: 'Control', vehicleControl: true, time: '15:30', estimatedMinutes: 15 }] }]
  assert.equal(availableRescheduleTeams(input, record, '2026-09-21', '15:30').length, 0)
  assert.equal(availableRescheduleTeams(input, record, '2026-09-21', '16:00').length, 1)
})
