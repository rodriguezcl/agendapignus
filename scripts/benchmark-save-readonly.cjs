// Read-only production diagnostic. Never persists or prints operational data.
const { performance } = require('node:perf_hooks')
const { database } = require('../api/_lib/database.cjs')
const { readApplicationState, storageMode, preparedSnapshots } = require('../api/_lib/storage-router.cjs')
const { prepareNormalizedStateWrite } = require('../api/_lib/normalized-state-repository.cjs')
const cache = require('../api/_lib/save-snapshot-cache.cjs').createSaveSnapshotCache()

async function main() {
  const sql = database()
  try {
    const samples = []
    for (let i = 0; i < 3; i++) {
      const start = performance.now()
      const state = await sql.begin(async tx => {
        await tx`set transaction read only`
        return cache.read(tx)
      })
      const readMs = performance.now() - start
      const prepareStart = performance.now()
      prepareNormalizedStateWrite(state, { ...state, revision: state.revision + 1 })
      samples.push({ readMs: Math.round(readMs), prepareMs: Math.round(performance.now() - prepareStart), consolidatedNormalizedRead: preparedSnapshots.has(state), historyRecords: state.history.length, customers: state.customers.length })
    }
    console.log(JSON.stringify({ writeExecuted: false, mode: storageMode(), samples }))
  } finally { await sql.end() }
}
main().catch(error => { console.error('Read-only benchmark failed:', error.code || error.name); process.exitCode = 1 })
