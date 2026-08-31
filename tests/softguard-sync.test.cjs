const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('verifica firmas HMAC con secreto actual o anterior y rechaza firmas alteradas', async () => {
  const { hmacHex, sha256Hex, verifyHmac } = await import('../supabase/functions/_shared/sync-security.mjs')
  const bodyHash = await sha256Hex('{"action":"finalize"}')
  const timestamp = '1788110400'
  const nonce = 'd8feab5c-e8ba-4c7b-93e8-3b0e54b958a2'
  const previous = 'previous-secret-with-at-least-32-bytes'
  const signature = await hmacHex(previous, timestamp, nonce, bodyHash)
  assert.equal(await verifyHmac({ secrets: ['current-secret-with-at-least-32-bytes', previous], timestamp, nonce, bodyHash, signature }), true)
  assert.equal(await verifyHmac({ secrets: ['current-secret-with-at-least-32-bytes'], timestamp, nonce, bodyHash, signature }), false)
  assert.equal(await verifyHmac({ secrets: [previous], timestamp, nonce, bodyHash: `${bodyHash.slice(0, -1)}0`, signature }), false)
})

test('valida UUID y ventana temporal de las solicitudes firmadas', async () => {
  const { signedDateFromUnixSeconds, validUuid } = await import('../supabase/functions/_shared/sync-security.mjs')
  const now = Date.parse('2026-08-30T12:00:00Z')
  assert.equal(validUuid('d8feab5c-e8ba-4c7b-93e8-3b0e54b958a2'), true)
  assert.equal(validUuid('not-a-uuid'), false)
  assert.equal(signedDateFromUnixSeconds(String(now / 1000), now), '2026-08-30T12:00:00.000Z')
  assert.equal(signedDateFromUnixSeconds(String(now / 1000 - 301), now), null)
})

test('la migración publica el snapshot sólo durante la finalización transaccional', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/202608300001_softguard_sync.sql'), 'utf8')
  assert.match(migration, /softguard_sync_stage/)
  assert.match(migration, /softguard_finalize_sync/)
  assert.match(migration, /SYNC_SNAPSHOT_COUNT_MISMATCH/)
  assert.match(migration, /SYNC_DUPLICATE_KEY_OR_BATCH/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /SYNC_STALE_SNAPSHOT/)
  assert.match(migration, /last_seen_sync_id <> p_sync_run_id/)
  assert.match(migration, /enable row level security/g)
  assert.match(migration, /revoke all[^;]+from anon, authenticated/s)
  assert.doesNotMatch(migration, /update\s+public\.pignus_customers|delete\s+from\s+public\.pignus_customers/i)
  assert.match(migration, /nullif\(trim\(payload->>'codigo_tipo_servicio'\), ''\)/)
})

test('el Worker usa las vistas definitivas, IdInternoZona y conserva el tipo cero', () => {
  const repository = fs.readFileSync(path.join(root, 'workers/SoftGuard.Sync/SoftGuardRepository.cs'), 'utf8')
  const validator = fs.readFileSync(path.join(root, 'workers/SoftGuard.Sync/SnapshotValidator.cs'), 'utf8')
  const tests = fs.readFileSync(path.join(root, 'workers/SoftGuard.Sync.Tests/SnapshotValidatorTests.cs'), 'utf8')
  assert.match(repository, /\[_Datos\]\.\[api\]\.\[vw_AbonadosPIG\]/)
  assert.match(repository, /\[_Datos\]\.\[api\]\.\[vw_ZonasPIG\]/)
  assert.match(repository, /\[_Tablas\]\.\[api\]\.\[vw_TiposServicio\]/)
  assert.match(repository, /RequiredKey\(reader, "IdInternoZona"\)/)
  assert.match(validator, /"0" es una clave legítima/)
  assert.match(tests, /AcceptsZeroAsTheNormalizedUnspecifiedServiceType/)
  assert.match(tests, /new SoftGuardServiceType\("0", "Sin especificar"/)
})

test('la Edge Function limita cuerpo y lote y exige HMAC antes de ejecutar RPC', () => {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/softguard-sync/index.ts'), 'utf8')
  assert.match(source, /MAX_BODY_BYTES = 1_000_000/)
  assert.match(source, /MAX_BATCH_RECORDS = 500/)
  assert.ok(source.indexOf('verifyHmac') < source.indexOf("softguard_claim_request"))
  assert.match(source, /SOFTGUARD_SYNC_SECRET_PREVIOUS/)
  assert.doesNotMatch(source, /Access-Control-Allow-Origin/i)
})

test('la lectura autenticada usa sólo tablas softguard activas', async () => {
  const { readSoftguardSubscribers } = require('../api/_lib/database.cjs')
  const queries = []
  const sql = async (strings, ...values) => {
    queries.push({ text: strings.join('?'), values })
    return [{ idInterno: '1', numeroAbonado: 'PIG-1', zonas: [] }]
  }
  const result = await readSoftguardSubscribers(sql, { search: 'PIG', limit: 10, offset: 0 })
  assert.equal(result.records.length, 1)
  assert.match(queries[0].text, /softguard_abonados/)
  assert.match(queries[0].text, /softguard_zonas/)
  assert.match(queries[0].text, /subscriber\.is_active/)
  assert.doesNotMatch(queries[0].text, /pignus_customers/)
})

test('apiClient consulta abonados exclusivamente mediante la API existente', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/apiClient.js'), 'utf8')
  const api = fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')
  assert.match(source, /searchSoftguardSubscribers/)
  assert.match(source, /\/api\/softguard\/abonados/)
  assert.doesNotMatch(source, /createClient|SUPABASE|service_role/)
  assert.match(api, /userCan\(session\.user, 'accounts'\)[\s\S]+userCan\(session\.user, 'history'\)/)
  assert.match(api, /No tenés permiso para consultar datos de abonados/)
})
