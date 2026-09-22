const test = require('node:test')
const assert = require('node:assert/strict')
const { createSaveSnapshotCache } = require('../api/_lib/save-snapshot-cache.cjs')
const { preparedSnapshots } = require('../api/_lib/storage-router.cjs')

test('save snapshot cache checks live revisions and credentials, isolates callers and invalidates other writers', async () => {
  let revision = 1, batchRevision = 1, model = 'normalized', hash = 'fresh', reads = 0, queries = 0
  const fresh = () => {
    reads++
    const state = { revision, employees: [{ id: 'e', passwordHash: hash }], history: [{ id: 'a', detail: `rev-${revision}` }] }
    if (model === 'normalized') preparedSnapshots.add(state)
    return state
  }
  const cache = createSaveSnapshotCache({ readFresh: async () => fresh() })
  const sql = { query: async () => { queries++; return { rows: [{ revision, batch_revision: batchRevision, model, credentials: { e: hash } }] } } }
  const first = await cache.read(sql)
  first.history[0].detail = 'must not contaminate cache'
  hash = 'new password'
  const hit = await cache.read(sql)
  assert.equal(reads, 1)
  assert.equal(queries, 1)
  assert.equal(hit.history[0].detail, 'rev-1')
  assert.equal(hit.employees[0].passwordHash, 'new password')
  revision = batchRevision = 2
  assert.equal((await cache.read(sql)).history[0].detail, 'rev-2')
  assert.equal(reads, 2)
  cache.remember({ revision: 1, employees: [], history: [] })
  assert.equal((await cache.read(sql)).revision, 2)
  assert.equal(reads, 2)
  batchRevision = 3
  await cache.read(sql)
  assert.equal(reads, 3, 'mismatched database revisions cannot be a hit')
  model = 'legacy'
  await cache.read(sql)
  await cache.read(sql)
  assert.equal(reads, 5, 'storage switch disables normalized cache')
})
