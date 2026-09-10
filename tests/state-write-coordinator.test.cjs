const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const { executeStateWrite, writeMode } = require('../api/_lib/state-write-coordinator.cjs')

function fixture() {
  return { revision: 1, roles: [{ id: 'r', name: 'Rol', permissions: {} }], employees: [{ id: 'e', roleId: 'r', name: 'Técnico' }],
    customers: [{ customerId: 'c', account: 'CLI-1', name: 'Cliente', fields: {} }], services: [{ id: 's', code: 'service', name: 'Servicio', estimatedMinutes: 60 }], vehicles: [], reviews: [],
    history: [{ id: 'h', sourceTaskId: 't', date: '2026-09-09', time: '09:00', estimatedMinutes: 60, status: 'Pendiente', customerId: 'c', serviceId: 's', teamId: 'team', technicianIds: ['e'], detail: 'Base' }],
    agenda: { date: '2026-09-09', teams: [], weekly: {} }, preferences: { theme: 'light' } }
}

async function database() {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
  await pg.exec('create table rehearsal_legacy_state (id integer primary key, data jsonb not null)')
  return pg
}

async function seed(pg, state) {
  await pg.query('insert into rehearsal_legacy_state values (1, $1)', [state])
  await insertShadowCandidate(pg, buildShadowCandidate(state))
}

const writeLegacy = (transaction, next) => transaction.query('update rehearsal_legacy_state set data = $1 where id = 1', [next])
const readLegacy = async pg => (await pg.query('select data from rehearsal_legacy_state where id = 1')).rows[0].data

test('dual write cannot be activated outside an explicit isolated rehearsal', () => {
  assert.equal(writeMode(), 'controlled')
  assert.equal(writeMode({ mode: 'legacy' }), 'legacy')
  assert.throws(() => writeMode({ mode: 'isolated-dual-write' }), { code: 'DUAL_WRITE_NOT_AUTHORIZED' })
  assert.equal(writeMode({ mode: 'isolated-dual-write', isolatedRehearsal: true }), 'isolated-dual-write')
})

test('legacy and normalized state commit in one isolated transaction', async () => {
  const pg = await database()
  try {
    const previous = fixture(), next = structuredClone(previous)
    await seed(pg, previous)
    next.revision = 2
    next.history[0].detail = 'Guardado atómico'
    const result = await executeStateWrite(pg, previous, next, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy })
    assert.equal(result.shadowWritten, true)
    assert.deepEqual(await readLegacy(pg), next)
    assert.equal((await readNormalizedState(pg)).history[0].detail, 'Guardado atómico')
  } finally { await pg.close() }
})

test('controlled operational writes keep both models synchronized when the shadow is prepared', async () => {
  const pg = await database()
  try {
    const previous = fixture(), next = structuredClone(previous)
    await seed(pg, previous)
    next.revision = 2
    next.history[0].detail = 'Ruta operacional'
    const result = await executeStateWrite(pg, previous, next, { writeLegacy })
    assert.equal(result.mode, 'controlled')
    assert.equal(result.activeModel, 'legacy')
    assert.equal(result.shadowWritten, true)
    assert.deepEqual(await readLegacy(pg), next)
    assert.deepEqual(await readNormalizedState(pg), next)
  } finally { await pg.close() }
})

test('controlled operational writes remain legacy-compatible before the shadow schema exists', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    const previous = fixture(), next = { ...structuredClone(previous), revision: 2 }
    await pg.exec('create table rehearsal_legacy_state (id integer primary key, data jsonb not null)')
    await pg.query('insert into rehearsal_legacy_state values (1, $1)', [previous])
    const result = await executeStateWrite(pg, previous, next, { writeLegacy })
    assert.deepEqual(result, { mode: 'legacy', shadowWritten: false })
    assert.deepEqual(await readLegacy(pg), next)
  } finally { await pg.close() }
})

test('a shadow conflict rolls back the legacy write from the same transaction', async () => {
  const pg = await database()
  try {
    const base = fixture(), first = structuredClone(base), stale = structuredClone(base)
    await seed(pg, base)
    first.revision = 2
    first.history[0].detail = 'Primera sesión'
    await executeStateWrite(pg, base, first, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy })
    stale.revision = 2
    stale.history[0].detail = 'Sesión desactualizada'
    await assert.rejects(executeStateWrite(pg, base, stale, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy }), { code: 'NORMALIZED_WRITE_CONFLICT' })
    assert.deepEqual(await readLegacy(pg), first)
    assert.equal((await readNormalizedState(pg)).history[0].detail, 'Primera sesión')
  } finally { await pg.close() }
})

test('a normalized constraint failure also rolls back its preceding legacy write', async () => {
  const pg = await database()
  try {
    const previous = fixture(), invalid = structuredClone(previous)
    await seed(pg, previous)
    invalid.revision = 2
    invalid.roles[0].name = 'No debe persistir'
    invalid.employees[0].email = 'duplicado@example.com'
    invalid.employees.push({ id: 'e2', roleId: 'r', name: 'Otro', email: 'duplicado@example.com' })
    await assert.rejects(executeStateWrite(pg, previous, invalid, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy }))
    assert.deepEqual(await readLegacy(pg), previous)
    assert.equal((await readNormalizedState(pg)).roles[0].name, 'Rol')
  } finally { await pg.close() }
})

test('rollback drill restores the baseline after post-cutover writes without rewinding the revision', async () => {
  const pg = await database()
  try {
    const baseline = fixture(), edited = structuredClone(baseline), expanded = structuredClone(baseline)
    await seed(pg, baseline)
    edited.revision = 2
    edited.history[0].detail = 'Cambio posterior al corte'
    await executeStateWrite(pg, baseline, edited, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy })
    Object.assign(expanded, edited)
    expanded.revision = 3
    expanded.history = [...edited.history, { ...structuredClone(edited.history[0]), id: 'h2', sourceTaskId: 't2', time: '11:00', detail: 'Alta posterior' }]
    await executeStateWrite(pg, edited, expanded, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy })

    const restored = { ...structuredClone(baseline), revision: 4 }
    await executeStateWrite(pg, expanded, restored, { mode: 'isolated-dual-write', isolatedRehearsal: true, writeLegacy })
    assert.deepEqual(await readLegacy(pg), restored)
    assert.deepEqual(await readNormalizedState(pg), restored)
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.jobs where id = 'h2'")).rows[0].count, 0)
  } finally { await pg.close() }
})
