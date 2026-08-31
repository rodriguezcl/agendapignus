const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

function streamFromChunks(chunks, tracker = {}) {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      tracker.pulls = (tracker.pulls || 0) + 1
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[index++])
    },
    cancel() {
      tracker.cancelled = true
    }
  })
}

function requestFrom({ method = 'POST', headers = {}, chunks = [], tracker = {} } = {}) {
  const stream = streamFromChunks(chunks, tracker)
  return {
    method,
    headers: new Headers(headers),
    body: {
      getReader() {
        tracker.readerRequests = (tracker.readerRequests || 0) + 1
        return stream.getReader()
      }
    }
  }
}

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
  const gate = fs.readFileSync(path.join(root, 'supabase/functions/_shared/sync-request.mjs'), 'utf8')
  assert.match(gate, /MAX_BODY_BYTES = 1_048_576/)
  assert.match(source, /MAX_BATCH_RECORDS = 500/)
  assert.ok(source.indexOf('if (!authenticated.ok) return') < source.indexOf("softguard_claim_request"))
  assert.doesNotMatch(gate, /\brpc\s*\(/)
  assert.doesNotMatch(source, /request\.(text|json|arrayBuffer)\s*\(/)
  assert.match(source, /SOFTGUARD_SYNC_SECRET_PREVIOUS/)
  assert.doesNotMatch(source, /Access-Control-Allow-Origin/i)
})

test('rechaza Content-Length superior o inválido antes de leer o verificar HMAC', async () => {
  const { authenticateSyncRequest, MAX_BODY_BYTES } = await import('../supabase/functions/_shared/sync-request.mjs')
  for (const [contentLength, status, error] of [
    [String(MAX_BODY_BYTES + 1), 413, 'PAYLOAD_TOO_LARGE'],
    ['-1', 400, 'INVALID_CONTENT_LENGTH'],
    ['not-a-number', 400, 'INVALID_CONTENT_LENGTH'],
    ['1, 2', 400, 'INVALID_CONTENT_LENGTH'],
    [String(Number.MAX_SAFE_INTEGER) + '0', 400, 'INVALID_CONTENT_LENGTH']
  ]) {
    const tracker = {}
    let verificationCalls = 0
    const result = await authenticateSyncRequest(requestFrom({
      headers: { 'content-length': contentLength },
      chunks: [new Uint8Array([1])],
      tracker
    }), {
      secrets: ['unused'],
      verifyHmacFn: async () => { verificationCalls += 1; return false }
    })
    assert.deepEqual(result, { ok: false, status, error })
    assert.equal(tracker.readerRequests || 0, 0)
    assert.equal(verificationCalls, 0)
  }
})

test('rechaza Content-Length contradictorio con los bytes recibidos', async () => {
  const { authenticateSyncRequest } = await import('../supabase/functions/_shared/sync-request.mjs')
  let verificationCalls = 0
  const result = await authenticateSyncRequest(requestFrom({
    headers: { 'content-length': '1' },
    chunks: [new Uint8Array([1, 2])]
  }), {
    secrets: ['unused'],
    verifyHmacFn: async () => { verificationCalls += 1; return false }
  })
  assert.deepEqual(result, { ok: false, status: 400, error: 'CONTENT_LENGTH_MISMATCH' })
  assert.equal(verificationCalls, 0)
})

test('cancela un cuerpo fragmentado apenas supera 1 MiB', async () => {
  const { authenticateSyncRequest, MAX_BODY_BYTES } = await import('../supabase/functions/_shared/sync-request.mjs')
  const tracker = {}
  let verificationCalls = 0
  const result = await authenticateSyncRequest(requestFrom({
    chunks: [new Uint8Array(MAX_BODY_BYTES / 2), new Uint8Array(MAX_BODY_BYTES / 2), new Uint8Array([1])],
    tracker
  }), {
    secrets: ['unused'],
    verifyHmacFn: async () => { verificationCalls += 1; return false }
  })
  assert.deepEqual(result, { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' })
  assert.equal(tracker.cancelled, true)
  assert.equal(verificationCalls, 0)
})

test('acepta exactamente 1 MiB y conserva los bytes crudos para HMAC', async () => {
  const { hmacHex, sha256Hex } = await import('../supabase/functions/_shared/sync-security.mjs')
  const { authenticateSyncRequest, MAX_BODY_BYTES } = await import('../supabase/functions/_shared/sync-request.mjs')
  const bytes = new Uint8Array(MAX_BODY_BYTES)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
  const bodyHash = await sha256Hex(bytes)
  const secret = 'test-secret-with-more-than-thirty-two-bytes'
  const now = Date.parse('2026-08-31T12:00:00Z')
  const timestamp = String(now / 1000)
  const nonce = '55555555-5555-4555-8555-555555555555'
  const signature = await hmacHex(secret, timestamp, nonce, bodyHash)
  const result = await authenticateSyncRequest(requestFrom({
    headers: {
      'content-length': String(MAX_BODY_BYTES),
      'x-sync-timestamp': timestamp,
      'x-sync-nonce': nonce,
      'x-sync-signature': signature
    },
    chunks: [bytes.subarray(0, 12345), bytes.subarray(12345)]
  }), { secrets: [secret], now })
  assert.equal(result.ok, true)
  assert.equal(result.bodyHash, bodyHash)
  assert.deepEqual(result.rawBody, bytes)
})

test('rechaza 1 MiB más un byte y encoding comprimido sin verificar HMAC', async () => {
  const { authenticateSyncRequest, MAX_BODY_BYTES } = await import('../supabase/functions/_shared/sync-request.mjs')
  let verificationCalls = 0
  const verifyHmacFn = async () => { verificationCalls += 1; return false }
  const oversized = await authenticateSyncRequest(requestFrom({
    chunks: [new Uint8Array(MAX_BODY_BYTES + 1)]
  }), { secrets: ['unused'], verifyHmacFn })
  const compressedTracker = {}
  const compressed = await authenticateSyncRequest(requestFrom({
    headers: { 'content-encoding': 'gzip' },
    chunks: [new Uint8Array([1, 2, 3])],
    tracker: compressedTracker
  }), { secrets: ['unused'], verifyHmacFn })
  assert.deepEqual(oversized, { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' })
  assert.deepEqual(compressed, { ok: false, status: 415, error: 'UNSUPPORTED_CONTENT_ENCODING' })
  assert.equal(compressedTracker.readerRequests || 0, 0)
  assert.equal(verificationCalls, 0)
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
