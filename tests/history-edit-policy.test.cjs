const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { synchronizeAgendaHistoryRecord } = require('../api/_lib/history-record-operation.cjs')

test('registered customer contact comes from its profile and synchronizes both agendas', () => {
  const source = fs.readFileSync(require.resolve('../src/App.jsx'), 'utf8')
  const line = source.split(/\r?\n/).find(line => line.includes('const patch = { ...draft,'))
  const record = { id: 'h', status: 'Requiere revisión', customerId: 'old', technicianIds: ['t'] }
  const draft = { customerId: 'new', address: 'Manual', phone: '456', estimatedMinutes: 120 }
  const patch = vm.runInNewContext(line + '\npatch', { record, draft, customer: { address: 'Ficha', phone: '123' }, service: { id: 'new-service', name: 'Nuevo servicio' }, authUser: {}, customerLinkPatch: () => ({ customerId: 'new', client: 'Nuevo cliente', address: 'Ficha', phone: '123' }) })
  const task = { historyId: 'h', customerId: 'old' }
  const agenda = { teams: [{ tasks: [task] }], weekly: { day: { teams: [{ tasks: [task] }] } } }
  const result = synchronizeAgendaHistoryRecord(agenda, record, { ...record, ...patch })
  for (const updated of [result.teams[0].tasks[0], result.weekly.day.teams[0].tasks[0]]) {
    assert.equal(updated.address, 'Ficha')
    assert.equal(updated.phone, '123')
    assert.equal(updated.customerId, 'new')
    assert.equal(updated.serviceId, 'new-service')
    assert.equal(updated.estimatedMinutes, 120)
  }
  assert.equal(task.customerId, 'old')
  assert.doesNotMatch(source, /identityLocked|protectServiceIdentity/)
  const modal = source.slice(source.indexOf('function HistoryManagementDetail'), source.indexOf('function HistoryDetail('))
  assert.match(modal, /<CustomerAutocomplete value=\{draft.client/)
  assert.match(modal, /readOnly=\{Boolean\(draft.customerId\)\} value=\{draft.address\}/)
  assert.match(modal, /readOnly=\{Boolean\(draft.customerId\)\} value=\{draft.phone\}/)
})

test('pending rescheduling requires a different date', async () => {
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  for (const flag of [{ technicalStatus: 'Reprogramación solicitada' }, { technicianRequest: 'Reprogramación solicitada' }, { status: 'Reprogramación pendiente' }]) {
    assert.throws(() => historyRescheduleOperations({}, { base: { date: '2026-09-18', ...flag }, day: '2026-09-18' }), /fecha distinta/)
  }
})
