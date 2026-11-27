import { requestJson } from '../http/json-request.mjs'
import { stateOperations } from '../../features/state/application/state-operations.mjs'
import { applyStateDelta } from '../../domain/shared/state-delta.mjs'

const readOptions = { cache: 'no-store', credentials: 'same-origin' }
export const STATE_WRITE_TIMEOUT_MS = 50_000
const TRANSIENT_RETRY_DELAY_MS = 1_000

function transientWriteFailure(error) {
  if (error?.status) return [408, 500, 502, 503, 504].includes(error.status)
  return error?.name === 'TypeError' || error?.code === 'STATE_WRITE_UNCONFIRMED' || error?.code === 'REQUEST_TIMEOUT'
}

function unconfirmedWrite(cause) {
  const error = new Error('Falta la confirmación del servidor. Volvé a intentar guardar.', { cause })
  error.code = 'STATE_WRITE_UNCONFIRMED'
  return error
}

// The response must include the saved state or a delta to apply to the editor.
// A proxy can return HTTP 200 with an incomplete body.
function confirmedWrite(payload) {
  if (payload?.ok !== true || !Number.isSafeInteger(payload.revision) || payload.revision < 0) return false
  const { state, delta, revision } = payload
  if (state) return Number.isSafeInteger(state.revision) && state.revision >= revision && Array.isArray(state.history)
  return delta?.revision === revision && Number.isSafeInteger(delta.baseRevision) && delta.baseRevision <= revision &&
    delta.changes && typeof delta.changes === 'object' && !Array.isArray(delta.changes)
}

export async function writeState(options, fallbackMessage, {
  fetcher = globalThis.fetch,
  retryDelay = TRANSIENT_RETRY_DELAY_MS,
  requestTimeout = STATE_WRITE_TIMEOUT_MS,
  isSessionCurrent = () => true
} = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isSessionCurrent()) throw new Error('La sesión cambió durante el guardado.')
    options.signal?.throwIfAborted()
    try {
      const payload = await requestJson('/api/state', options, fallbackMessage, fetcher, requestTimeout)
      if (!isSessionCurrent()) throw new Error('La sesión cambió durante el guardado.')
      if (!confirmedWrite(payload)) throw unconfirmedWrite()
      return payload
    } catch (error) {
      if (options.signal?.aborted || !transientWriteFailure(error)) throw error
      if (attempt === 1) throw unconfirmedWrite(error)
      // Reuse both the actor and the exact operation batch, even if the first
      // request committed and only its response was lost.
      if (retryDelay > 0) await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}

let confirmedSnapshot = null
let cacheEpoch = 0
let sessionEpoch = 0
const remember = (state, epoch = cacheEpoch) => {
  if (epoch !== cacheEpoch) return state
  if (state && (!confirmedSnapshot || Number(state.revision) >= Number(confirmedSnapshot.revision))) confirmedSnapshot = state
  return state
}

async function commit(operations, revision) {
  const epoch = cacheEpoch
  const startedSession = sessionEpoch
  const expectedActorId = confirmedSnapshot?.sessionUser?.id
  const base = confirmedSnapshot?.revision === revision ? confirmedSnapshot : null
  const body = { revision, operations }
  if (expectedActorId != null) body.expectedActorId = String(expectedActorId)
  if (base) body.responseMode = 'delta-v1'
  const payload = await writeState({
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 'No se pudo guardar el servicio.', {
    isSessionCurrent: () => startedSession === sessionEpoch && expectedActorId === confirmedSnapshot?.sessionUser?.id
  })
  if (payload.delta) {
    try { payload.state = applyStateDelta(base, payload.delta) }
    catch (error) { throw unconfirmedWrite(error) }
  }
  remember(payload.state, epoch)
  return payload
}

export const stateRepository = {
  prime: state => {
    if (!state || state.sessionUser?.id !== confirmedSnapshot?.sessionUser?.id) sessionEpoch++
    cacheEpoch++
    confirmedSnapshot = state
  },
  commit,
  load: async () => {
    const epoch = cacheEpoch
    return remember(await requestJson('/api/state', readOptions, 'No se pudo cargar la información autorizada para esta sesión.'), epoch)
  },
  save: state => commit(stateOperations(state.base, state), state.revision),
  revision: () => requestJson('/api/state/revision', readOptions, 'No se pudo consultar la revisión.')
}
