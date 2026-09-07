import { requestJson } from '../http/json-request.mjs'

const write = (url, method, body) => requestJson(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}, 'No se pudo guardar el vehículo.')

export const vehicleRepository = {
  create: (vehicle, revision) => write('/api/vehicles', 'POST', { vehicle, revision }),
  update: (vehicle, base, revision) => write(`/api/vehicles/${encodeURIComponent(String(vehicle.id))}`, 'PUT', { vehicle, base, revision }),
  remove: (vehicle, revision) => write(`/api/vehicles/${encodeURIComponent(String(vehicle.id))}`, 'DELETE', { base: vehicle, revision })
}
