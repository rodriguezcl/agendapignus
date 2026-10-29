const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture, admin } = require('./helpers/planning-click-fixture.cjs')
const { replaceCollections } = require('../api/_lib/database.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const { addressChangeState } = require('../api/_lib/address-change.cjs')

test('normalized PostgreSQL import verifies relocation and undo restores the pending notice', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create(), root = path.resolve(__dirname, '..')
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    const sql = pgliteAdapter(pg), initial = fixture()
    initial.customers = [{ customerId: 'c1', account: 'PIG-1000', name: 'PRUEBA', address: 'Anterior 10, Córdoba', fields: { Calle: 'Anterior 10', Localidad: 'Córdoba' } }]
    Object.assign(initial.history[0], { date: '2026-10-28', status: 'Completado', completedAt: '2026-10-28T14:00:00Z', customerId: 'c1', serviceId: 'address-change', service: 'Cambio de domicilio', address: 'Anterior 10, Córdoba', newAddress: 'Nueva 20, Córdoba' })
    initial.agenda = { date: '2026-10-28', teams: [], weekly: {} }
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const candidate = buildShadowCandidate(initial)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [1, candidate.analysis.sourceFingerprint])
    const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testImport=handleCustomerImport;', filename)
    const call = async (body, method = 'POST') => {
      const response = {}, res = { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
      await compiled.exports.testImport({ method, body }, res, sql, admin)
      assert.equal(response.status, 200, JSON.stringify(response.body))
      return response.body
    }
    const oldImport = await call({ revision: 1, customers: initial.customers, importedAccounts: ['PIG-1000'], responseMode: 'compact-v1' })
    assert.equal(oldImport.addressVerifications[0].softguardAddress.address, 'Anterior 10, Córdoba')
    assert.equal(oldImport.customers, undefined)
    let state = await readNormalizedState(sql)
    assert.equal(addressChangeState(state.history[0], state.customers[0]).status, 'unchanged')
    await call({ revision: oldImport.revision, customers: [{ ...state.customers[0], address: 'Nueva 20, Córdoba', fields: { Calle: 'Nueva 20', Localidad: 'Córdoba' } }], importedAccounts: ['PIG-1000'] })
    state = await readNormalizedState(sql)
    assert.equal(addressChangeState(state.history[0], state.customers[0]).status, 'verified')
    assert.equal(state.history[0].address, 'Anterior 10, Córdoba')
    await call({}, 'DELETE')
    state = await readNormalizedState(sql)
    assert.equal(addressChangeState(state.history[0], state.customers[0]).status, 'unchanged')
  } finally { await pg.close() }
})
