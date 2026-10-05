const test = require('node:test')
const assert = require('node:assert/strict')
const { agendaTaskForScheduleOccupancy, validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
const day = '2099-10-05'
const base = { taskId: 'old', historyId: 'old-record', service: 'Alarma', time: '13:00', estimatedMinutes: 150, date: day }
const released = [
  { status: 'Cancelado' },
  { status: 'Requiere revisión', technicalStatus: 'Cancelado' },
  { status: 'Reprogramación pendiente' },
  { status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada' },
  { status: 'Requiere revisión', technicianRequest: 'Reprogramación solicitada' },
  { status: 'Reprogramado', scheduledDate: '2099-10-06' }
]

test('cancelaciones y reprogramaciones liberan el mismo intervalo en cliente y servidor', async () => {
  const { taskOccupiedInterval, serviceScheduleConflicts } = await import('../src/domain/agenda/service-scheduling.mjs')
  const { serviceGaps } = await import('../src/domain/agenda/service-gaps.mjs')
  for (const status of released) {
    const task = { ...base, ...status }
    const report = { ...task, id: 'old-record' }
    const next = { service: 'Cámaras', time: '14:00', estimatedMinutes: 90 }
    assert.equal(taskOccupiedInterval(task), null)
    assert.equal(agendaTaskForScheduleOccupancy(base, day, [report]), null)
    assert.deepEqual(serviceScheduleConflicts([{ tasks: [task, next] }]), [])
    assert.doesNotThrow(() => validateChangedAgendaSchedules({ history: [report], services: [], agenda: { weekly: { [day]: { teams: [{ tasks: [base, next] }] } } } }))
    const following = { service: 'Alarma', time: '15:30', estimatedMinutes: 90 }
    assert.ok(serviceGaps([task, following], { min: '08:00', max: '17:00', day, now: '2099-10-04T12:00:00Z' }).some(gap => gap.start === '14:00' && gap.end === '15:30'))
    assert.ok(serviceGaps([task], { min: '08:00', max: '17:00', day, now: '2099-10-04T12:00:00Z' }).some(gap => gap.start === '14:00' && gap.end === '17:00'))
  }
})

test('pendiente, a confirmar, en proceso y revisión genérica conservan la reserva', async () => {
  const { taskOccupiedInterval } = await import('../src/domain/agenda/service-scheduling.mjs')
  for (const status of [{ status: 'Pendiente' }, { awaitingConfirmation: true }, { status: 'En proceso', startedAt: '2099-10-05T16:00:00Z' }, { status: 'Requiere revisión' }]) {
    const task = { ...base, ...status }
    assert.ok(taskOccupiedInterval(task))
    assert.ok(agendaTaskForScheduleOccupancy(task, day, []))
  }
  assert.ok(taskOccupiedInterval({ ...base, status: 'Reprogramado', scheduledDate: day }))
})

test('reprogramar un servicio solicitado verifica conflictos en el destino', async () => {
  const { availableRescheduleTeams } = await import('../src/domain/agenda/reschedule-availability.mjs')
  const record = { ...base, technicianRequest: 'Reprogramación solicitada' }
  const team = { teamId: 't', tasks: [{ service: 'Otro', time: '14:00', estimatedMinutes: 90 }] }
  assert.deepEqual(availableRescheduleTeams([team], record, day, '14:00'), [])
  assert.equal(availableRescheduleTeams([{ ...team, tasks: [] }], record, day, '14:00').length, 1)
})
