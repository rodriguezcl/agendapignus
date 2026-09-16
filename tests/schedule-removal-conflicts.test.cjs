const test = require('node:test')
const assert = require('node:assert/strict')
const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const task = id => ({ taskId: id, serviceId: 's', service: 'Instalación', time: '09:00', estimatedMinutes: 60 })
const state = tasks => ({ services: [{ id: 's', estimatedMinutes: 60 }], history: [], agenda: { date: '2099-09-17', teams: [{ teamId: 'team', memberIds: ['tech'], members: ['Técnico'], tasks }] } })
test('permite eliminar un servicio aunque persista un conflicto previo', () => {
  assert.doesNotThrow(() => validateChangedAgendaSchedules(state([task('a'), task('b')]), state([task('a'), task('b'), task('disponible')])))
})
test('eliminar no permite modificar horarios ni introducir otro servicio conflictivo', () => {
  assert.throws(() => validateChangedAgendaSchedules(state([task('a'), task('nuevo')]), state([task('a'), task('b'), task('c')])) )
})
