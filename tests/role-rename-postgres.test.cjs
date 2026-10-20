const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture } = require('./helpers/planning-click-fixture.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { normalizeStateForSave, userForEmployee, visibleStateForUser } = require('../api/_lib/core.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const catalog = require('../api/_lib/permission-catalog.cjs')

for (const granular of [false, true]) for (const method of ['PATCH', 'PUT']) test(`${granular ? 'granular' : 'legacy'} ${method}: renaming Usuario to Agente survives cold and warm serverless calls without changing assignments or permissions`, async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { applyStateDelta } = await import('../src/domain/shared/state-delta.mjs')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..')
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), raw = fixture()
    const target = { id: 'user', name: 'Usuario', code: 'user', description: 'Operación diaria', permissions: { dashboard: true, weekly: true, agenda: true, history: true, historyManage: true, accounts: true, employees: true } }
    raw.roles.push(target, { id: 'admin', name: 'Administrador', code: 'administrator', permissions: granular ? { __catalogV2: true } : {} })
    raw.employees = [
      ...raw.employees.map(employee => ({ ...employee, roleId: target.id, role: target.name })),
      { id: 'admin', firstName: 'Admin', lastName: 'Prueba', email: 'admin@example.test', roleId: 'admin', status: 'Activo' }
    ]
    const initial = { ...normalizeStateForSave(raw, raw), revision: 1 }
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const candidate = buildShadowCandidate(initial)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [initial.revision, candidate.analysis.sourceFingerprint])
    const filename = path.join(root, 'api/index.js')
    const handler = () => {
      const compiled = new Module(filename, module)
      compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
      compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave=handleSaveState;', filename)
      return compiled.exports.testSave
    }
    const call = async (save, body, user) => {
      const baseline = visibleStateForUser(await readNormalizedState(pg), user)
      const result = {}
      const res = { setHeader() {}, status(code) { result.status = code; return this }, json(body) { result.body = body; return body } }
      await save({ method, body }, res, sql, user)
      if (result.status === 200) {
        if (body.responseMode === 'delta-v1') {
          assert.ok(result.body.delta, 'Requested compact delta responses remain available for both supported write methods')
          assert.equal(result.body.state, undefined)
        }
        result.state = result.body.state || applyStateDelta(baseline, result.body.delta)
        assert.equal(result.state.sessionUser.id, user.id, 'HTTP response metadata continues to identify the authenticated session')
        const persisted = await readNormalizedState(pg)
        assert.equal(Object.hasOwn(persisted, 'sessionUser'), false)
        const controls = (await pg.query('select source_fingerprint, source_revision, active_fingerprint, active_revision from normalized_shadow.import_batch cross join normalized_shadow.storage_control where import_batch.id=1 and storage_control.id=1')).rows[0]
        const expected = buildShadowCandidate(persisted).analysis.sourceFingerprint
        assert.equal(controls.source_fingerprint, expected, 'The committed fingerprint matches a fresh database reconstruction')
        assert.equal(controls.active_fingerprint, expected)
        assert.equal(Number(controls.source_revision), persisted.revision)
        assert.equal(Number(controls.active_revision), persisted.revision)
      }
      return result
    }
    const user = userForEmployee(initial.employees.find(employee => employee.id === 'admin'), initial.roles)
    const request = (state, before, after) => method === 'PATCH'
      ? { revision: state.revision, responseMode: 'delta-v1', operations: [{ path: ['roles', { key: 'id', id: String(before.id) }], before, after, existed: true, exists: true }] }
      : { ...visibleStateForUser(state, user), responseMode: 'delta-v1', roles: state.roles.map(role => role.id === before.id ? after : role) }
    const descriptionOnly = { ...target, description: 'Operación diaria actualizada' }
    const prior = await call(handler(), request(initial, target, descriptionOnly), user)
    assert.equal(prior.status, 200, JSON.stringify(prior.body))
    const beforeRename = await readNormalizedState(pg)
    assert.equal(prior.state.sessionUser.id, user.id, 'Session metadata remains available in the HTTP response')
    assert.equal(Object.hasOwn(beforeRename, 'sessionUser'), false, 'Session metadata is not part of persisted application state')
    const firstBatch = (await pg.query('select source_fingerprint from normalized_shadow.import_batch where id=1')).rows[0]
    assert.equal(firstBatch.source_fingerprint, buildShadowCandidate(beforeRename).analysis.sourceFingerprint, 'A cold database reconstruction has the exact committed fingerprint')
    const visible = visibleStateForUser(beforeRename, user)
    const before = visible.roles.find(role => role.id === target.id)
    // Settings materializes the effective legacy permissions when an administrator
    // starts editing the role, even when the visible change is only its name.
    const after = { ...before, name: 'Agente', permissions: catalog.toGranularPermissions(before) }
    // A subsequent serverless invocation reconstructs the base from PostgreSQL,
    // independently of the previous request's process-local snapshot cache.
    const warmHandler = handler()
    const result = await call(warmHandler, request(beforeRename, before, after), user)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    const saved = await readState(sql), normalized = await readNormalizedState(pg)
    const role = saved.roles.find(role => role.id === target.id)
    assert.equal(role.name, 'Agente')
    assert.equal(role.id, target.id)
    assert.equal(role.code, target.code)
    assert.deepEqual(catalog.resolvePermissions(role), catalog.resolvePermissions(target))
    for (const id of ['one', 'two']) {
      const employee = saved.employees.find(employee => employee.id === id)
      assert.equal(employee.roleId, target.id)
      assert.equal(employee.role, 'Agente')
    }
    const byId = (left, right) => String(left.id).localeCompare(String(right.id))
    const comparable = state => ({ ...state, roles: state.roles.toSorted(byId), employees: state.employees.toSorted(byId) })
    assert.deepEqual(comparable(normalized), comparable(saved))
    assert.equal(saved.revision, 3)
    assert.deepEqual(saved.history, beforeRename.history)
    assert.deepEqual(saved.agenda, beforeRename.agenda)
    const nextRole = { ...role, name: 'Agente operativo' }
    const warmResult = await call(warmHandler, request(normalized, role, nextRole), user)
    assert.equal(warmResult.status, 200, JSON.stringify(warmResult.body))
    assert.equal((await readNormalizedState(pg)).roles.find(role => role.id === target.id).name, 'Agente operativo')
    const last = await readNormalizedState(pg)
    const finalRole = last.roles.find(role => role.id === target.id)
    const coldResult = await call(handler(), request(last, finalRole, { ...finalRole, description: 'Coordinación operativa' }), user)
    assert.equal(coldResult.status, 200, JSON.stringify(coldResult.body))
    const finalState = await readNormalizedState(pg)
    const finalBatch = (await pg.query('select source_fingerprint from normalized_shadow.import_batch where id=1')).rows[0]
    assert.equal(finalBatch.source_fingerprint, buildShadowCandidate(finalState).analysis.sourceFingerprint)
  } finally { await pg.close() }
})
