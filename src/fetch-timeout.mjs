export const AUTH_REQUEST_TIMEOUT_MS = 15_000

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
