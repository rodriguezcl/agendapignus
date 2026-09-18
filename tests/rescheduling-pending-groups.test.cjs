const test = require('node:test')
const assert = require('node:assert/strict')
const today = '2026-09-18'
const request = { id: 'request', date: today, status: 'Requiere revisión', technicalStatus: 'Reprogramación solicitada', technicianRequest: 'Reprogramación solicitada', technicalObservation: 'Requiere nueva visita' }

test('history deep links select exactly the same records as each dashboard alert', async () => {
  const { dashboardPendingGroups, historyReminderRecords, historyStatusLabel } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  const records = [request, { id: 'today', date: today, status: 'Pendiente' }, { id: 'old', date: '2026-09-17', status: 'Pendiente' }, { id: 'future', date: '2026-09-21', status: 'Pendiente' }, { id: 'cancel-review', date: today, status: 'Requiere revisión', technicalStatus: 'Cancelado' }]
  const groups = dashboardPendingGroups(records, today)
  for (const pendingGroup of ['today', 'overdue', 'rescheduling']) {
    assert.deepEqual(historyReminderRecords(records, { pendingGroup, date: today }), groups[pendingGroup])
  }
  assert.equal(historyReminderRecords(records, null), records)
  assert.equal(historyStatusLabel(request), 'Reprogramación pendiente')
  assert.equal(historyStatusLabel(records[4]), 'Requiere revisión')
  assert.equal(request.status, 'Requiere revisión')
})

test('request releases the technician queue without closing or losing the administrative request', async () => {
  const { technicianAgendaServices, technicianRecordResolved } = await import('../src/domain/technicians/technician-history.mjs')
  const next = { id: 'next', date: today, status: 'Pendiente', time: '14:00' }
  const before = structuredClone(request)
  assert.equal(technicianRecordResolved(request), true)
  assert.deepEqual(technicianAgendaServices([request, next], today).map(record => record.id), ['next'])
  assert.deepEqual(request, before)
  const legacy = { ...request, technicalStatus: '' }
  assert.deepEqual(technicianAgendaServices([legacy, next], today).map(record => record.id), ['next'])
})

test('dashboard groups distinguish today, overdue and rescheduling without double counting', async () => {
  const { dashboardPendingGroups } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  const records = [request,
    { ...request, id: 'older-request', date: '2026-09-17' },
    { id: 'today', date: today, status: 'Pendiente' },
    { id: 'old', date: '2026-09-17', status: 'Pendiente' },
    { id: 'future', date: '2026-09-21', status: 'Pendiente' },
    { id: 'closed', date: today, status: 'Completado' }]
  const groups = dashboardPendingGroups(records, today)
  assert.deepEqual(groups.today.map(record => record.id), ['today'])
  assert.deepEqual(groups.overdue.map(record => record.id), ['old'])
  assert.deepEqual(groups.rescheduling.map(record => record.id), ['request', 'older-request'])
})

test('review is not automatically completed and a newly scheduled visit returns to technician agenda', async () => {
  const { dashboardPendingGroups } = await import('../src/domain/dashboard/dashboard-metrics.mjs')
  const { technicianAgendaServices } = await import('../src/domain/technicians/technician-history.mjs')
  const scheduled = { ...request, date: '2026-09-19', status: 'Pendiente', technicalStatus: '', technicianRequest: '' }
  assert.equal(dashboardPendingGroups([scheduled], today).rescheduling.length, 0)
  assert.equal(technicianAgendaServices([scheduled], today).length, 1)
  assert.equal(dashboardPendingGroups([{ ...request, status: 'Cancelado' }], today).rescheduling.length, 0)
})

test('vehicle controls are not released by a rescheduling request', async () => {
  const { technicianRecordResolved } = await import('../src/domain/technicians/technician-history.mjs')
  assert.equal(technicianRecordResolved({ ...request, vehicleControl: true }), false)
})
