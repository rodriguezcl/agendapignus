import { requestJson } from '../http/json-request.mjs'

const write = (url, method, body) => requestJson(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}, 'No se pudo guardar el tipo de servicio.')

export const serviceCatalogRepository = {
  create: (service, revision) => write('/api/services', 'POST', { service, revision }),
  update: (service, base, revision) => write(`/api/services/${encodeURIComponent(String(service.id))}`, 'PUT', { service, base, revision }),
  toggleStatus: (service, revision) => write(`/api/services/${encodeURIComponent(String(service.id))}/status`, 'PATCH', { base: service, revision }),
  remove: (service, revision) => write(`/api/services/${encodeURIComponent(String(service.id))}`, 'DELETE', { base: service, revision })
}
