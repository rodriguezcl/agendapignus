export async function requestJson(url, options = {}, fallbackMessage = 'No se pudo completar la solicitud.', fetcher = globalThis.fetch) {
  const response = await fetcher(url, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || fallbackMessage)
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}
