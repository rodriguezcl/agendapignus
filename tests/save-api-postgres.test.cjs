const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { normalizeStateForSave, visibleStateForUser, validateState } = require('../api/_lib/core.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')

function adapter(pg) {
  const sql = (strings, ...values) => {
    if (!strings?.raw) return { records: strings }
    let query = strings[0], params = []
    const parameter = value => { params.push(value?.jsonValue === undefined ? value : JSON.stringify(value.jsonValue)); return `$${params.length}` }
    values.forEach((value, i) => {
      if (value?.records) {
        const records = value.records
        if (records.length && typeof records[0] === 'object') {
          const columns = Object.keys(records[0])
          query += `(${columns.map(key => `"${key}"`).join(',')}) values ` + records.map(row => `(${columns.map(key => parameter(row[key])).join(',')})`).join(',')
        } else query += `(${records.map(parameter).join(',')})`
      } else query += parameter(value)
      query += strings[i + 1]
    })
    return pg.query(query, params).then(result => result.rows)
  }
  sql.json = value => ({ jsonValue: value })
  sql.query = (query, params) => pg.query(query, params)
  sql.unsafe = (query, params) => pg.query(query, params).then(result => result.rows)
  sql.begin = async callback => {
    await pg.exec('begin')
    try { const result = await callback(sql); await pg.exec('commit'); return result }
    catch (error) { await pg.exec('rollback'); throw error }
  }
  return sql
}

test('production PATCH handler commits compact responses, idempotent retries and conflicts against Postgres', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const { applyStateDelta } = await import('../src/domain/shared/state-delta.mjs')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..')
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const sql = adapter(pg)
    const state = { revision: 1, roles: [], employees: [], customers: [], services: [], vehicles: [], reviews: [], preferences: { theme: 'light' },
      history: [{ id: 'a', date: '2099-01-05', time: '09:00', status: 'Pendiente', detail: 'old', estimatedMinutes: 60 }, { id: 'b', date: '2099-01-06', time: '09:00', status: 'Pendiente', detail: 'old', estimatedMinutes: 60 }],
      agenda: { date: '2099-01-05', teams: [], weekly: {} } }
    state.services = [{ id: 's', code: 'other-service', name: 'Otro servicio', status: 'Activo', estimatedMinutes: 60 }]
    for (const record of state.history) { record.serviceId = 's'; record.service = 'Otro servicio' }
    const initial = { ...normalizeStateForSave(state, state), revision: 1 }
    validateState(initial, initial)
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences (key,value) values ('state_revision','1') on conflict (key) do update set value='1'")
    const analysis = require('../api/_lib/normalization-analysis.cjs').analyzeNormalization(initial)
    assert.equal(analysis.summary.bySeverity.error || 0, 0, JSON.stringify(analysis.issues.filter(issue => issue.severity === 'error')))
    const candidate = buildShadowCandidate(initial)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=1, active_fingerprint=$1 where id=1", [candidate.analysis.sourceFingerprint])
    const filename = path.join(root, 'api/index.js')
    const compiled = new Module(filename, module)
    compiled.filename = filename
    compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave = handleSaveState;', filename)
    const user = { id: 'admin', roleCode: 'administrator', name: 'QA', role: 'Administrador', permissions: { dashboard: true, weekly: true, agenda: true, history: true, accounts: true } }
    const before = visibleStateForUser(initial, user)
    const next = structuredClone(before); next.history[0].detail = 'saved'
    const operations = stateOperations(before, next)
    const save = async body => {
      const result = { headers: {} }
      const res = { setHeader: (key, value) => { result.headers[key] = value }, status(code) { result.status = code; return this }, json(value) { result.body = value; return value } }
      await compiled.exports.testSave({ method: 'PATCH', body }, res, sql, user)
      return result
    }
    const saved = await save({ revision: 1, operations, responseMode: 'delta-v1' })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.ok(saved.body.delta)
    assert.equal(saved.body.state, undefined)
    assert.match(saved.headers['Server-Timing'], /prepare_projection/)
    const projected = applyStateDelta(before, saved.body.delta)
    assert.equal(projected.history[0].detail, 'saved')
    const databaseState = await readState(sql)
    assert.deepEqual(visibleStateForUser(databaseState, user), projected)
    assert.deepEqual(await readNormalizedState(pg), databaseState)
    const replay = await save({ revision: 1, operations, responseMode: 'delta-v1' })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.revision, saved.body.revision)
    assert.ok(replay.body.state, 'stale response base falls back to full state')
    const conflict = await save({ revision: 1, operations: [{ ...operations[0], after: { ...operations[0].after, detail: 'stale overwrite' } }] })
    assert.equal(conflict.status, 409)
    assert.equal((await readState(sql)).history[0].detail, 'saved')
    const other = structuredClone(before); other.history[1].detail = 'independent'
    const independent = await save({ revision: 1, operations: stateOperations(before, other), responseMode: 'delta-v1' })
    assert.equal(independent.status, 200, JSON.stringify(independent.body))
    assert.equal(independent.body.state.history[0].detail, 'saved')
    assert.equal(independent.body.state.history[1].detail, 'independent')
  } finally { await pg.close() }
})
