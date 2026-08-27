const retryableStatuses = new Set([503, 504])

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function submitTechnicianStatus({ recordId, type, observation, fetcher = fetch, retryDelay = 700 }) {
  if (!String(observation || '').trim()) throw new Error('La observación es obligatoria para informar el servicio.')
  let lastError

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher('/api/technician/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ recordId, type, observation })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data.record) return data.record

      const error = new Error(data.error || 'No se pudo informar el estado del servicio.')
      error.status = response.status
      throw error
    } catch (error) {
      lastError = error
      const retryable = !error?.status || retryableStatuses.has(error.status)
      if (!retryable || attempt === 1) break
      await wait(retryDelay)
    }
  }

  throw lastError || new Error('No se pudo informar el estado del servicio.')
}
