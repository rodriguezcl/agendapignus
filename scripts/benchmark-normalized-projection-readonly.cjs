// Compare CPU preparation against the checked-in baseline. The database is
// read only; synchronization runs against a recording-free in-memory adapter.
const { performance } = require('node:perf_hooks')
const { execFileSync } = require('node:child_process')
const Module = require('node:module')
const path = require('node:path')
const { database } = require('../api/_lib/database.cjs')
const current = require('../api/_lib/normalized-state-repository.cjs')
const { readApplicationState } = require('../api/_lib/storage-router.cjs')

function compileRepository(source) {
  const filename = path.resolve(__dirname, '../api/_lib/normalized-state-repository.cjs')
  const baseline = new Module(filename, module)
  baseline.filename = filename
  baseline.paths = Module._nodeModulePaths(path.dirname(filename))
  baseline._compile(source, filename)
  return baseline.exports
}

async function measure(repository, previous, next) {
  const start = performance.now()
  const prepared = repository.prepareNormalizedStateWrite(previous, next)
  const preparedAt = performance.now()
  let queries = 0
  const sql = { query: async statement => {
    queries++
    if (/select source_fingerprint, source_revision/.test(statement)) return { rows: [{ source_fingerprint: prepared.previous.analysis.sourceFingerprint, source_revision: previous.revision }] }
    if (/select employee_id, password_hash/.test(statement)) return { rows: previous.employees.filter(employee => employee.passwordHash).map(employee => ({ employee_id: employee.id, password_hash: employee.passwordHash })) }
    return { rows: [] }
  } }
  await repository.synchronizeNormalizedStateInTransaction(sql, previous, next, prepared)
  return {
    prepareMs: Math.round(preparedAt - start),
    lockedCpuMs: Math.round(performance.now() - preparedAt),
    totalCpuMs: Math.round(performance.now() - start),
    simulatedQueries: queries
  }
}

async function main() {
  const sql = database()
  try {
    const state = await sql.begin(async transaction => {
      await transaction`set transaction read only`
      return readApplicationState(transaction)
    })
    const baselineRef = process.argv[2] || 'HEAD'
    const baseline = compileRepository(execFileSync('git', ['show', `${baselineRef}:api/_lib/normalized-state-repository.cjs`], { encoding: 'utf8' }))
    const next = { ...state, revision: state.revision + 1, history: state.history.map((row, index) => index ? row : { ...row, servicePreparation: { ...row.servicePreparation, materialsReady: true } }) }
    const samples = []
    for (let index = 0; index < 6; index++) {
      const sample = {}
      const variants = { before: baseline, after: current }
      const order = Object.keys(variants)
      for (const label of [...order.slice(index % 2), ...order.slice(0, index % 2)]) sample[label] = await measure(variants[label], state, next)
      samples.push(sample)
    }
    console.log(JSON.stringify({ writeExecuted: false, simulationOnly: true, baselineRef, historyRecords: state.history.length, customers: state.customers.length, samples }))
  } finally { await sql.end() }
}

main().catch(error => { console.error('Read-only projection benchmark failed:', error.code || error.name); process.exitCode = 1 })
