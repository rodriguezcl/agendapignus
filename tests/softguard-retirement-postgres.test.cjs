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
const { softguardRetirementBase, softguardRetirementPending } = require('../api/_lib/softguard-retirement.cjs')

const root = path.resolve(__dirname, '..')
const actor = keys => ({ id: 'resolver', name: 'Operación', roleCode: 'custom', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])) } })
const request = customer => ({ customerId: customer.customerId, base: softguardRetirementBase(customer) })

for (const mode of ['legacy', 'normalized']) test(`SoftGuard PostgreSQL handler (${mode}): permissions, customer scope, lifecycle CAS and atomic audit rollback`, async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), initial = fixture()
    initial.customers = [
      { customerId: 'retired-a', kind: 'client', account: 'CLI-0176', name: 'CLIENTE A', convertedFromAccount: 'PIG-0704', subscriptionEndedAt: '2026-10-20T15:00:00.000Z', cctvService: true },
      { customerId: 'retired-b', kind: 'client', account: 'CLI-0177', name: 'CLIENTE B', convertedFromAccount: 'PIG-0705', subscriptionEndedAt: '2026-10-20T16:00:00.000Z', cctvService: false }
    ]
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    if (mode === 'normalized') {
      await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
      const candidate = buildShadowCandidate(initial)
      await insertShadowCandidate(pg, candidate)
      await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [initial.revision, candidate.analysis.sourceFingerprint])
    }
    const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename
    compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testSoftguardRetirement=handleSoftguardRetirement;', filename)
    const call = async (body, user) => {
      const response = {}
      const res = { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
      await compiled.exports.testSoftguardRetirement({ method: 'POST', body }, res, sql, user)
      return response
    }
    const auditCount = async () => (await pg.query('select count(*)::int as count from pignus_audit_log')).rows[0].count
    const before = await readState(sql), first = before.customers.find(row => row.customerId === 'retired-a')
    const second = before.customers.find(row => row.customerId === 'retired-b')
    const resolver = actor(['accounts.view', 'customers.softguard.resolve'])
    const scoped = { ...resolver, permissions: { ...resolver.permissions, 'scope.customers.read.cctv': true } }
    for (const user of [actor(['accounts.view']), actor(['customers.softguard.resolve'])]) {
      assert.equal((await call(request(first), user)).status, 403)
    }
    assert.equal((await call(request(second), scoped)).status, 403)
    assert.deepEqual(await readState(sql), before)
    assert.equal(await auditCount(), 0)

    const allowed = await call(request(first), scoped)
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
    assert.deepEqual(allowed.body, { ok: true, revision: before.revision + 1 })
    const saved = await readState(sql), completed = saved.customers.find(row => row.customerId === first.customerId)
    assert.equal(completed.softguardRetirementResolution.completedBy, resolver.id)
    assert.equal(softguardRetirementPending(completed), false)
    assert.equal(await auditCount(), 1)
    if (mode === 'normalized') assert.deepEqual(await readNormalizedState(pg), saved)
    assert.equal((await call(request(first), scoped)).status, 409)
    assert.deepEqual(await readState(sql), saved)
    assert.equal(await auditCount(), 1)

    // The normalized failure happens after the legacy audit INSERT. Both copies,
    // customer metadata, revision and storage selector must roll back together.
    const auditTable = mode === 'normalized' ? 'normalized_shadow.audit_events' : 'pignus_audit_log'
    const storageControl = mode === 'normalized' ? (await pg.query('select * from normalized_shadow.storage_control')).rows : null
    await pg.exec(`create function reject_softguard_audit() returns trigger language plpgsql as $$ begin raise exception 'injected softguard audit failure'; end; $$;
      create trigger reject_softguard_audit before insert on ${auditTable} for each row execute function reject_softguard_audit();`)
    const failed = await call(request(second), resolver)
    assert.equal(failed.status, 400, JSON.stringify(failed.body))
    assert.match(failed.body.error, /injected softguard audit failure/)
    assert.deepEqual(await readState(sql), saved)
    assert.equal(await auditCount(), 1)
    if (mode === 'normalized') {
      assert.deepEqual(await readNormalizedState(pg), saved)
      assert.deepEqual((await pg.query('select * from normalized_shadow.storage_control')).rows, storageControl)
    }
    await pg.exec(`drop trigger reject_softguard_audit on ${auditTable}; drop function reject_softguard_audit();`)
    const retried = await call(request(second), resolver)
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
    assert.equal(retried.body.revision, saved.revision + 1)
    assert.equal(await auditCount(), 2)
    const final = await readState(sql)
    assert.equal(final.customers.every(row => !softguardRetirementPending(row)), true)
    if (mode === 'normalized') assert.deepEqual(await readNormalizedState(pg), final)
  } finally { await pg.close() }
})
