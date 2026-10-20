const test = require('node:test')
const assert = require('node:assert/strict')
const { ensureCommittedSchema } = require('../api/_lib/schema-readiness.cjs')

test('schema initialization shares in-flight work and caches only committed success', async () => {
  let release, initializations = 0, commits = 0
  const gate = new Promise(resolve => { release = resolve })
  const sql = { begin: async callback => { await callback({}); await gate; commits++ } }
  const initialize = async () => { initializations++ }
  const first = ensureCommittedSchema(sql, 'photos', initialize)
  const second = ensureCommittedSchema(sql, 'photos', initialize)
  await Promise.resolve()
  assert.equal(initializations, 1)
  assert.equal(commits, 0)
  release()
  await Promise.all([first, second])
  await ensureCommittedSchema(sql, 'photos', initialize)
  assert.equal(initializations, 1)
  assert.equal(commits, 1)
  await ensureCommittedSchema({ begin: async callback => callback({}) }, 'photos', initialize)
  assert.equal(initializations, 2, 'a different database pool must initialize independently')
})

test('a failed schema commit clears readiness and the next access retries', async () => {
  let attempts = 0, initializations = 0
  const sql = { begin: async callback => { await callback({}); if (!attempts++) throw new Error('commit failed') } }
  const initialize = async () => { initializations++ }
  await assert.rejects(ensureCommittedSchema(sql, 'photos', initialize), /commit failed/)
  await ensureCommittedSchema(sql, 'photos', initialize)
  await ensureCommittedSchema(sql, 'photos', initialize)
  assert.equal(initializations, 2)
  assert.equal(attempts, 2)
})
