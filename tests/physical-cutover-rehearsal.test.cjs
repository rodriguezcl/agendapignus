const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { rehearsePrivilegedDependencies } = require('../api/_lib/physical-cutover-rehearsal.cjs')

function fixture() {
  return { revision: 1, roles: [{ id: 'r', name: 'Rol', permissions: {} }], employees: [{ id: 'e', roleId: 'r', name: 'Técnico', passwordHash: 'scrypt$hash' }],
    customers: [], services: [{ id: 's', code: 'vehicle-control', name: 'Control', estimatedMinutes: 15 }], vehicles: [{ id: 'v', plate: 'AA000AA' }], reviews: [],
    history: [{ id: 'h', sourceTaskId: 't', date: '2026-09-11', time: '16:00', estimatedMinutes: 15, status: 'Completado', serviceId: 's', teamId: 'team', technicianIds: ['e'], vehicleControl: true, vehicleId: 'v', vehicleControlScheduledFriday: '2026-09-11' }],
    agenda: { date: '2026-09-11', teams: [], weekly: {} }, preferences: { theme: 'light' } }
}

test('privileged rehearsal preserves hashes, audit and binary bytes without copying sessions', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    const state = fixture(), event = { id: '11111111-1111-4111-8111-111111111111', at: '2026-09-09T10:00:00.000Z', user: { id: 'e', name: 'Admin' }, action: 'Probó', entity: 'Servicio', entityId: 'h', before: null, after: { ok: true } }
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    await insertShadowCandidate(pg, buildShadowCandidate(state))
    const result = await rehearsePrivilegedDependencies(pg, state, {
      sessionCount: 2,
      loginAttempts: [{ fingerprint: 'f', attempts: 1, blocked_until: '2026-09-09T11:00:00.000Z', updated_at: '2026-09-09T10:00:00.000Z' }],
      preferences: [{ key: 'customer_import_backup', value: '{"safe":true}', updated_at: '2026-09-09T10:00:00.000Z' }],
      insurance: [{ vehicle_id: 'v', file_name: 'seguro.pdf', pdf_data: Buffer.from('%PDF-test'), uploaded_at: '2026-09-09T10:00:00.000Z' }],
      photos: [{ record_id: 'h', vehicle_id: 'v', mime_type: 'image/jpeg', photo_data: Buffer.from([1, 2, 3]), created_at: '2026-09-09T10:00:00.000Z' }],
      audit: [{ id: event.id, occurred_at: event.at, data: event }]
    })
    assert.deepEqual(result, { credentials: 1, loginAttempts: 1, auxiliaryPreferences: 1, auditEvents: 1, insuranceDocuments: 1, vehicleControlPhotos: 1,
      credentialsPreserved: true, accessBlocksPreserved: true, auxiliaryPreferencesPreserved: true, auditPreserved: true, insuranceBytesPreserved: true, photoBytesPreserved: true,
      sessionsCopied: 0, sourceSessionsInvalidatedAtCutover: 2 })
    assert.equal((await pg.query('select count(*)::int as count from normalized_shadow.auth_sessions')).rows[0].count, 0)
  } finally { await pg.close() }
})

test('plaintext-only legacy credentials block cutover instead of being copied', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    const state = fixture()
    delete state.employees[0].passwordHash
    state.employees[0].password = 'no-copiar'
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    await insertShadowCandidate(pg, buildShadowCandidate(state))
    await assert.rejects(rehearsePrivilegedDependencies(pg, state, { audit: [], insurance: [], photos: [], loginAttempts: [] }), { code: 'PLAINTEXT_CREDENTIAL_BLOCKS_CUTOVER' })
  } finally { await pg.close() }
})
