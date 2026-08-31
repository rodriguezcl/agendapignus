import { sha256Hex, signedDateFromUnixSeconds, validUuid, verifyHmac } from '../_shared/sync-security.mjs'

const MAX_BODY_BYTES = 1_000_000
const MAX_BATCH_RECORDS = 500
const allowedEntities = new Set(['abonados', 'zonas', 'tipos_servicio'])

function response(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

function integer(value: unknown, minimum = 0, maximum = 1_000_000) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : null
}

function safeErrorCode(message: string) {
  const match = message.match(/SYNC_[A-Z0-9_]+/)
  return match?.[0] || 'SYNC_REQUEST_FAILED'
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new Error('SYNC_FUNCTION_NOT_CONFIGURED')
  const result = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(parameters)
  })
  const payload = await result.json().catch(() => ({}))
  if (!result.ok) throw new Error(String(payload?.message || payload?.code || 'SYNC_DATABASE_REQUEST_FAILED'))
  return payload
}

async function markFailed(syncRunId: unknown, error: unknown) {
  if (!validUuid(syncRunId)) return
  const message = error instanceof Error ? error.message : String(error)
  await rpc('softguard_fail_sync', {
    p_sync_run_id: syncRunId,
    p_error_codigo: safeErrorCode(message),
    p_error_detalle: message.slice(0, 1000)
  }).catch(() => undefined)
}

Deno.serve(async request => {
  if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' })
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) return response(413, { error: 'SYNC_BODY_TOO_LARGE' })

  const timestamp = request.headers.get('x-sync-timestamp') || ''
  const nonce = request.headers.get('x-sync-nonce') || ''
  const signature = request.headers.get('x-sync-signature') || ''
  const signedAt = signedDateFromUnixSeconds(timestamp)
  if (!signedAt || !validUuid(nonce)) return response(401, { error: 'SYNC_AUTH_HEADERS_INVALID' })

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return response(413, { error: 'SYNC_BODY_TOO_LARGE' })
  const bodyHash = await sha256Hex(rawBody)
  const validSignature = await verifyHmac({
    secrets: [
      Deno.env.get('SOFTGUARD_SYNC_SECRET_CURRENT') || '',
      Deno.env.get('SOFTGUARD_SYNC_SECRET_PREVIOUS') || ''
    ],
    timestamp, nonce, bodyHash, signature
  })
  if (!validSignature) return response(401, { error: 'SYNC_SIGNATURE_INVALID' })

  try {
    await rpc('softguard_claim_request', { p_nonce: nonce, p_signed_at: signedAt, p_body_hash: bodyHash })
  } catch (error) {
    const code = safeErrorCode(error instanceof Error ? error.message : String(error))
    return response(code === 'SYNC_RATE_LIMITED' ? 429 : code === 'SYNC_REPLAY_DETECTED' ? 409 : 401, { error: code })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return response(400, { error: 'SYNC_JSON_INVALID' })
  }

  const syncRunId = body.syncRunId
  if (!validUuid(syncRunId)) return response(400, { error: 'SYNC_RUN_ID_INVALID' })

  try {
    if (body.action === 'start') {
      const counts = body.counts as Record<string, unknown> | undefined
      const abonados = integer(counts?.abonados)
      const zonas = integer(counts?.zonas)
      const tiposServicio = integer(counts?.tiposServicio)
      if (abonados === null || zonas === null || tiposServicio === null
          || typeof body.sourceGeneratedAt !== 'string'
          || !/^[0-9a-f]{64}$/.test(String(body.manifestHash || ''))) {
        throw new Error('SYNC_MANIFEST_INVALID')
      }
      const result = await rpc('softguard_begin_sync', {
        p_sync_run_id: syncRunId,
        p_origen_generado_at: body.sourceGeneratedAt,
        p_abonados_esperados: abonados,
        p_zonas_esperadas: zonas,
        p_tipos_servicio_esperados: tiposServicio,
        p_manifest_hash: body.manifestHash
      })
      return response(200, { ok: true, result })
    }

    if (body.action === 'batch') {
      if (!validUuid(body.batchId) || !allowedEntities.has(String(body.entity || ''))
          || integer(body.batchIndex, 0, 1_000_000) === null
          || !Array.isArray(body.records) || body.records.length < 1 || body.records.length > MAX_BATCH_RECORDS) {
        throw new Error('SYNC_BATCH_INVALID')
      }
      const calculatedPayloadHash = await sha256Hex(JSON.stringify(body.records))
      if (calculatedPayloadHash !== body.payloadHash) throw new Error('SYNC_PAYLOAD_HASH_MISMATCH')
      const result = await rpc('softguard_stage_batch', {
        p_sync_run_id: syncRunId,
        p_batch_id: body.batchId,
        p_entidad: body.entity,
        p_batch_index: body.batchIndex,
        p_payload_hash: body.payloadHash,
        p_records: body.records
      })
      return response(200, { ok: true, result })
    }

    if (body.action === 'finalize') {
      const result = await rpc('softguard_finalize_sync', { p_sync_run_id: syncRunId })
      return response(200, { ok: true, result })
    }

    throw new Error('SYNC_ACTION_INVALID')
  } catch (error) {
    await markFailed(syncRunId, error)
    const code = safeErrorCode(error instanceof Error ? error.message : String(error))
    const status = code.includes('CONFLICT') || code.includes('DUPLICATE') || code.includes('REPLAY') ? 409 : 400
    return response(status, { error: code })
  }
})
