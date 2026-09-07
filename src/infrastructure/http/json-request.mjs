export const JSON_REQUEST_TIMEOUT_MS = 30_000

export async function requestJson(url, options = {}, fallbackMessage = 'No se pudo completar la solicitud.', fetcher = globalThis.fetch, timeoutMs = JSON_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const requestSignal = options.signal && globalThis.AbortSignal?.any
    ? AbortSignal.any([options.signal, controller.signal])
    : options.signal || controller.signal
  let timedOut = false
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('La conexión demoró demasiado. Volvé a intentarlo.'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([(async () => {
      const response = await fetcher(url, { ...options, signal: requestSignal })
      const payload = await response.json().catch(error => {
        if (timedOut || error?.name === 'AbortError') throw error
        return {}
      })
      if (!response.ok) {
        const error = new Error(payload.error || fallbackMessage)
        error.status = response.status
        error.payload = payload
        throw error
      }
      return payload
    })(), timeout])
  } catch (error) {
    if (timedOut || error?.name === 'AbortError') throw new Error('La conexión demoró demasiado. Volvé a intentarlo.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
