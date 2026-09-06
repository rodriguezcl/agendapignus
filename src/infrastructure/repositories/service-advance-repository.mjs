import { requestJson } from '../http/json-request.mjs'

const post = (url, recordId) => requestJson(url, {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId })
}, 'No se pudo procesar la solicitud de adelanto.')

export const serviceAdvanceRepository = {
  request: recordId => post('/api/technician/advance-request', recordId),
  resolve: (recordId, decision) => post(`/api/admin/advance-request/${decision === 'approved' ? 'approve' : 'deny'}`, recordId)
}
