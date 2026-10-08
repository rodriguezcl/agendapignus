import { requestJson } from '../http/json-request.mjs'

export const subscriptionRepository = {
  correct: command => requestJson('/api/customers/subscription-correction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  }, 'No se pudieron guardar los datos del abono.')
}
