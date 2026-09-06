import { requestJson } from '../http/json-request.mjs'

const readOptions = { cache: 'no-store', credentials: 'same-origin' }

export const auditRepository = {
  list: (limit = 100) => requestJson(`/api/audit?limit=${encodeURIComponent(limit)}`, readOptions, 'No se pudo cargar el registro de auditoría.'),
  findById: id => requestJson(`/api/audit/${encodeURIComponent(id)}`, readOptions, 'No se pudo cargar el detalle de auditoría.')
}
