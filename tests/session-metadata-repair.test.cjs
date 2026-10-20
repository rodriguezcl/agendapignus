const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture } = require('./helpers/planning-click-fixture.cjs')
const { normalizeStateForSave, userForEmployee, stateSessionUser } = require('../api/_lib/core.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const { inspectSessionMetadataRepair, repairSessionMetadata } = require('../api/_lib/session-metadata-repair.cjs')

async function setup(poisoned = true) {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create(), statements = [], sql = pgliteAdapter(pg, statements)
  await pg.exec('create role anon; create role authenticated;')
  await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
  await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
  const raw = fixture()
  raw.roles.push({ id: 'admin', code: 'administrator', name: 'Administrador', permissions: {} })
  raw.employees.push({ id: 'admin', firstName: 'Admin', lastName: 'Prueba', roleId: 'admin', email: 'admin@example.test', status: 'Activo', passwordHash: 'PRESERVED_CREDENTIAL' })
  const state = normalizeStateForSave(raw, raw)
  const user = userForEmployee(state.employees.find(employee => employee.id === 'admin'), state.roles)
  const candidate = buildShadowCandidate(poisoned ? { ...state, sessionUser: stateSessionUser(state, user) } : state)
  await replaceCollections(sql, state)
  await pg.query("insert into pignus_preferences(key,value) values('state_revision',$1) on conflict(key) do update set value=excluded.value", [String(state.revision)])
  await insertShadowCandidate(pg, candidate)
  await pg.query("insert into normalized_shadow.employee_credentials(employee_id,password_hash) values('admin','PRESERVED_CREDENTIAL')")
  await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [state.revision, candidate.analysis.sourceFingerprint])
  statements.length = 0
  return { pg, sql, state, user, statements, expected: { expectedRevision: state.revision, expectedFingerprint: candidate.analysis.sourceFingerprint } }
}

const withoutRevision = ({ revision, ...state }) => state
async function metadata(pg) {
  return (await pg.query(`select
    (select value from pignus_preferences where key='state_revision') as legacy,
    (select row_to_json(batch) from normalized_shadow.import_batch batch where id=1) as batch,
    (select row_to_json(control) from normalized_shadow.storage_control control where id=1) as control`)).rows[0]
}

test('read-only diagnosis recognizes the exact session metadata fingerprint and healthy state is a no-op', async () => {
  for (const poisoned of [true, false]) {
    const context = await setup(poisoned)
    const { pg, sql, statements, expected } = context
    try {
      const before = await metadata(pg)
      const result = await inspectSessionMetadataRepair(sql)
      assert.equal(result.healthy, !poisoned)
      assert.equal(result.repairable, poisoned)
      assert.equal(result.applied, false)
      assert.equal(result.nextRevision, expected.expectedRevision + Number(poisoned))
      assert.ok(!statements.some(statement => /^\s*(update|insert|delete)\b/i.test(statement)))
      assert.deepEqual(await metadata(pg), before)
      assert.ok(!JSON.stringify(result).includes('example.test'))
      assert.ok(!JSON.stringify(result).includes('PRESERVED_CREDENTIAL'))
      if (!poisoned) {
        assert.equal((await repairSessionMetadata(sql, expected)).applied, false)
        assert.deepEqual(await metadata(pg), before)
      }
    } finally { await pg.close() }
  }
})

test('repair refuses unrecognized hashes, inconsistent selectors and stale or missing expectations', async () => {
  const { pg, sql, expected } = await setup()
  try {
    await assert.rejects(repairSessionMetadata(sql), { code: 'SESSION_METADATA_REPAIR_EXPECTED_BASE_REQUIRED' })
    await assert.rejects(repairSessionMetadata(sql, { ...expected, expectedRevision: expected.expectedRevision + 1 }), { code: 'SESSION_METADATA_REPAIR_STALE_EXPECTATION' })
    await assert.rejects(repairSessionMetadata(sql, { ...expected, expectedFingerprint: 'a'.repeat(64) }), { code: 'SESSION_METADATA_REPAIR_STALE_EXPECTATION' })
    const before = await metadata(pg)
    await pg.query("update normalized_shadow.import_batch set source_fingerprint=$1 where id=1", ['b'.repeat(64)])
    await assert.rejects(inspectSessionMetadataRepair(sql), { code: 'SESSION_METADATA_REPAIR_STORAGE_MISMATCH' })
    await pg.query("update normalized_shadow.storage_control set active_fingerprint=$1 where id=1", ['b'.repeat(64)])
    const tampered = await metadata(pg)
    await assert.rejects(repairSessionMetadata(sql, { ...expected, expectedFingerprint: 'b'.repeat(64) }), { code: 'SESSION_METADATA_REPAIR_UNRECOGNIZED_FINGERPRINT' })
    assert.deepEqual(await metadata(pg), tampered)
    assert.equal(tampered.legacy, before.legacy)
  } finally { await pg.close() }
})

test('repair updates only revision metadata, invalidates warm caches and allows the real cold API rename', async () => {
  const { pg, sql, state, user, statements, expected } = await setup()
  try {
    const legacyBefore = await readState(sql)
    const normalizedBefore = await readNormalizedState(pg, { includeCredentials: true })
    const { createSaveSnapshotCache } = require('../api/_lib/save-snapshot-cache.cjs')
    let freshReads = 0
    const cache = createSaveSnapshotCache({ readFresh: async transaction => {
      freshReads++
      return require('../api/_lib/storage-router.cjs').readApplicationState(transaction)
    } })
    cache.remember({ ...state, sessionUser: stateSessionUser(state, user) })
    statements.length = 0
    const result = await repairSessionMetadata(sql, expected)
    assert.equal(result.applied, true)
    assert.equal(result.nextRevision, state.revision + 1)
    const updates = statements.filter(statement => /^\s*update\b/i.test(statement))
    assert.equal(updates.length, 3)
    assert.ok(updates.every(statement => /^\s*update (pignus_preferences|normalized_shadow\.(import_batch|storage_control))\b/i.test(statement)))
    const locks = statements.filter(statement => /for update/.test(statement))
    assert.match(locks[0], /pignus_preferences/)
    assert.match(locks[1], /import_batch/)
    assert.match(locks[2], /storage_control/)
    const legacyAfter = await readState(sql)
    const normalizedAfter = await readNormalizedState(pg, { includeCredentials: true })
    assert.deepEqual(withoutRevision(legacyAfter), withoutRevision(legacyBefore))
    assert.deepEqual(withoutRevision(normalizedAfter), withoutRevision(normalizedBefore))
    const cached = await cache.read(sql)
    assert.equal(freshReads, 1)
    assert.equal(Object.hasOwn(cached, 'sessionUser'), false)
    assert.equal(cached.revision, result.nextRevision)
    assert.equal((await inspectSessionMetadataRepair(sql)).healthy, true)
    const filename = path.resolve(__dirname, '../api/index.js')
    const compiled = new Module(filename, module)
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSave=handleSaveState;', filename)
    const before = normalizedAfter.roles.find(role => role.id === 'tech')
    const response = {}
    await compiled.exports.testSave({
      method: 'PATCH',
      body: { revision: normalizedAfter.revision, operations: [{ path: ['roles', { key: 'id', id: before.id }], before, after: { ...before, name: 'Agente' }, existed: true, exists: true }] }
    }, { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body } }, sql, user)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const saved = await readNormalizedState(pg, { includeCredentials: true })
    assert.equal(saved.roles.find(role => role.id === before.id).name, 'Agente')
    assert.equal(saved.employees.find(employee => employee.id === 'admin').passwordHash, 'PRESERVED_CREDENTIAL')
    assert.equal((await inspectSessionMetadataRepair(sql)).healthy, true)
  } finally { await pg.close() }
})

test('a failure during repair rolls back all three metadata updates', async () => {
  const { pg, expected } = await setup()
  try {
    const before = await metadata(pg)
    const failing = {
      exec: statement => pg.exec(statement),
      query: (statement, values) => {
        if (/^update normalized_shadow\.storage_control/.test(statement)) throw new Error('INJECTED_REPAIR_FAILURE')
        return pg.query(statement, values)
      }
    }
    await assert.rejects(repairSessionMetadata(failing, expected), /INJECTED_REPAIR_FAILURE/)
    assert.deepEqual(await metadata(pg), before)
  } finally { await pg.close() }
})
