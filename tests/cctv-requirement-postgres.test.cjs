const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture } = require('./helpers/planning-click-fixture.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')

const root = path.resolve(__dirname, '..')
const supervisor = { id: 'supervisor', roleCode: 'supervisor', name: 'Supervisión' }
const key = 'Requiere llave de ingreso'

function loadHandler() {
  const filename = path.join(root, 'api/index.js')
  const compiled = new Module(filename, module)
  compiled.filename = filename
  compiled.paths = Module._nodeModulePaths(path.dirname(filename))
  compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports = handleCctvRequirement;', filename)
  return compiled.exports
}

for (const mode of ['legacy', 'normalized']) test(`PostgreSQL ${mode}: la ficha guarda el requerimiento con su revisión y auditoría`, async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg)
    const initial = fixture()
    initial.customers = [
      { customerId: 'a', kind: 'client', account: 'CLI-1', name: 'Cuenta A', cctvService: true, monthlyFee: 200 },
      { customerId: 'b', kind: 'client', account: 'CLI-2', name: 'Cuenta B', cctvService: false }
    ]
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    if (mode === 'normalized') {
      await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
      const candidate = buildShadowCandidate(await readState(sql))
      await insertShadowCandidate(pg, candidate)
      await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [initial.revision, candidate.analysis.sourceFingerprint])
    }
    const handle = loadHandler()
    const save = async (expectedRequirement, cctvRequirement, customerId = 'a') => {
      const response = { setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body } }
      await handle({ method: 'POST', body: { customerId, expectedRequirement, cctvRequirement } }, response, sql, supervisor)
      return response
    }
    const auditCount = async () => (await pg.query('select count(*)::int as count from pignus_audit_log')).rows[0].count
    const customer = state => state.customers.find(row => row.customerId === 'a')
    assert.equal((await save('', key, 'b')).code, 404)
    const before = await readState(sql)
    const saved = await save('', key)
    assert.equal(saved.code, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.revision, before.revision + 1)
    assert.equal(saved.body.state.revision, saved.body.revision)
    assert.deepEqual(saved.body.state.customers.map(row => row.customerId), ['a'])
    assert.equal(customer(saved.body.state).cctvRequirement, key)
    assert.equal(saved.body.customer.cctvRequirement, key)
    assert.equal(saved.body.customer.monthlyFee, undefined)
    const current = await readState(sql)
    assert.deepEqual(customer(current), { ...customer(before), cctvRequirement: key })
    assert.equal(current.revision, saved.body.revision)
    if (mode === 'normalized') assert.deepEqual(await readNormalizedState(pg), current)
    assert.equal((await save('', key)).body.revision, current.revision)
    assert.equal((await save('', 'Otro')).body.code, 'CCTV_REQUIREMENT_CONFLICT')
    assert.equal(await auditCount(), 1)

    const auditTable = mode === 'normalized' ? 'normalized_shadow.audit_events' : 'pignus_audit_log'
    await pg.exec(`create function reject_test_audit() returns trigger language plpgsql as $$ begin raise exception 'injected test failure'; end; $$;
      create trigger reject_test_audit before insert on ${auditTable} for each row execute function reject_test_audit();`)
    assert.equal((await save(key, 'Otro')).code, 500)
    assert.deepEqual(await readState(sql), current)
    assert.equal(await auditCount(), 1)
    if (mode === 'normalized') assert.deepEqual(await readNormalizedState(pg), current)
  } finally { await pg.close() }
})
