const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const { execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const root = path.resolve(__dirname, '..')
const { fixture, admin, day } = require('../tests/helpers/planning-click-fixture.cjs')
const { pgliteAdapter } = require('../tests/helpers/pglite-adapter.cjs')
const { replaceCollections, readState } = require('../api/_lib/database.cjs')
const { normalizeStateForSave } = require('../api/_lib/core.cjs')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
// Synthetic PGlite data only; never reads environment files or the live database.
// Usage: node scripts/benchmark-planning-clicks.cjs [baseline-commit-sha]
const baselineRef = process.argv[2] || 'ba57298'
if (!/^[a-f0-9]{7,40}$/i.test(baselineRef)) throw new Error('Pass a baseline commit SHA (7-40 hexadecimal characters).')
function load(source) {
  const filename = path.join(root, 'api/index.js'), compiled = new Module(filename, module)
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename))
  compiled._compile(source + '\nmodule.exports.testSave = handleSaveState;', filename)
  return compiled.exports.testSave
}
;(async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { servicePreparationOperations } = await import('../src/features/state/application/service-preparation.mjs')
  const { weeklyTeamMemberOperations } = await import('../src/features/state/application/weekly-team-members-save.mjs')
  const pg = await PGlite.create(), statements = [], sql = pgliteAdapter(pg, statements)
  try {
    await pg.exec('create role anon; create role authenticated;')
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202608250001_pignus_schema.sql'), 'utf8'))
    await pg.exec(fs.readFileSync(path.join(root, 'supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const raw = fixture()
    raw.customers = Array.from({ length: 3000 }, (_, i) => ({ customerId: `customer-${i}`, account: `CLIENT-${i}`, kind: 'client', name: `CLIENTE ${i}` }))
    raw.history.push(...Array.from({ length: 599 }, (_, i) => ({ id: `other-${i}`, date: '2099-01-06', time: '10:00', status: 'Pendiente', serviceId: 's', service: 'Servicio', estimatedMinutes: 60, customerId: `customer-${i}`, technicianIds: [], technicians: [] })))
    const initial = normalizeStateForSave(raw, raw)
    await replaceCollections(sql, initial)
    await pg.query("update pignus_preferences set value='1' where key='state_revision'")
    const candidate = buildShadowCandidate(initial)
    await insertShadowCandidate(pg, candidate)
    await pg.query("update normalized_shadow.storage_control set active_model='normalized', active_revision=1, active_fingerprint=$1 where id=1", [candidate.analysis.sourceFingerprint])
    const handlers = {
      previousHandler: load(execFileSync('git', ['show', `${baselineRef}:api/index.js`], { cwd: root, encoding: 'utf8', maxBuffer: 10_000_000 })),
      fastHandler: load(fs.readFileSync(path.join(root, 'api/index.js'), 'utf8'))
    }
    const samples = []
    const info = console.info; console.info = () => {}
    try {
      for (const [name, handler] of Object.entries(handlers)) for (const kind of ['ready', 'members']) for (let round = 0; round < 3; round++) {
        const before = await readState(sql)
        const team = before.agenda.weekly[day].teams[0]
        const target = team.memberIds[0] === 'one' ? 'two' : 'one'
        const operations = kind === 'ready'
          ? servicePreparationOperations(before, { base: before.history[0], ready: !before.history[0].servicePreparation?.ready })
          : weeklyTeamMemberOperations(before, { day, teamId: 'team', teamIndex: 0, baseMemberIds: team.memberIds, baseMembers: team.members, memberIds: [target], members: [`${target} Técnico`] })
        const result = { headers: {} }, res = { setHeader(k, v) { result.headers[k] = v }, status(status) { result.status = status; return this }, json(body) { result.body = body; return body } }
        statements.length = 0
        const start = performance.now()
        await handler({ method: 'PATCH', body: { revision: before.revision, operations, responseMode: 'delta-v1' } }, res, sql, admin)
        if (result.status !== 200) throw new Error(`${name} ${kind}: ${JSON.stringify(result.body)}`)
        samples.push({ name, kind, round, elapsedMs: Math.round(performance.now() - start), queries: statements.length, serverTiming: result.headers['Server-Timing'] })
      }
    } finally { console.info = info }
    console.log(JSON.stringify({ isolated: true, baselineRef, customers: 3000, history: 600, note: 'Both handlers use current shared persistence helpers; comparison isolates handler optimization and understates full release improvement.', samples }, null, 2))
  } finally { await pg.close() }
})().catch(error => { console.error(error.message); process.exitCode = 1 })
