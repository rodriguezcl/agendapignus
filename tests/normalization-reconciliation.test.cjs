const test = require('node:test')
const assert = require('node:assert/strict')
const { reconcileNormalization } = require('../api/_lib/normalization-reconciliation.cjs')
function fixture() {
  const job = { id: 'j1', sourceTaskId: 't1', date: '2026-08-25', time: '09:00', estimatedMinutes: 60, status: 'Completado', customerId: 'c1', serviceId: 's1', teamId: 'g1', technicianIds: ['e1'] }
  return { revision: 1, history: [job], customers: [{ customerId: 'c1' }], services: [{ id: 's1' }], roles: [{ id: 'r1' }], employees: [{ id: 'e1', roleId: 'r1' }], vehicles: [], agenda: { weekly: { '2026-08-26': { teams: [{ teamId: 'g1', memberIds: ['e1'], tasks: [{ ...job, historyId: 'j1', taskId: 't1', status: 'Pendiente' }] }] } } } }
}
test('reconciliation is deterministic, read-only and never certifies matching backups', () => {
  const state = fixture(), input = { backups: [{ key: 'backup_one', value: { history: state.history, secret: 'DO-NOT-EXPORT' } }] }
  const before = structuredClone({ state, input })
  const report = reconcileNormalization(state, input)
  assert.deepEqual({ state, input }, before)
  assert.deepEqual(report, reconcileNormalization(state, input))
  assert.equal(report.records[0].comparisons.date.classification, 'corroborated_not_certified')
  assert.equal(report.readyForCutover, false)
  assert.equal(report.productionModified, false)
  assert.ok(!JSON.stringify(report).includes('DO-NOT-EXPORT'))
})
test('repeated snapshots remain references to one variant, never majority votes', () => {
  const state = fixture()
  const old = { ...state.history[0], date: '2026-08-26' }
  const backups = [1, 2, 3].map(n => ({ key: `backup_${n}`, value: { history: [old] } }))
  backups.push({ key: 'backup_current', value: { history: state.history } })
  const comparison = reconcileNormalization(state, { backups }).records[0].comparisons.date
  assert.equal(comparison.classification, 'historical_variants_require_review')
  assert.equal(comparison.alternatives.length, 2)
  assert.equal(state.history[0].date, '2026-08-25')
})
test('audited before and after are separate observations, not automatically a repair', () => {
  const state = fixture()
  const audit = [{ id: 'a1', at: '2026-09-08T12:00:00Z', entity: 'Servicio / historial', before: { ...state.history[0], status: 'Pendiente' }, after: state.history[0] }]
  const report = reconcileNormalization(state, { audit })
  const status = report.records[0].comparisons.status
  assert.equal(status.alternatives.length, 2)
  assert.deepEqual(status.alternatives.flatMap(item => item.references.map(ref => ref.path)).sort(), ['after', 'before'])
  assert.equal(report.records[0].requiresDecision, true)
})
test('date and crew come from the agenda container rather than stale task fields', () => {
  const state = fixture()
  const report = reconcileNormalization(state, { backups: [{ key: 'backup_plan', value: { date: '2026-08-26', plan: state.agenda.weekly['2026-08-26'] } }] })
  assert.equal(report.records[0].comparisons.date.alternatives[0].value, '2026-08-26')
})
test('ambiguous links are quarantined and customer coincidence never matches evidence', () => {
  const state = fixture()
  state.history.push({ ...state.history[0], id: 'j2', sourceTaskId: 't2' })
  const report = reconcileNormalization(state, { backups: [{ key: 'backup_bad', value: { history: [{ ...state.history[0], id: 'j2' }, { customerId: 'c1', date: '2026-08-26' }] } }] })
  assert.equal(report.warnings[0].type, 'ambiguous_identity')
  assert.ok(report.records.every(row => row.matchedOccurrences === 0))
})
test('corrupt backups and absent fields are not treated as evidence', () => {
  const state = fixture()
  const report = reconcileNormalization(state, { backups: [{ key: 'backup_invalid', value: '{' }, { key: 'backup_partial', value: { history: [{ id: 'j1' }] } }] })
  assert.equal(report.warnings[0].type, 'unreadable_backup')
  assert.equal(report.records[0].comparisons.date.classification, 'no_evidence')
})
test('local history is distinguished from duplicated agenda projections', () => {
  const state = fixture()
  const report = reconcileNormalization(state, { backups: [{ key: 'local/example.db', value: { history: state.history, agenda: state.agenda } }] })
  const date = report.records[0].comparisons.date
  assert.equal(date.localHistoryClassification, 'corroborated_not_certified')
  assert.equal(date.localClassification, 'historical_variants_require_review')
  assert.equal(date.alternatives.length, 2)
})
