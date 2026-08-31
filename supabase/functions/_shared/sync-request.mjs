import { sha256Hex, signedDateFromUnixSeconds, validUuid, verifyHmac } from './sync-security.mjs'

export const MAX_BODY_BYTES = 1_048_576

function rejected(status, error) {
  return { ok: false, status, error }
}

export function parseContentLength(value) {
  if (value === null) return { ok: true, value: null }
  const normalized = String(value).trim()
  if (!/^\d+$/.test(normalized)) return rejected(400, 'INVALID_CONTENT_LENGTH')
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return rejected(400, 'INVALID_CONTENT_LENGTH')
  return { ok: true, value: parsed }
}

async function cancelReader(reader) {
  try {
    await reader.cancel()
  } catch {
    // The response is already determined; transport cancellation is best effort.
  }
}

export async function readBodyLimited(body, maximumBytes, declaredLength = null) {
  if (!body) {
    return declaredLength === null || declaredLength === 0
      ? { ok: true, bytes: new Uint8Array() }
      : rejected(400, 'CONTENT_LENGTH_MISMATCH')
  }

  const reader = body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      const nextTotal = totalBytes + chunk.byteLength
      if (nextTotal > maximumBytes) {
        await cancelReader(reader)
        return rejected(413, 'PAYLOAD_TOO_LARGE')
      }
      if (declaredLength !== null && nextTotal > declaredLength) {
        await cancelReader(reader)
        return rejected(400, 'CONTENT_LENGTH_MISMATCH')
      }
      chunks.push(chunk)
      totalBytes = nextTotal
    }
  } catch {
    return rejected(400, 'BODY_READ_FAILED')
  } finally {
    reader.releaseLock()
  }

  if (declaredLength !== null && totalBytes !== declaredLength) {
    return rejected(400, 'CONTENT_LENGTH_MISMATCH')
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

export async function authenticateSyncRequest(request, {
  secrets,
  maximumBytes = MAX_BODY_BYTES,
  now = Date.now(),
  verifyHmacFn = verifyHmac
} = {}) {
  if (request.method !== 'POST') return rejected(405, 'METHOD_NOT_ALLOWED')

  const contentEncoding = request.headers.get('content-encoding')
  if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
    return rejected(415, 'UNSUPPORTED_CONTENT_ENCODING')
  }

  const contentLength = parseContentLength(request.headers.get('content-length'))
  if (!contentLength.ok) return contentLength
  if (contentLength.value !== null && contentLength.value > maximumBytes) {
    return rejected(413, 'PAYLOAD_TOO_LARGE')
  }

  const body = await readBodyLimited(request.body, maximumBytes, contentLength.value)
  if (!body.ok) return body

  const timestamp = request.headers.get('x-sync-timestamp') || ''
  const nonce = request.headers.get('x-sync-nonce') || ''
  const signature = request.headers.get('x-sync-signature') || ''
  const signedAt = signedDateFromUnixSeconds(timestamp, now)
  if (!signedAt || !validUuid(nonce)) return rejected(401, 'SYNC_AUTH_HEADERS_INVALID')

  const bodyHash = await sha256Hex(body.bytes)
  const validSignature = await verifyHmacFn({ secrets, timestamp, nonce, bodyHash, signature })
  if (!validSignature) return rejected(401, 'SYNC_SIGNATURE_INVALID')

  return { ok: true, rawBody: body.bytes, bodyHash, timestamp, nonce, signedAt }
}
