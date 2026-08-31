const encoder = new TextEncoder()

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) return null
  return Uint8Array.from(value.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)))
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

export async function hmacHex(secret, timestamp, nonce, bodyHash) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const canonical = `${timestamp}\n${nonce}\n${bodyHash}`
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(canonical))))
}

export async function verifyHmac({ secrets, timestamp, nonce, bodyHash, signature }) {
  const supplied = hexToBytes(String(signature || '').toLowerCase())
  if (!supplied || supplied.length !== 32) return false
  for (const secret of secrets.filter(Boolean)) {
    const expected = hexToBytes(await hmacHex(secret, timestamp, nonce, bodyHash))
    if (expected && expected.length === supplied.length) {
      let difference = 0
      for (let index = 0; index < supplied.length; index += 1) difference |= supplied[index] ^ expected[index]
      if (difference === 0) return true
    }
  }
  return false
}

export function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

export function signedDateFromUnixSeconds(value, now = Date.now()) {
  if (!/^\d{10}$/.test(String(value || ''))) return null
  const milliseconds = Number(value) * 1000
  if (!Number.isSafeInteger(milliseconds)) return null
  if (milliseconds < now - 5 * 60_000 || milliseconds > now + 60_000) return null
  return new Date(milliseconds).toISOString()
}
