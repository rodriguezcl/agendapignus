const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { performance } = require('node:perf_hooks')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture, admin, day } = require('./helpers/planning-click-fixture.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { visibleStateForUser } = require('../api/_lib/core.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')

test('planning clicks retain transactional guards, deltas, audit and both models in PostgreSQL', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { servicePreparationOperations } = await import('../src/features/state/application/service-preparation.mjs')
  const { weeklyTeamMemberOperations } = await import('../src/features/state/application/weekly-team-members-save.mjs')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const { applyStateDelta } = await import('../src/domain/shared/state-delta.mjs')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..'), statements = []
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg, statements)
    const initial = fixture()
    initial.agenda.weekly._monthlyTeams = { '2099-01': { teams: [], defaultTimes: ['09:00'] } }
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave = handleSaveState;', filename)
    const call = async (before, operations, user = admin) => {
      statements.length = 0
      const response = { headers: {} }, start = performance.now()
      const res = { setHeader(key, value) { response.headers[key] = value }, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
      await compiled.exports.testSave({ method: 'PATCH', body: { revision: before.revision, operations, responseMode: 'delta-v1' } }, res, sql, user)
      response.elapsedMs = Math.round(performance.now() - start); response.queries = [...statements]
      return response
    }
    const ready = servicePreparationOperations(initial, { base: initial.history[0], ready: true })
    const legacySaved = await call(initial, ready)
    assert.equal(legacySaved.status, 200, JSON.stringify(legacySaved.body))
    assert.equal(legacySaved.body.revision, 2)
    assert.ok(legacySaved.queries[0].includes("set_config('lock_timeout'"))
    assert.equal(legacySaved.queries.filter(query => query.includes('set_config')).length, 1)
    assert.equal((await pg.query("select current_setting('lock_timeout') as value")).rows[0].value, '0', 'transaction settings must not leak')
    const legacy = await readState(sql)
    assert.deepEqual(applyStateDelta(visibleStateForUser(initial, admin), legacySaved.body.delta), visibleStateForUser(legacy, admin))
    assert.deepEqual(applyStateDelta(visibleStateForUser(initial, admin), legacySaved.body.delta).sessionUser, admin, 'fast ready response retains public session identity through its delta')
    assert.equal(Object.hasOwn(legacy, 'sessionUser'), false, 'response metadata is not persisted')
    assert.equal(legacy.history[0].servicePreparation.byId, 'admin')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const candidate = buildShadowCandidate(legacy)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [legacy.revision, candidate.analysis.sourceFingerprint])
    const members = state => {
      const team = state.agenda.weekly[day].teams[0]
      return weeklyTeamMemberOperations(state, { day, teamId: 'team', teamIndex: 0, baseMemberIds: team.memberIds, baseMembers: team.members, memberIds: ['two'], members: ['two Técnico'] })
    }
    const membership = members(legacy)
    const planner = { id: 'planner', name: 'Planificador', roleCode: 'user', permissions: { weekly: true, history: true, weeklyHours: true } }
    const assigned = await call(legacy, membership, planner)
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body))
    const saved = await readState(sql)
    assert.deepEqual(saved.history[0].technicianIds, ['two'])
    assert.deepEqual(await readNormalizedState(pg), saved)
    assert.deepEqual(applyStateDelta(visibleStateForUser(legacy, planner), assigned.body.delta), visibleStateForUser(saved, planner))
    assert.deepEqual(applyStateDelta(visibleStateForUser(legacy, planner), assigned.body.delta).sessionUser, planner, 'fast membership response retains public session identity through its delta')
    assert.equal(Object.hasOwn(saved, 'sessionUser'), false)
    const audit = () => pg.query('select data from pignus_audit_log order by occurred_at,id').then(result => result.rows)
    const baselineAudit = await audit()
    // Force a fresh server instance so its snapshot comes from persisted JSON,
    // where absent optional configuration keys are omitted.
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave = handleSaveState;', filename)
    const replay = await call(legacy, membership, planner)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.revision, saved.revision)
    assert.deepEqual(await audit(), baselineAudit)
    const readyAgain = servicePreparationOperations(saved, { base: saved.history[0], ready: false })
    const failedQuery = sql.query
    sql.query = async (statement, params) => {
      if (/insert into normalized_shadow.audit_events/.test(statement)) throw new Error('injected final audit failure')
      return failedQuery(statement, params)
    }
    const rolledBack = await call(saved, readyAgain)
    assert.equal(rolledBack.status, 400)
    sql.query = failedQuery
    assert.deepEqual(await readState(sql), saved)
    assert.deepEqual(await readNormalizedState(pg), saved)
    assert.deepEqual(await audit(), baselineAudit)
    const unready = await call(saved, readyAgain)
    assert.equal(unready.status, 200, JSON.stringify(unready.body))
    const afterReady = await readState(sql)
    assert.equal(afterReady.history[0].servicePreparation.ready, false)
    const repeatedReady = await call(saved, readyAgain)
    assert.equal(repeatedReady.status, 200)
    assert.equal(repeatedReady.body.revision, afterReady.revision)
    assert.deepEqual(await readNormalizedState(pg), afterReady)
    const changed = structuredClone(saved); changed.history[0].detail = 'Concurrent edit'
    const edit = await call(saved, stateOperations(saved, changed))
    assert.equal(edit.status, 409, 'whole-record conflict still sees server preparation change')
    const denied = await call(afterReady, servicePreparationOperations(afterReady, { base: afterReady.history[0], ready: true }), { id: 'readonly', roleCode: 'operator' })
    assert.equal(denied.status, 403)
    assert.deepEqual(await readState(sql), afterReady)
    assert.ok((await pg.query('select count(*)::int as count from normalized_shadow.audit_events')).rows[0].count > 0)
    console.info(JSON.stringify({ scope: 'isolated_planning_click', legacyReady: { elapsedMs: legacySaved.elapsedMs, queries: legacySaved.queries.length }, normalizedMembership: { elapsedMs: assigned.elapsedMs, queries: assigned.queries.length }, normalizedReady: { elapsedMs: unready.elapsedMs, queries: unready.queries.length }, replayQueries: repeatedReady.queries.length }))
  } finally { await pg.close() }
})

test('a revision change during preparation retries from fresh state and preserves an interleaved writer', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { servicePreparationOperations } = await import('../src/features/state/application/service-preparation.mjs')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..')
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), initial = fixture()
    initial.history.push({ ...initial.history[0], id: 'independent', sourceTaskId: 'independent-task', date: '2099-01-06', detail: 'before' })
    await replaceCollections(sql, initial)
    await pg.query("update pignus_preferences set value='1' where key='state_revision'")
    const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave = handleSaveState; module.exports.testPersist = persistStateCollections;', filename)
    const begin = sql.begin
    let attempts = 0, interleaved = false
    sql.begin = async callback => {
      attempts++
      try {
        return await begin(transaction => {
          const wrapped = (strings, ...values) => {
            const result = transaction(strings, ...values)
            if (attempts === 1 && strings?.raw && /state_revision.*for update/s.test(strings.join(''))) {
              return result.then(rows => rows.map(row => ({ ...row, value: String(Number(row.value) + 1) })))
            }
            return result
          }
          Object.assign(wrapped, transaction)
          return callback(wrapped)
        })
      } catch (error) {
        if (error.code === 'PREPARED_STATE_CHANGED' && !interleaved) {
          // PGlite serializes sessions. Commit the independent writer after
          // the obsolete attempt rolls back and before its retry starts.
          const concurrent = structuredClone(initial)
          concurrent.history[1].detail = 'committed by another session'
          await begin(transaction => compiled.exports.testPersist(transaction, initial, concurrent, 2))
          interleaved = true
        }
        throw error
      }
    }
    const operations = servicePreparationOperations(initial, { base: initial.history[0], ready: true })
    const response = {}, res = { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
    await compiled.exports.testSave({ method: 'PATCH', body: { revision: 1, operations, responseMode: 'delta-v1' } }, res, sql, admin)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(attempts, 2)
    const saved = await readState(sql)
    assert.equal(saved.revision, 3)
    assert.equal(saved.history.find(record => record.id === 'work').servicePreparation.ready, true)
    assert.equal(saved.history.find(record => record.id === 'independent').detail, 'committed by another session')
    assert.ok(response.body.state, 'a stale delta base must receive the current full visible state')
    assert.equal((await pg.query('select count(*)::int as n from pignus_audit_log')).rows[0].n, 2, 'only the committed attempt audits history and agenda')
  } finally { await pg.close() }
})
