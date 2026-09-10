import { requestJson } from '../http/json-request.mjs'
import { stateOperations } from '../../features/state/application/state-operations.mjs'

const readOptions = { cache: 'no-store', credentials: 'same-origin' }
const STATE_WRITE_TIMEOUT_MS = 20_000
const TRANSIENT_RETRY_DELAY_MS = 300

const transientWriteFailure = error => error?.status === 503 || /conexi[oó]n demor[oó] demasiado/i.test(String(error?.message || ''))

async function writeState(options, fallbackMessage) {
  try {
    return await requestJson('/api/state', options, fallbackMessage, globalThis.fetch, STATE_WRITE_TIMEOUT_MS)
  } catch (error) {
    if (!transientWriteFailure(error)) throw error
    await new Promise(resolve => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS))
    // Operations carry their previous value, so a retry after a lost response
    // is idempotent and cannot duplicate a service.
    return requestJson('/api/state', options, fallbackMessage, globalThis.fetch, STATE_WRITE_TIMEOUT_MS)
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
