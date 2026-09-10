import { fetchWithTimeout } from '../http/fetch-timeout.mjs'
import { requestJson } from '../http/json-request.mjs'

// Vercel allows this endpoint up to 60 seconds. Abort slightly earlier so a
// transient failure can be reported cleanly instead of leaving the modal stuck.
const IMPORT_TIMEOUT_MS = 55_000
const timedRequest = (url, options, message) => requestJson(
  url,
  options,
  message,
  (resource, requestOptions) => fetchWithTimeout(resource, requestOptions, IMPORT_TIMEOUT_MS),
  IMPORT_TIMEOUT_MS
)

export const customerImportRepository = {
  status: () => requestJson('/api/customers/import', { cache: 'no-store' }, 'No se pudo consultar la última importación.'),
  apply: (revision, customers) => timedRequest('/api/customers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, customers, responseMode: 'compact-v1' })
  }, 'No se pudo importar el archivo.'),
  undo: () => timedRequest('/api/customers/import', { method: 'DELETE' }, 'No se pudo deshacer la importación.')
}
