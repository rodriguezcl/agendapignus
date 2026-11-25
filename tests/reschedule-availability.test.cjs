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

test('paused controls release history reschedule slots without removing assignments or reports', async () => {
  const { availableRescheduleTeams } = await load()
  const { rescheduleSlots } = await import('../src/domain/agenda/reschedule-slots.mjs')
  const day = '2099-10-09', paused = {_vehicleControls:{paused:true}}
  const control = {taskId:'control',vehicleControl:true,service:'Control vehicular',time:'15:45',estimatedMinutes:15,status:'Pendiente'}
  const input = [{teamId:'one',memberIds:['a'],tasks:[control]}], before=structuredClone(input)
  const service = {id:'new',service:'Visita',estimatedMinutes:15}
  assert.deepEqual(availableRescheduleTeams(input,service,day,'15:45'),[])
  assert.equal(availableRescheduleTeams(input,service,day,'15:45',paused).length,1)
  const slots = rescheduleSlots(day,service,input,(date,time,record)=>availableRescheduleTeams(input,record,date,time,paused),new Date('2099-10-01T12:00:00Z'),paused)
  assert.ok(slots[0].slots.some(slot=>slot.time==='15:45'))
  assert.deepEqual(availableRescheduleTeams(input,control,day,'15:45',paused),[])
  assert.deepEqual(rescheduleSlots(day,control,input,()=>input,new Date('2099-10-01T12:00:00Z'),paused)[0].slots,[])
  assert.deepEqual(input,before)
  const completed=[{...input[0],tasks:[{...control,status:'Completado',completedAt:'2099-10-09T19:00:00Z'}]}]
  assert.deepEqual(availableRescheduleTeams(completed,service,day,'15:45',paused),[])
})
