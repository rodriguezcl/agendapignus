const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { appendOperationalAudit, setAuxiliaryPreference, upsertVehicleControlPhoto, upsertVehicleInsuranceDocument } = require('../api/_lib/operational-storage.cjs')

function fixture() {
  return { revision: 1, roles: [{ id: 'r', name: 'Rol', permissions: {} }], employees: [{ id: 'e', roleId: 'r', name: 'Técnico' }],
    customers: [], services: [{ id: 's', code: 'vehicle-control', name: 'Control', estimatedMinutes: 15 }], vehicles: [{ id: 'v', plate: 'AA000AA' }], reviews: [],
    history: [{ id: 'h', sourceTaskId: 't', date: '2026-09-11', time: '16:00', estimatedMinutes: 15, status: 'Completado', serviceId: 's', teamId: 'team', technicianIds: ['e'], vehicleControl: true, vehicleId: 'v', vehicleControlScheduledFriday: '2026-09-11' }],
    agenda: { date: '2026-09-11', teams: [], weekly: {} }, preferences: { theme: 'light' } }
}

async function database() {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
  await pg.exec(`create table pignus_audit_log (id uuid primary key, occurred_at timestamptz not null, data jsonb not null);
    create table pignus_preferences (key text primary key, value text not null, updated_at timestamptz not null default now());
    create table pignus_vehicle_insurance_documents (vehicle_id text primary key, file_name text not null, pdf_data bytea not null, uploaded_at timestamptz not null);
    create table pignus_vehicle_control_photos (record_id text primary key, vehicle_id text not null, mime_type text not null, photo_data bytea not null, created_at timestamptz not null);`)
  await insertShadowCandidate(pg, buildShadowCandidate(fixture()))
  return pg
}

test('specialized audit, preference and binary writes are mirrored byte-for-byte', async () => {
  const pg = await database()
  try {
    const event = { id: '11111111-1111-4111-8111-111111111111', at: '2026-09-09T18:00:00.000Z', user: { id: 'e', name: 'Admin' }, action: 'Probó', entity: 'Servicio', entityId: 'h', before: null, after: { ok: true } }
    const pdf = Buffer.from('%PDF-operational'), photo = Buffer.from([7, 8, 9])
    await pg.exec('begin')
    await appendOperationalAudit(pg, [event])
    await setAuxiliaryPreference(pg, 'last_customer_import_backup', '{"ok":true}')
    await upsertVehicleInsuranceDocument(pg, { vehicleId: 'v', fileName: 'seguro.pdf', data: pdf, uploadedAt: event.at })
    await upsertVehicleControlPhoto(pg, { recordId: 'h', vehicleId: 'v', mimeType: 'image/jpeg', data: photo, createdAt: event.at })
    await pg.exec('commit')
    assert.deepEqual((await pg.query('select data from pignus_audit_log')).rows[0].data, event)
    assert.deepEqual((await pg.query('select original_payload from normalized_shadow.audit_events')).rows[0].original_payload, event)
    assert.equal((await pg.query("select preference_value from normalized_shadow.legacy_preference_evidence where preference_key='last_customer_import_backup'")).rows[0].preference_value, '{"ok":true}')
    assert.deepEqual(Buffer.from((await pg.query('select pdf_data from normalized_shadow.vehicle_insurance_documents')).rows[0].pdf_data), pdf)
    assert.deepEqual(Buffer.from((await pg.query('select photo_data from normalized_shadow.vehicle_control_photos')).rows[0].photo_data), photo)
  } finally { await pg.close() }
})

test('a specialized shadow failure rolls back its legacy counterpart', async () => {
  const pg = await database()
  try {
    await pg.exec('begin')
    await assert.rejects(upsertVehicleControlPhoto(pg, { recordId: 'missing', vehicleId: 'v', mimeType: 'image/jpeg', data: Buffer.from([1]), createdAt: new Date().toISOString() }))
    await pg.exec('rollback')
    assert.equal((await pg.query('select count(*)::int as count from pignus_vehicle_control_photos')).rows[0].count, 0)
  } finally { await pg.close() }
})
