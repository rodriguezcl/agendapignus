const test = require('node:test')
const assert = require('node:assert/strict')
const { applyConfirmedReconciliation } = require('../api/_lib/confirmed-reconciliation.cjs')
const { fingerprint } = require('../api/_lib/normalization-analysis.cjs')
function fixture() {
  const task = (id, client) => ({ taskId: id, historyId: id, time: id === 'j1' ? '10:00' : '11:00', client, status: 'Completado' })
  return { employees: [{ id: 'e1', name: 'Uno' }, { id: 'e2', name: 'Dos' }], history: [
    { id: 'j1', sourceTaskId: 'j1', date: '2026-04-18', time: '10:00', status: 'Completado', technicianIds: ['e1', 'e2'], technicians: ['Uno', 'Dos'], teamId: 'old', team: 'Equipo 1' },
    { id: 'keep', sourceTaskId: 'keep', date: '2026-04-18', time: '11:00', status: 'Completado', technicianIds: ['e2'], technicians: ['Dos'], teamId: 'old', team: 'Equipo 1' }
  ], agenda: { weekly: {
    '2026-04-18': { teams: [{ teamId: 'old', label: 'Equipo 1', memberIds: ['e1', 'e2'], members: ['Uno', 'Dos'], tasks: [task('j1', 'Mover'), task('keep', 'Conservar')] }] },
    '2026-08-18': { teams: [{ teamId: 'other', label: 'Equipo 1', memberIds: ['e2'], members: ['Dos'], tasks: [] }] }
  } } }
}
test('moves only the confirmed task, preserves its sibling and aligns the technician', () => {
  const state = fixture(), before = fingerprint(state)
  const manifest = { records: [{ id: 'j1', expected: { date: '2026-04-18', technicianIds: ['e1', 'e2'] }, set: { date: '2026-08-18', technicianIds: ['e1'] }, alignAgenda: true }] }
  const result = applyConfirmedReconciliation(state, manifest)
  assert.equal(fingerprint(state), before)
  assert.equal(result.state.history.length, 2)
  assert.deepEqual(result.state.history[0].technicianIds, ['e1'])
  assert.equal(result.state.agenda.weekly['2026-04-18'].teams[0].tasks[0].historyId, 'keep')
  const destination = result.state.agenda.weekly['2026-08-18'].teams.find(team => team.memberIds.length === 1 && team.memberIds[0] === 'e1')
  assert.equal(destination.tasks[0].historyId, 'j1')
  assert.equal(result.state.history[0].teamId, destination.teamId)
})
test('groups confirmed tasks with the same date and exact crew without duplicating them', () => {
  const state = fixture()
  const extra = { id: 'j2', sourceTaskId: 'j2', date: '2026-04-18', time: '12:00', status: 'Completado', technicianIds: ['e1'], technicians: ['Uno'], teamId: 'second' }
  state.history.push(extra)
  state.agenda.weekly['2026-04-18'].teams.push({ teamId: 'second', label: 'Equipo 2', memberIds: ['e1'], tasks: [{ taskId: 'j2', historyId: 'j2', time: '12:00' }] })
  const result = applyConfirmedReconciliation(state, { records: [
    { id: 'j1', expected: { date: '2026-04-18', technicianIds: ['e1', 'e2'] }, set: { date: '2026-08-18', technicianIds: ['e1'] }, alignAgenda: true },
    { id: 'j2', expected: { date: '2026-04-18', technicianIds: ['e1'] }, set: { date: '2026-08-18', technicianIds: ['e1'] }, alignAgenda: true }
  ] })
  const tasks = result.state.agenda.weekly['2026-08-18'].teams.flatMap(team => team.tasks || []).filter(task => ['j1', 'j2'].includes(task.historyId))
  assert.deepEqual(tasks.map(task => task.historyId), ['j1', 'j2'])
  assert.equal(new Set(result.state.history.filter(job => ['j1', 'j2'].includes(job.id)).map(job => job.teamId)).size, 1)
})
test('fails closed when a record changed, a technician vanished or a card is missing', () => {
  const base = { records: [{ id: 'j1', expected: { date: '2026-04-18', technicianIds: ['e1', 'e2'] }, set: { date: '2026-08-18', technicianIds: ['e1'] }, alignAgenda: true }] }
  const changed = fixture(); changed.history[0].date = '2026-04-19'
  assert.throws(() => applyConfirmedReconciliation(changed, base), /cambió en date/)
  const missingEmployee = structuredClone(base); missingEmployee.records[0].set.technicianIds = ['absent']
  assert.throws(() => applyConfirmedReconciliation(fixture(), missingEmployee), /ya no existe/)
  const missingCard = fixture(); missingCard.agenda.weekly['2026-04-18'].teams[0].tasks.shift()
  assert.throws(() => applyConfirmedReconciliation(missingCard, base), /No se encontró una tarjeta/)
})
test('a confirmation with no field change remains evidence and does not rewrite agenda', () => {
  const state = fixture()
  const result = applyConfirmedReconciliation(state, { records: [{ id: 'keep', expected: { date: '2026-04-18', technicianIds: ['e2'] }, set: { technicianIds: ['e2'] }, alignAgenda: false }] })
  assert.deepEqual(result.changedRecordIds, [])
  assert.deepEqual(result.state, state)
})
