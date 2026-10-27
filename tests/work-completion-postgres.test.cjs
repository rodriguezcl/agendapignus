const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')
const { fixture } = require('./helpers/planning-click-fixture.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')

test('PostgreSQL: cierre por trabajo atómico y conservado en almacenamiento normalizado', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync('supabase/migrations/202608250001_pignus_schema.sql', 'utf8'))
    const sql = pgliteAdapter(pg), initial = fixture()
    initial.services = [{ id: 'alarm', code: 'alarm-service', name: 'Service de alarma', estimatedMinutes: 60, status: 'Activo' }, { id: 'camera', code: 'camera-service', name: 'Service de cámaras', estimatedMinutes: 60, status: 'Activo' }]
    Object.assign(initial.history[0], { date: '2026-10-14', startedAt: '2026-10-14T12:00:00Z', serviceId: 'alarm', service: 'Service de alarma', serviceTypes: initial.services.map(({ id, name }) => ({ id, name })), amount: '83160', paymentMethod: 'Efectivo', serviceCharges: [{ id: 'alarm', amount: '0' }, { id: 'camera', amount: '83160' }] })
    initial.agenda = { date: '2026-10-14', teams: [{ teamId: 'team', label: 'Equipo 1', memberIds: ['one'], members: ['one Técnico'], tasks: [{ ...initial.history[0], taskId: 'task', historyId: 'work' }] }], weekly: {} }
    await replaceCollections(sql, initial)
    await pg.query("insert into pignus_preferences(key,value) values('state_revision','1') on conflict(key) do update set value='1'")
    await pg.exec(fs.readFileSync('supabase/proposals/normalized-shadow-v1.sql', 'utf8'))
    const candidate = buildShadowCandidate(initial); await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=$1, active_fingerprint=$2 where id=1", [initial.revision, candidate.analysis.sourceFingerprint])
    const filename = path.resolve('api/index.js'), compiled = new Module(filename, module)
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.reportForTest=handleTechnicianStatus;', filename)
    const call = async workResults => {
      const response = {}, res = { setHeader() {}, status(code) { response.status = code; return this }, json(body) { response.body = body; return body } }
      await compiled.exports.reportForTest({ method: 'POST', body: { recordId: 'work', type: 'Completado', observation: 'Alarma lista, cámaras requieren otra visita', workResults } }, res, sql, { id: 'one', roleCode: 'technician', name: 'Técnico' })
      return response
    }
    assert.equal((await call()).status, 400)
    assert.equal((await readState(sql)).history[0].status, 'Pendiente')
    const results = [{ id: 'alarm', status: 'completed' }, { id: 'camera', status: 'pending' }]
    const response = await call(results); assert.equal(response.status, 200, JSON.stringify(response.body))
    const saved = await readState(sql), normalized = await readNormalizedState(pg)
    assert.deepEqual(normalized, saved)
    assert.equal(saved.history[0].amount, '0'); assert.equal(saved.history[0].serviceTypes.length, 1)
    assert.equal(saved.history[0].workCompletion.originalAmount, '83160')
    assert.equal(saved.history[0].collectionCancellation.original.amount, '83160')
    assert.equal(saved.agenda.teams[0].tasks[0].amount, '0')
    const repeated = await call(results); assert.equal(repeated.status, 200)
    assert.equal((await readState(sql)).revision, saved.revision)
  } finally { await pg.close() }
})
