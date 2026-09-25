const test = require('node:test')
const assert = require('node:assert/strict')
const { agendaTaskForScheduleOccupancy, validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')

test('la cancelación técnica libera el turno sin cerrar la revisión administrativa', async () => {
  const { taskOccupiedInterval, serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const day = '2099-09-25'
  const task = { taskId: 'previous', historyId: 'report', service: 'Alarma', time: '11:00', estimatedMinutes: 15 }
  const report = { id: 'report', date: day, status: 'Requiere revisión', technicalStatus: 'Cancelado', technicalReportedAt: '2099-09-25T13:29:05Z' }
  const nextTask = { taskId: 'next', service: 'Alarma', time: '11:21', estimatedMinutes: 15 }
  const snapshot = structuredClone(report)
  assert.equal(agendaTaskForScheduleOccupancy(task, day, [report]), null)
  assert.equal(taskOccupiedInterval({ ...task, ...report }), null)
  assert.deepEqual(serviceScheduleConflicts([{ tasks: [{ ...task, ...report }, nextTask] }]), [])
  assert.doesNotThrow(() => validateChangedAgendaSchedules({ history: [report], services: [], agenda: { weekly: { [day]: { teams: [{ memberIds: ['tech'], tasks: [task, nextTask] }] } } } }))
  assert.deepEqual(report, snapshot)
})

test('una revisión sin cancelación no libera el turno y el historial vigente prevalece', () => {
  const task = { historyId: 'report', service: 'Alarma', time: '11:00', technicalStatus: 'Cancelado' }
  assert.ok(agendaTaskForScheduleOccupancy(task, '2099-09-25', [{ id: 'report', status: 'Pendiente', technicalStatus: '' }]))
  assert.ok(agendaTaskForScheduleOccupancy({ ...task, technicalStatus: '' }, '2099-09-25', [{ id: 'report', status: 'Requiere revisión' }]))
  assert.ok(agendaTaskForScheduleOccupancy({ ...task, vehicleControl: true }, '2099-09-25', []))
})
