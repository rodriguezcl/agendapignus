import { requestJson } from '../http/json-request.mjs'

const readOptions = { cache: 'no-store', credentials: 'same-origin' }

export const stateRepository = {
  load: () => requestJson('/api/state', readOptions, 'No se pudo cargar la información autorizada para esta sesión.'),
  save: state => requestJson('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  }, 'No se pudieron guardar los últimos cambios.'),
  revision: () => requestJson('/api/state/revision', readOptions, 'No se pudo consultar la revisión.')
}
