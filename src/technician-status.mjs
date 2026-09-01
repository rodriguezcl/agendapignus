const retryableStatuses = new Set([503, 504])
export const TECHNICIAN_STATUS_TIMEOUT_MS = 18_000
export const VEHICLE_STATUS_TIMEOUT_MS = 45_000

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function submitTechnicianStatus({ recordId, type, observation, vehicleMileage, vehiclePhoto, vehicleControl = false, fetcher = fetch, retryDelay = 700, requestTimeout = vehicleControl ? VEHICLE_STATUS_TIMEOUT_MS : TECHNICIAN_STATUS_TIMEOUT_MS }) {
  if (!vehicleControl && !String(observation || '').trim()) throw new Error('La observación es obligatoria para informar el servicio.')
  let lastError

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeout)
    try {
      const response = await fetcher('/api/technician/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ recordId, type, observation, vehicleMileage, vehiclePhoto })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data.record) return data.record

      const error = new Error(data.error || 'No se pudo informar el estado del servicio.')
      error.status = response.status
      throw error
    } catch (error) {
      const timedOut = error?.name === 'AbortError'
      lastError = timedOut
        ? Object.assign(new Error('El guardado demoró más de lo esperado. Comprobá la conexión y volvé a presionar Guardar; el sistema no duplicará el servicio si ya había sido registrado.'), { code: 'TECHNICIAN_STATUS_TIMEOUT' })
        : error
      const retryable = !error?.status || retryableStatuses.has(error.status)
      if (!retryable || attempt === 1) break
      await wait(retryDelay)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError || new Error('No se pudo informar el estado del servicio.')
}
