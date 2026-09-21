const test = require('node:test')
const assert = require('node:assert/strict')
const { assertServiceConfirmationChange, assertServiceConfirmed } = require('../api/_lib/service-confirmation.cjs')
const { completeExpiredMonthlyMeetings } = require('../api/_lib/monthly-meeting-completion.cjs')
const { startTechnicianServiceRecord } = require('../api/_lib/technician-service-start.cjs')
const { requestServiceAdvance } = require('../api/_lib/service-advance.cjs')
const now = '2026-09-21T15:00:00Z'
const record = { id: 'r', sourceTaskId: 't', date: '2026-09-21', time: '14:00', estimatedMinutes: 90, status: 'Pendiente', client: 'Cliente', technicianIds: ['tech'] }

test('confirmation is independent of status and defaults to confirmed', async () => {
  const { awaitingServiceConfirmation, canChangeServiceConfirmation } = await import('../src/domain/agenda/service-confirmation.mjs')
  assert.equal(awaitingServiceConfirmation(record), false)
  assert.equal(canChangeServiceConfirmation(record), true)
  assert.doesNotThrow(() => assertServiceConfirmationChange(record, { ...record, awaitingConfirmation: true }, now))
  assert.doesNotThrow(() => assertServiceConfirmationChange({ ...record, awaitingConfirmation: true }, record, now))
  for (const patch of [{ vehicleControl: true }, { startedAt: now }, { status: 'Completado' }, { status: 'Cancelado' }, { status: 'Requiere revisión' }, { technicalStatus: 'Reprogramación solicitada' }]) {
    const source = { ...record, ...patch }
    assert.equal(canChangeServiceConfirmation(source), false)
    assert.throws(() => assertServiceConfirmationChange(source, { ...source, awaitingConfirmation: true }, now))
  }
  assert.throws(() => assertServiceConfirmationChange({ ...record, date: '2026-09-20', awaitingConfirmation: true }, { ...record, date: '2026-09-20', awaitingConfirmation: false }, now), /Reprogramalo/)
})

test('atomic confirmation synchronizes daily, weekly and history without changing reserved duration or time', async () => {
  const { serviceConfirmationOperations } = await import('../src/features/state/application/service-confirmation.mjs')
  const task = { taskId: 't', historyId: 'r', time: '14:00', estimatedMinutes: 90 }
  const teams = [{ teamId: 'team', tasks: [task] }]
  const snapshot = { history: [record], agenda: { date: record.date, teams, weekly: { [record.date]: { teams } } } }
  const operations = serviceConfirmationOperations(snapshot, { base: record, awaitingConfirmation: true, today: record.date })
  assert.equal(operations.length, 3)
  for (const operation of operations) {
    assert.equal(operation.after.awaitingConfirmation, true)
    assert.equal(operation.after.time, '14:00')
    assert.equal(operation.after.estimatedMinutes, 90)
  }
  assert.equal(snapshot.history[0].awaitingConfirmation, undefined)
  assert.throws(() => serviceConfirmationOperations(snapshot, { base: { ...record, detail: 'stale' }, awaitingConfirmation: true, today: record.date }), /cambió/)
})

test('dashboard confirmation reminder is separate and filters future and current unconfirmed records', async () => {
  const { dashboardPendingGroups, historyReminderRecords } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  const awaiting = { ...record, awaitingConfirmation: true }
  const future = { ...awaiting, id: 'future', date: '2026-09-22' }
  const cancelled = { ...awaiting, id: 'cancelled', status: 'Cancelado' }
  const records = [record, awaiting, future, cancelled]
  const groups = dashboardPendingGroups(records, record.date)
  assert.deepEqual(groups.today, [record])
  assert.deepEqual(groups.confirmation, [awaiting, future])
  assert.deepEqual(historyReminderRecords(records, { pendingGroup: 'confirmation', date: record.date }), [awaiting, future])
})

test('technicians cannot see, start, advance or complete unconfirmed services', async () => {
  const { technicianAgendaServices } = await import('../src/domain/technicians/technician-history.mjs')
  const awaiting = { ...record, awaitingConfirmation: true }
  assert.deepEqual(technicianAgendaServices([awaiting, record], record.date), [record])
  assert.throws(() => assertServiceConfirmed(awaiting), /confirmación/)
  assert.throws(() => startTechnicianServiceRecord(awaiting, { id: 'tech' }, now), /confirmación/)
  assert.throws(() => requestServiceAdvance(awaiting, { id: 'tech' }, now), /confirmación/)
  assert.throws(() => assertServiceConfirmationChange(awaiting, { ...awaiting, status: 'Completado' }, now), /Confirmá/)
})

test('unconfirmed monthly meeting never auto-completes', () => {
  const meeting = { ...record, service: 'Reunión Mensual', awaitingConfirmation: true }
  const result = completeExpiredMonthlyMeetings({ history: [meeting], agenda: {} }, '2026-09-22T15:00:00Z')
  assert.equal(result.changes.length, 0)
})

test('API technician projection excludes unconfirmed records, including shared customer history', () => {
  const { visibleStateForUser } = require('../api/_lib/core.cjs')
  const confirmed = { ...record, customerId: 'customer', date: '2099-01-01' }
  const hidden = { ...confirmed, id: 'hidden', awaitingConfirmation: true }
  const shared = { ...hidden, id: 'shared', technicianIds: ['other'] }
  const view = visibleStateForUser({ history: [confirmed, hidden, shared] }, { id: 'tech', roleCode: 'technician' })
  assert.deepEqual(view.history.map(item => item.id), ['r'])
})

test('draft confirmation change is dirty and discard restores saved confirmation', async () => {
  const { serviceHasChanges, restoreSavedService } = await import('../src/domain/agenda/service-changes.mjs')
  const draft = { ...record, awaitingConfirmation: true }
  assert.equal(serviceHasChanges(draft, record), true)
  assert.equal(restoreSavedService(draft, record).awaitingConfirmation, false)
})
