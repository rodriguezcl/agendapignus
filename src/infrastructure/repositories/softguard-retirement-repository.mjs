import { requestJson } from '../http/json-request.mjs'
import { softguardRetirementBase } from '../../domain/customers/softguard-retirement.mjs'

export const softguardRetirementRepository = {
  resolve: customer => requestJson('/api/customers/softguard-retirement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: customer.customerId, base: softguardRetirementBase(customer) })
  }, 'No se pudo registrar la baja realizada en SoftGuard.')
}
