import { requestJson } from '../http/json-request.mjs'

export const collectionRepository = {
  manage: command => requestJson('/api/collections/manage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command)
  }, 'No se pudo guardar la cobranza.')
}
