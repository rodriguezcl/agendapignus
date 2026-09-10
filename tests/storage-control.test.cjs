const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { synchronizeNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')
const { activateNormalizedStorage, readStorageControl, rollbackToLegacy } = require('../api/_lib/storage-control.cjs')
const { executeStateWrite } = require('../api/_lib/state-write-coordinator.cjs')

function fixture() {
  return { revision: 1, roles: [{ id: 'r', name: 'Rol', permissions: {} }], employees: [{ id: 'e', roleId: 'r', name: 'Técnico' }],
    customers: [{ customerId: 'c', account: 'CLI-1', name: 'Cliente', fields: {} }], services: [{ id: 's', code: 'service', name: 'Servicio', estimatedMinutes: 60 }], vehicles: [], reviews: [],
    history: [{ id: 'h', sourceTaskId: 't', date: '2026-09-09', time: '09:00', estimatedMinutes: 60, status: 'Pendiente', customerId: 'c', serviceId: 's', teamId: 'team', technicianIds: ['e'] }],
    agenda: { date: '2026-09-09', teams: [], weekly: {} }, preferences: { theme: 'light' } }
}

test('the isolated storage switch validates the exact prepared revision and rolls back', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture(), next = structuredClone(previous)
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    next.revision = 2
    next.history[0].detail = 'Preparado'
    const synchronized = await synchronizeNormalizedState(pg, previous, next)
    assert.deepEqual(await readStorageControl(pg), { model: 'legacy', revision: 0, fingerprint: null, switchId: null, switchedAt: null })

    await assert.rejects(activateNormalizedStorage(pg, { expectedRevision: 2, expectedFingerprint: 'incorrecta' }), { code: 'STORAGE_SWITCH_PRECONDITION_FAILED' })
    assert.equal((await readStorageControl(pg)).model, 'legacy')
    assert.equal((await pg.query('select count(*)::int as count from normalized_shadow.storage_switch_events')).rows[0].count, 0)

    const activated = await activateNormalizedStorage(pg, { expectedRevision: 2, expectedFingerprint: synchronized.sourceFingerprint, switchId: 'activation', occurredAt: '2026-09-09T18:00:00.000Z', actorId: 'admin' })
    assert.equal(activated.model, 'normalized')
    assert.equal((await pg.query('select status from normalized_shadow.import_batch where id = 1')).rows[0].status, 'active')
    assert.equal((await activateNormalizedStorage(pg, { expectedRevision: 2, expectedFingerprint: synchronized.sourceFingerprint })).idempotent, true)

    await pg.exec('create table rehearsal_legacy_state (id integer primary key, data jsonb not null)')
    await pg.query('insert into rehearsal_legacy_state values (1, $1)', [next])
    const afterActivation = structuredClone(next)
    afterActivation.revision = 3
    afterActivation.history[0].detail = 'Escritura posterior al corte'
    const writeResult = await executeStateWrite(pg, next, afterActivation, { mode: 'isolated-dual-write', isolatedRehearsal: true,
      writeLegacy: (transaction, state) => transaction.query('update rehearsal_legacy_state set data = $1 where id = 1', [state]) })
    const updatedControl = await readStorageControl(pg)
    assert.equal(updatedControl.revision, 3)
    assert.equal(updatedControl.fingerprint, writeResult.shadow.sourceFingerprint)

    await assert.rejects(rollbackToLegacy(pg, { expectedRevision: 1, expectedFingerprint: synchronized.sourceFingerprint }), { code: 'STORAGE_SWITCH_PRECONDITION_FAILED' })
    assert.equal((await readStorageControl(pg)).model, 'normalized')
    const rolledBack = await rollbackToLegacy(pg, { expectedRevision: 3, expectedFingerprint: writeResult.shadow.sourceFingerprint, switchId: 'rollback', occurredAt: '2026-09-09T18:05:00.000Z', actorId: 'admin' })
    assert.equal(rolledBack.model, 'legacy')
    assert.equal((await pg.query('select status from normalized_shadow.import_batch where id = 1')).rows[0].status, 'shadow')
    assert.deepEqual((await pg.query('select from_model, to_model from normalized_shadow.storage_switch_events order by occurred_at')).rows,
      [{ from_model: 'legacy', to_model: 'normalized' }, { from_model: 'normalized', to_model: 'legacy' }])
  } finally { await pg.close() }
})
