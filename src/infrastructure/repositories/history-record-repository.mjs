import { requestJson } from '../http/json-request.mjs'

export const HISTORY_WRITE_TIMEOUT_MS = 40_000
const HISTORY_WRITE_RETRY_DELAY_MS = 500
// A 503 from these endpoints is emitted only after PostgreSQL rolls the
// transaction back, so repeating the exact operation cannot duplicate it.
const transientWriteFailure = error => error?.status === 503
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function writeHistoryRequest(url, options, fallbackMessage, { fetcher = globalThis.fetch, retryDelay = HISTORY_WRITE_RETRY_DELAY_MS, requestTimeout = HISTORY_WRITE_TIMEOUT_MS } = {}) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestJson(url, options, fallbackMessage, fetcher, requestTimeout)
    } catch (error) {
      lastError = error
      if (!transientWriteFailure(error) || attempt === 1) throw error
      if (retryDelay > 0) await wait(retryDelay)
    }
  }
  throw lastError
}

export const historyRecordRepository = {
  update: (base, record) => writeHistoryRequest(`/api/history/${encodeURIComponent(String(record.id))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base, record })
  }, 'No se pudo actualizar el servicio.'),
  updateMany: updates => writeHistoryRequest('/api/history/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates })
  }, 'No se pudieron actualizar los servicios seleccionados.'),
  remove: base => writeHistoryRequest(`/api/history/${encodeURIComponent(String(base.id))}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base })
  }, 'No se pudo eliminar el servicio.')
}
