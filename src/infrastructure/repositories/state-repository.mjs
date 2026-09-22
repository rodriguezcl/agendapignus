import { requestJson } from '../http/json-request.mjs'
import { stateOperations } from '../../features/state/application/state-operations.mjs'
import { applyStateDelta } from '../../domain/shared/state-delta.mjs'

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

let confirmedSnapshot = null
let cacheEpoch = 0
const remember = (state, epoch = cacheEpoch) => {
  if (epoch !== cacheEpoch) return state
  if (state && (!confirmedSnapshot || Number(state.revision) >= Number(confirmedSnapshot.revision))) confirmedSnapshot = state
  return state
}

async function commit(operations, revision) {
  const epoch = cacheEpoch
  const base = confirmedSnapshot?.revision === revision ? confirmedSnapshot : null
  const payload = await writeState({
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, operations, ...(base ? { responseMode: 'delta-v1' } : {}) })
  }, 'No se pudo guardar el servicio.')
  if (payload.delta) payload.state = applyStateDelta(base, payload.delta)
  remember(payload.state, epoch)
  return payload
}

export const stateRepository = {
  prime: state => { cacheEpoch++; confirmedSnapshot = state },
  commit,
  load: async () => {
    const epoch = cacheEpoch
    return remember(await requestJson('/api/state', readOptions, 'No se pudo cargar la información autorizada para esta sesión.'), epoch)
  },
  save: state => commit(stateOperations(state.base, state), state.revision),
  revision: () => requestJson('/api/state/revision', readOptions, 'No se pudo consultar la revisión.')
}
