const test = require('node:test')
const assert = require('node:assert/strict')
const { technicianStateUnchanged } = require('../api/_lib/conditional-technician-state.cjs')
const { readMeetingCandidates } = require('../api/_lib/meeting-candidates.cjs')
const { completeExpiredMonthlyMeetings } = require('../api/_lib/monthly-meeting-completion.cjs')

test('reuses a pending snapshot across polls, but fetches a new revision', async () => {
  const { createRevisionSnapshotCache } = await import('../src/domain/shared/revision-snapshot-cache.mjs')
  const cache = createRevisionSnapshotCache()
  let calls = 0
  const load = async revision => { calls++; return { revision, history: [revision] } }
  const first = await cache(1, () => load(1))
  for (let i = 0; i < 20; i++) assert.equal(await cache(1, () => load(1)), first)
  assert.equal(calls, 1)
  assert.deepEqual((await cache(2, () => load(2))).history, [2])
  assert.equal(calls, 2)
})
test('failed downloads retry and racing revisions use the actual snapshot revision', async () => {
  const { createRevisionSnapshotCache } = await import('../src/domain/shared/revision-snapshot-cache.mjs')
  const cache = createRevisionSnapshotCache()
  await assert.rejects(cache(1, async () => { throw new Error('offline') }), /offline/)
  const next = await cache(1, async () => ({ revision: 2 }))
  assert.equal(await cache(2, async () => { throw new Error('unnecessary download') }), next)
})
test('technical conditional reads require both revision and Argentina day', () => {
  const day = '2026-10-09'
  assert.equal(technicianStateUnchanged({ revision: '4', day }, 4, day), true)
  for (const query of [{}, { revision: '', day }, { revision: 'bad', day }, { revision: '3', day }, { revision: '4', day: '2026-10-08' }]) {
    assert.equal(technicianStateUnchanged(query, 4, day), false)
  }
})
test('meeting preflight reads small projections from the active storage model', async () => {
  for (const model of ['normalized', 'legacy', 'absent']) {
    const queries = []
    const record = { id: 'meeting', service: 'Reunión mensual', date: '2026-09-25', status: 'Pendiente' }
    const sql = { unsafe: async statement => {
      queries.push(statement)
      if (statement.includes('to_regclass')) return [{ import_batch: model === 'absent' ? null : 'batch' }]
      if (statement.includes('select id from')) return [{ id: 1 }]
      if (statement.includes('from normalized_shadow.storage_control')) return [{ active_model: model, active_revision: 1 }]
      return [{ data: record }]
    } }
    const history = await readMeetingCandidates(sql)
    const query = queries.at(-1)
    assert.match(query, /jsonb_build_object/)
    assert.match(query, model === 'normalized' ? /from normalized_shadow.history_evidence/ : /from pignus_work_history/)
    assert.doesNotMatch(query, /jsonb_agg|customers|agenda|photo/)
    assert.equal(completeExpiredMonthlyMeetings({ history }, '2026-09-25T22:59:59Z').changes.length, 0)
    assert.equal(completeExpiredMonthlyMeetings({ history }, '2026-09-25T23:00:00Z').changes.length, 1)
  }
})
