export const AUTH_REQUEST_TIMEOUT_MS = 15_000
export const AUTH_LOGIN_TIMEOUT_MS = 30_000

export async function fetchWithTimeout(resource, options = {}, timeoutMs = AUTH_REQUEST_TIMEOUT_MS, fetchImplementation = globalThis.fetch) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImplementation(resource, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La conexión demoró demasiado. Verificá tu conexión e intentá nuevamente.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

const TRANSIENT_AUTH_STATUSES = new Set([502, 503, 504])

/** Reintenta una vez fallos transitorios sin repetir credenciales rechazadas. */
export async function fetchAuthWithRetry(resource, options = {}, timeoutMs = AUTH_REQUEST_TIMEOUT_MS, fetchImplementation = globalThis.fetch, retryDelayMs = 350) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(resource, { credentials: 'same-origin', ...options }, timeoutMs, fetchImplementation)
      if (!TRANSIENT_AUTH_STATUSES.has(response.status) || attempt === 1) return response
      lastError = new Error('El servicio de acceso todavía se está iniciando.')
    } catch (error) {
      lastError = error
      if (attempt === 1) throw error
    }
    if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs))
  }
  throw lastError
}
