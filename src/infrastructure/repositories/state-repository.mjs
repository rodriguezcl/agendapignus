import { requestJson } from '../http/json-request.mjs'
import { stateOperations } from '../../features/state/application/state-operations.mjs'

const readOptions = { cache: 'no-store', credentials: 'same-origin' }

export const stateRepository = {
  commit: (operations, revision) => requestJson('/api/state', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, operations })
  }, 'No se pudo guardar el servicio.'),
  load: () => requestJson('/api/state', readOptions, 'No se pudo cargar la información autorizada para esta sesión.'),
  save: state => requestJson('/api/state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: state.revision, operations: stateOperations(state.base, state) })
  }, 'No se pudieron guardar los últimos cambios.'),
  revision: () => requestJson('/api/state/revision', readOptions, 'No se pudo consultar la revisión.')
}
