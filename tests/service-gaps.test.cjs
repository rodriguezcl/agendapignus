const test = require('node:test')
const assert = require('node:assert/strict')

test('muestra disponibilidad hasta el cierre después de borrar el segundo turno', async () => {
  const { serviceGaps, planningHoursForDay } = await import('../src/domain/agenda/service-gaps.mjs')
  const tasks = [{serviceId:'s',time:'08:45',estimatedMinutes:150}]
  const options = {...planningHoursForDay('2026-09-24'),day:'2026-09-24',now:'2026-09-22T12:00:00Z'}
  assert.deepEqual(serviceGaps(tasks,options),[
    {beforeIndex:1,start:'11:15',end:'13:30'},
    {beforeIndex:1,start:'14:00',end:'17:00'}
  ])
  assert.equal(serviceGaps([...tasks,{time:'14:00'}],options).some(gap=>gap.start==='14:00'),false)
  assert.deepEqual(serviceGaps([{serviceId:'s',time:'14:00',estimatedMinutes:60}],options),[{beforeIndex:1,start:'15:00',end:'17:00'}])
  assert.deepEqual(serviceGaps([{serviceId:'s',time:'16:00',estimatedMinutes:60}],options),[])
  assert.deepEqual(serviceGaps(tasks,{...options,now:'2026-09-24T20:00:00Z'}),[])
  assert.deepEqual(serviceGaps([],options),[])
  assert.equal(serviceGaps(tasks,{...options,...planningHoursForDay('2026-09-25'),day:'2026-09-25'}).at(-1).end,'16:00')
  assert.equal(serviceGaps([{serviceId:'s',time:'08:00',estimatedMinutes:60}],{...options,...planningHoursForDay('2026-09-26'),day:'2026-09-26'}).at(-1).end,'12:00')
})

test('daily and weekly availability share working hours', async () => {
  const { planningHoursForDay } = await import('../src/domain/agenda/service-gaps.mjs')
  assert.equal(planningHoursForDay('2026-09-21').max, '17:00')
  assert.equal(planningHoursForDay('2026-09-25').max, '20:00')
  assert.equal(planningHoursForDay('2026-09-26').max, '12:00')
  assert.equal(planningHoursForDay('2026-09-27'), null)
})

test('viernes no ofrece como disponibilidad general el horario excepcional de guardia', async () => {
  const { serviceGaps, planningHoursForDay } = await import('../src/domain/agenda/service-gaps.mjs')
  const options = {...planningHoursForDay('2026-09-25'),day:'2026-09-25',now:'2026-09-22T12:00:00Z'}
  const control = {vehicleControl:true,time:'15:30',estimatedMinutes:15}
  assert.deepEqual(serviceGaps([control],options),[])
  const morning = {serviceId:'s',time:'09:00',estimatedMinutes:60}
  const guard = {serviceId:'guard',time:'18:00',estimatedMinutes:120}
  assert.ok(serviceGaps([morning,guard],options).every(gap=>gap.end<='16:00'))
  assert.deepEqual(serviceGaps([morning],{...options,now:'2026-09-25T19:00:00Z'}),[])
  assert.equal(planningHoursForDay(options.day).max,'20:00')
})

test('daily gap insertion exposes a draft at the available time and does not duplicate that window', async () => {
  const { serviceGaps, planningHoursForDay } = await import('../src/domain/agenda/service-gaps.mjs')
  const tasks = [{ time: '08:45', serviceId: 's', estimatedMinutes: 150 }, { time: '13:00', serviceId: 's', estimatedMinutes: 60 }]
  const options = { ...planningHoursForDay('2026-09-21'), day: '2026-09-21', now: '2026-09-21T12:00:00Z' }
  const [gap] = serviceGaps(tasks, options)
  assert.deepEqual(gap, { start: '11:15', end: '13:00', beforeIndex: 1 })
  const next = [...tasks.slice(0, gap.beforeIndex), { taskId: 'draft', time: gap.start }, ...tasks.slice(gap.beforeIndex)]
  assert.equal(next[1].time, '11:15')
  assert.equal(serviceGaps(next, options).some(item => item.start === gap.start), false)
})

test('excluye el almuerzo y exige 90 minutos continuos por tramo', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const gap = (start, end, options) => serviceGaps([
    { serviceId: 's', time: start, estimatedMinutes: 60 },
    { serviceId: 's', time: end, estimatedMinutes: 30 }
  ], options)
  assert.deepEqual(gap('11:00', '14:00'), [{ beforeIndex: 1, start: '12:00', end: '13:30' }])
  assert.deepEqual(gap('11:30', '14:00'), [])
  assert.deepEqual(gap('12:30', '14:00'), [])
  assert.deepEqual(gap('12:00', '15:00'), [])
  assert.deepEqual(gap('11:00', '15:30'), [
    { beforeIndex: 1, start: '12:00', end: '13:30' },
    { beforeIndex: 1, start: '14:00', end: '15:30' }
  ])
  assert.deepEqual(gap('12:45', '15:30'), [{ beforeIndex: 1, start: '14:00', end: '15:30' }])
  assert.deepEqual(gap('11:00', '15:30', { day: '2026-09-17', now: '2026-09-17T16:40:00Z' }), [
    { beforeIndex: 1, start: '14:00', end: '15:30' }
  ])
})
test('oculta el pasado y exige al menos 90 minutos futuros en Argentina', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const tasks = [{ serviceId: 's', time: '09:00', estimatedMinutes: 60 }, { serviceId: 's', time: '18:00', estimatedMinutes: 60 }]
  const now = '2026-09-16T19:32:00Z'
  assert.deepEqual(serviceGaps(tasks, { day: '2026-09-15', now }), [])
  assert.deepEqual(serviceGaps(tasks, { day: '2026-09-16', now }), [])
  assert.equal(serviceGaps(tasks, { day: '2026-09-16', now: '2026-09-16T19:30:00Z' })[0].start, '16:30')
  assert.deepEqual(serviceGaps(tasks, { day: '2026-09-16', now, max: '17:00' }), [])
  assert.equal(serviceGaps(tasks, { day: '2026-09-17', now })[0].start, '10:00')
})
test('brechas de al menos 90 minutos, sin contar tarjetas vacías ni superposiciones', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const task = (time, estimatedMinutes) => ({ serviceId: 's', time, estimatedMinutes })
  assert.deepEqual(serviceGaps([task('09:00', 150), { time: '12:00' }, task('13:30', 60)]), [{ beforeIndex: 1, start: '11:30', end: '13:30' }])
  assert.equal(serviceGaps([task('09:00', 60), task('10:45', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 240), task('10:00', 60), task('13:30', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60), task('11:00', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60), task('11:29', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60), task('11:30', 60)]).length, 1)
})

test('ordena la brecha antes del turno vacío y no duplica su disponibilidad', async () => {
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  const tasks = [
    { serviceId: 'installation', time: '08:45', estimatedMinutes: 150 },
    { taskId: 'empty', time: '14:00' },
    { vehicleControl: true, time: '15:30', estimatedMinutes: 15 }
  ]
  assert.deepEqual(serviceGaps(tasks), [{ beforeIndex: 1, start: '11:15', end: '13:30' }])
  assert.deepEqual(serviceGaps([tasks[0], tasks[2]]), [
    { beforeIndex: 1, start: '11:15', end: '13:30' },
    { beforeIndex: 1, start: '14:00', end: '15:30' }
  ])
  assert.deepEqual(serviceGaps([tasks[0], { ...tasks[1], serviceId: 's', estimatedMinutes: 60 }, tasks[2]]), [
    { beforeIndex: 1, start: '11:15', end: '13:30' }
  ])
})
