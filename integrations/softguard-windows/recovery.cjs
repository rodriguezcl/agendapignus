'use strict'
const { fail } = require('./lib.cjs')
const endpoint = '/api/customers/import'
async function api(page, body) {
  let response
  try {
    response = await page.evaluate(async ({ endpoint, body }) => {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })
      return { ok: response.ok, status: response.status, data: await response.json() }
    }, { endpoint, body })
  } catch { throw fail('RECOVERY_UNAVAILABLE', 'No se pudo consultar el comprobante de importación. Se reintentará automáticamente.') }
  if (!response.ok && body.checkRecovery && [400, 404, 405, 409].includes(response.status)) throw fail('RECOVERY_UPDATE_REQUIRED', 'Publicá la actualización de Agentec antes de usar este conector.')
  if (!response.ok) throw fail([401, 403].includes(response.status) ? 'AUTH_REJECTED' : 'RECOVERY_UNAVAILABLE', 'No se pudo consultar el comprobante de importación. Revisá el estado del conector si el problema persiste.')
  return response.data
}
async function checkProtocol(page) {
  if ((await api(page, { checkRecovery: true })).recoveryProtocol !== 1) throw fail('RECOVERY_UPDATE_REQUIRED', 'Publicá la actualización de Agentec antes de usar este conector.')
}
function completed(data, id) {
  return data?.operationId === id && data.operationStatus === 'completed' && Number.isInteger(data.revision) && Number.isInteger(data.customerCount)
}
async function resolve(page, marker) {
  if (!marker?.operationId) throw fail('IMPORT_UNCERTAIN', 'Este intento pertenece al conector anterior y requiere revisión de auditoría antes de desbloquearlo.')
  const result = await api(page, { operationId: marker.operationId, resolveOperation: true })
  if (completed(result, marker.operationId)) return 'completed'
  if (result?.operationId === marker.operationId && result.operationStatus === 'aborted') return 'aborted'
  throw fail('RECOVERY_UNAVAILABLE', 'Agentec no devolvió un comprobante válido. Se conserva el intento para revisarlo automáticamente.')
}
module.exports = { endpoint, checkProtocol, completed, resolve }
