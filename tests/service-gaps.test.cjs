const test = require('node:test')
const assert = require('node:assert/strict')
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
  assert.deepEqual(serviceGaps([task('09:00', 150), { time: '12:00' }, task('13:30', 60)]), [{ beforeIndex: 2, start: '11:30', end: '13:30' }])
  assert.equal(serviceGaps([task('09:00', 60), task('10:45', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 240), task('10:00', 60), task('13:30', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60), task('11:00', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60), task('11:29', 60)]).length, 0)
  assert.equal(serviceGaps([task('09:00', 60), task('11:30', 60)]).length, 1)
})
