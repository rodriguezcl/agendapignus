import { requestJson } from '../http/json-request.mjs'

export const historyRecordRepository = {
  update: (base, record) => requestJson(`/api/history/${encodeURIComponent(String(record.id))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base, record })
  }, 'No se pudo actualizar el servicio.')
}
