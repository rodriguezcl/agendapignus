export async function fetchPdf(url, { fetcher = globalThis.fetch, signal, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = setTimeout(abort, timeoutMs)
  try {
    const response = await fetcher(url, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'No se pudo descargar el seguro. Volvé a intentarlo.')
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) {
      throw new Error('No se recibió un PDF válido. Volvé a intentarlo.')
    }
    const blob = await response.blob()
    if (!blob.size) throw new Error('El PDF está vacío. Volvé a intentarlo.')
    return blob
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('La descarga demoró demasiado. Volvé a intentarlo.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
