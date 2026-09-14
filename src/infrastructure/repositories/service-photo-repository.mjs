import { requestJson } from '../http/json-request.mjs'

const endpoint = recordId => `/api/service-photo/${encodeURIComponent(String(recordId))}`

export const servicePhotoRepository = {
  upload: (recordId, photo) => requestJson(endpoint(recordId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo })
  }, 'No se pudo adjuntar la foto del servicio.'),
  remove: recordId => requestJson(endpoint(recordId), { method: 'DELETE' }, 'No se pudo quitar la foto del servicio.')
}
