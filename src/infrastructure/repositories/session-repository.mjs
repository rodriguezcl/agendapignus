import { requestJson } from '../http/json-request.mjs'

const options = { cache: 'no-store', credentials: 'same-origin' }

export const sessionRepository = {
  status: () => requestJson('/api/auth/session-status', options, 'No se pudo verificar la sesión.'),
  touch: () => requestJson('/api/auth/activity', { ...options, method: 'POST' }, 'No se pudo actualizar la actividad de la sesión.')
}
