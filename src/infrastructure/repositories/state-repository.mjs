import { requestJson } from '../http/json-request.mjs'
import { stateOperations } from '../../features/state/application/state-operations.mjs'

const readOptions = { cache: 'no-store', credentials: 'same-origin' }
export const STATE_WRITE_TIMEOUT_MS = 50_000
const TRANSIENT_RETRY_DELAY_MS = 1_000

const transientWriteFailure = error => error?.status === 503 || /conexi[oó]n demor[oó] demasiado/i.test(String(error?.message || ''))

export async function writeState(options, fallbackMessage, { fetcher = globalThis.fetch, retryDelay = TRANSIENT_RETRY_DELAY_MS, requestTimeout = STATE_WRITE_TIMEOUT_MS } = {}) {
  try {
    return await requestJson('/api/state', options, fallbackMessage, fetcher, requestTimeout)
  } catch (error) {
    if (!transientWriteFailure(error)) throw error
    if (retryDelay > 0) await new Promise(resolve => setTimeout(resolve, retryDelay))
    // Operations carry their previous value, so a retry after a lost response
    // is idempotent and cannot duplicate a service.
    return requestJson('/api/state', options, fallbackMessage, fetcher, requestTimeout)
  }
}

export const stateRepository = {
  commit: (operations, revision) => writeState({
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, operations })
  }, 'No se pudo guardar el servicio.'),
  load: () => requestJson('/api/state', readOptions, 'No se pudo cargar la información autorizada para esta sesión.'),
  save: state => writeState({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: state.revision, operations: stateOperations(state.base, state) })
  }, 'No se pudieron guardar los últimos cambios.'),
  revision: () => requestJson('/api/state/revision', readOptions, 'No se pudo consultar la revisión.')
}
