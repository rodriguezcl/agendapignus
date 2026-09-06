import { fetchWithTimeout } from '../http/fetch-timeout.mjs'
import { requestJson } from '../http/json-request.mjs'

const IMPORT_TIMEOUT_MS = 60_000
const timedRequest = (url, options, message) => requestJson(
  url,
  options,
  message,
  (resource, requestOptions) => fetchWithTimeout(resource, requestOptions, IMPORT_TIMEOUT_MS)
)

export const customerImportRepository = {
  status: () => requestJson('/api/customers/import', { cache: 'no-store' }, 'No se pudo consultar la última importación.'),
  apply: (revision, customers) => timedRequest('/api/customers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, customers })
  }, 'No se pudo importar el archivo.'),
  undo: () => timedRequest('/api/customers/import', { method: 'DELETE' }, 'No se pudo deshacer la importación.')
}
