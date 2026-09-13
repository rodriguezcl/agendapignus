const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function startTechnicianService(recordId, { fetcher = fetch, retryDelay = 500, requestTimeout = 15_000 } = {}) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeout)
    try {
      const response = await fetcher('/api/technician/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ recordId })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data.record) return data.record
      const error = new Error(data.error || 'No se pudo iniciar el servicio.')
      error.status = response.status
      throw error
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? new Error('La confirmación de inicio demoró demasiado. Revisá la conexión e intentá nuevamente.')
        : error
      if ((error?.status && error.status !== 503 && error.status !== 504) || attempt === 1) break
      await wait(retryDelay)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError || new Error('No se pudo iniciar el servicio.')
}
