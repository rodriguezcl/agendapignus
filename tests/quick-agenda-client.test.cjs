const test = require('node:test')
const assert = require('node:assert/strict')

test('readiness builds one atomic operation without inspecting unrelated collections or records', async () => {
  const { servicePreparationOperations } = await import('../src/features/state/application/service-preparation.mjs')
  const record = { id: 'service-1', status: 'Pendiente', detail: 'Original', teamId: 'team-1', date: '2026-10-20' }
  const unrelated = { id: 'other', get detail() { throw new Error('Unrelated record was serialized') } }
  const snapshot = {
    history: [unrelated, record],
    get customers() { throw new Error('Customer directory was visited') },
    get agenda() { throw new Error('Whole agenda was visited') }
  }
  const operations = servicePreparationOperations(snapshot, { base: { ...record }, ready: true })
  assert.deepEqual(operations, [{
    path: ['history', { key: 'id', id: record.id }],
    before: record, after: { ...record, servicePreparation: { ready: true } },
    existed: true, exists: true
  }])
  assert.equal(record.servicePreparation, undefined)
  assert.throws(() => servicePreparationOperations(snapshot, { base: { ...record, detail: 'Stale' }, ready: true }), /cambió/)
})

test('readiness keeps display enrichment out of its persisted record without rebasing drafts', async () => {
  const { servicePreparationOperations } = await import('../src/features/state/application/service-preparation.mjs')
  const { alignOperationBaselines } = await import('../src/features/state/application/operation-baselines.mjs')
  const { preparePlanningClick } = require('../api/_lib/planning-click-operation.cjs')
  const { fixture, admin } = require('./helpers/planning-click-fixture.cjs')
  const server = fixture()
  const original = server.history[0]
  const display = { ...server, history: [{ ...original, estimatedMinutesCustomized: false, clientAccount: 'PIG-7001', clientNameAtService: 'Cliente visible' }] }
  const operations = servicePreparationOperations(display, { base: display.history[0], ready: true })
  const aligned = alignOperationBaselines(operations, display, server)
  assert.deepEqual(aligned[0].before, original)
  assert.deepEqual(aligned[0].after, { ...original, servicePreparation: { ready: true } })
  const saved = preparePlanningClick(server, aligned, admin)
  assert.equal(saved.kind, 'service_preparation')
  assert.equal(saved.state.history[0].servicePreparation.ready, true)
  assert.equal(saved.state.history[0].clientAccount, original.clientAccount)
  const draft = { ...display, history: [{ ...display.history[0], detail: 'Unconfirmed edit' }] }
  const draftOperations = servicePreparationOperations(draft, { base: draft.history[0], ready: true })
  const untouched = alignOperationBaselines(draftOperations, display, server)
  assert.equal(untouched[0], draftOperations[0])
  assert.throws(() => preparePlanningClick(server, untouched, admin), { code: 'RECORD_WRITE_CONFLICT' })
})

const membership = (id, day = '2026-10-20') => [{
  path: ['agenda', 'weekly', day, 'teams', { key: 'teamId', id }, 'memberIds'],
  before: [], after: ['tech-1'], existed: true, exists: true
}]
const service = (id, teamId, date = '2026-10-20') => [{
  path: ['history', { key: 'id', id }],
  before: { id, teamId, date, sourceTaskId: `task-${id}` },
  after: { id, teamId, date, sourceTaskId: `task-${id}`, servicePreparation: { ready: true } }
}]

test('different team selections can save concurrently while their own service edits remain exclusive', async () => {
  const { operationScopes, createSaveActivity } = await import('../src/features/state/application/save-activity.mjs')
  const activity = createSaveActivity()
  const release = activity.acquire(operationScopes(membership('team-1')))
  const releaseOther = activity.acquire(operationScopes(membership('team-2')))
  assert.throws(() => activity.acquire(operationScopes(membership('team-1'))), /ya se está guardando/)
  assert.throws(() => activity.acquire(operationScopes(service('a', 'team-1'))), /ya se está guardando/)
  const releaseLaterDay = activity.acquire(operationScopes(membership('team-1', '2026-10-21')))
  release(); releaseOther(); releaseLaterDay()
  const releaseService = activity.acquire(operationScopes(service('a', 'team-1')))
  const releaseSecondService = activity.acquire(operationScopes(service('b', 'team-1')))
  assert.throws(() => activity.acquire(operationScopes(membership('team-1'))), /ya se está guardando/)
  assert.throws(() => activity.acquire(operationScopes(service('a', 'team-1'))), /ya se está guardando/)
  releaseService(); releaseSecondService()
  assert.equal(activity.size, 0)
})

test('daily projections protect the same team, and structural changes retain global exclusivity', async () => {
  const { operationScopes, createSaveActivity } = await import('../src/features/state/application/save-activity.mjs')
  const daily = [{ path: ['agenda', 'teams', { key: 'teamId', id: 'team-1' }, 'members'], before: [], after: ['Técnico'] }]
  const activity = createSaveActivity()
  const release = activity.acquire(operationScopes(daily))
  assert.throws(() => activity.acquire(operationScopes(service('a', 'team-1'))), /ya se está guardando/)
  const other = activity.acquire(operationScopes(membership('team-2')))
  other(); release()
  for (const path of [
    ['agenda', 'weekly', '2026-10-20'],
    ['agenda', 'weekly', '2026-10-20', 'teams', { key: 'teamId', id: 'team-1' }],
    ['agenda', 'weekly', '_monthlyTeams', '2026-10', 'teams', { key: 'teamId', id: 'team-1' }, 'memberIds']
  ]) assert.deepEqual(operationScopes([{ path, after: {} }]), ['*'])
})
