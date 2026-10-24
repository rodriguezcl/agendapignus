const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture } = require('./helpers/planning-click-fixture.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')

for (const mode of ['legacy', 'normalized']) test(`Import HTTP PostgreSQL ${mode}: atomic receipt, replay, seal and rollback`, async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..')
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), initial = fixture()
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    if (mode === 'normalized') {
      await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
      const candidate = buildShadowCandidate(initial)
      await insertShadowCandidate(pg, candidate)
      await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [1, candidate.analysis.sourceFingerprint])
    }
    const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename
    compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testImport = handleCustomerImport;', filename)
    const admin = { id: 'importer', name: 'Importador', roleCode: 'administrator', role: 'Administrador', permissions: { accountsImport: true } }
    const call = async (body, user = admin) => {
      const response = {}
      const res = { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
      await compiled.exports.testImport({ method: 'POST', body }, res, sql, user)
      return response
    }
    const input = { revision: 1, operationId: randomUUID(), customers: (await readState(sql)).customers, responseMode: 'compact-v1' }
    const first = await call(input)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.operationStatus, 'completed')
    const saved = await readState(sql)
    assert.deepEqual(await call(input), first)
    assert.deepEqual(await call({ operationId: input.operationId, resolveOperation: true }), first)
    assert.deepEqual(await readState(sql), saved)
    assert.equal((await sql`select count(*)::int as n from pignus_audit_log`)[0].n, 1)
    assert.equal((await call({ operationId: input.operationId, resolveOperation: true }, { ...admin, id: 'other' })).status, 403)
    const failed = { ...input, operationId: randomUUID(), revision: saved.revision, customers: [...saved.customers, { customerId: 'new-account', account: 'PIG-9999', name: 'NEW', fields: {} }] }
    await pg.exec("create function reject_import_receipt() returns trigger language plpgsql as $$ begin raise exception 'injected receipt failure'; end; $$; create trigger reject_import_receipt before insert on pignus_customer_import_operations for each row execute function reject_import_receipt();")
    const rejected = await call(failed)
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body))
    assert.match(rejected.body.error, /injected receipt failure/)
    assert.deepEqual(await readState(sql), saved)
    assert.equal((await sql`select count(*)::int as n from pignus_audit_log`)[0].n, 1)
    await pg.exec('drop trigger reject_import_receipt on pignus_customer_import_operations')
    assert.equal((await call({ operationId: failed.operationId, resolveOperation: true })).body.operationStatus, 'aborted')
    assert.equal((await call(failed)).status, 409)
    assert.deepEqual(await readState(sql), saved)
  } finally { await pg.close() }
})
