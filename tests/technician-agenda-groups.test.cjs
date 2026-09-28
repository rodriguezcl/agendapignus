const test = require('node:test')
const assert = require('node:assert/strict')

test('separates overdue, today and tomorrow without changing service order', async () => {
  const { technicianAgendaServices, technicianAgendaGroups } = await import('../src/domain/technicians/technician-history.mjs')
  const services = technicianAgendaServices([
    { id: 'tomorrow', date: '2026-10-01', time: '09:00' },
    { id: 'late', date: '2026-09-30', time: '15:00' },
    { id: 'overdue', date: '2026-09-29', time: '09:00' },
    { id: 'early', date: '2026-09-30', time: '09:00' }
  ], '2026-09-30')
  const groups = technicianAgendaGroups(services, '2026-09-30')
  assert.deepEqual(groups.map(group => group.title), ['Pendientes de días anteriores', 'Agenda de hoy', 'Agenda de mañana'])
  assert.deepEqual(groups.map(group => group.services.map(record => record.id)), [['overdue'], ['early', 'late'], ['tomorrow']])
  assert.deepEqual(groups.flatMap(group => group.services), services)
  assert.equal(groups[2].date, '2026-10-01')
})

test('empty today and tomorrow remain explicit, including a year boundary', async () => {
  const { technicianAgendaGroups } = await import('../src/domain/technicians/technician-history.mjs')
  const groups = technicianAgendaGroups([], '2026-12-31')
  assert.deepEqual(groups.map(group => group.date), ['2026-12-31', '2027-01-01'])
  assert.ok(groups.every(group => group.services.length === 0))
})
