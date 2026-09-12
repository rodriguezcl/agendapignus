import { requestJson } from '../http/json-request.mjs'

export const historyRecordRepository = {
  update: (base, record) => requestJson(`/api/history/${encodeURIComponent(String(record.id))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base, record })
  }, 'No se pudo actualizar el servicio.'),
  updateMany: updates => requestJson('/api/history/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates })
  }, 'No se pudieron actualizar los servicios seleccionados.'),
  remove: base => requestJson(`/api/history/${encodeURIComponent(String(base.id))}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base })
  }, 'No se pudo eliminar el servicio.')
}
