import { serviceRecordFingerprint } from './service-concurrency.mjs'
import { multiServicePatch, selectedServiceIds, serviceTypesFor } from '../services/multi-service.mjs'

// These display/default fields may be hydrated in the client for legacy rows.
// The correction never writes them; customerId and all source data still take
// part in the concurrency check.
const correctionBase = ({ clientAccount, clientNameAtService, estimatedMinutesCustomized, ...record }) => record

export function correctServiceCategory(state, input, user, now = new Date().toISOString()) {
  const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
  if (user?.roleCode !== 'administrator') fail('Sólo Administración puede corregir la categoría de un servicio completado.', 403)
  const before = state.history.find(record => String(record.id) === String(input.recordId))
  if (!before) fail('El servicio ya no existe.', 404)
  if (!input.base || serviceRecordFingerprint(correctionBase(before)) !== serviceRecordFingerprint(correctionBase(input.base))) fail('El servicio cambió desde otra sesión. Cerrá y volvé a abrir el detalle antes de corregirlo.', 409)
  if (before.status !== 'Completado' && before.technicalStatus !== 'Completado') fail('Esta corrección corresponde a servicios completados.')
  if (before.vehicleControl || before.serviceJourney) fail('Esta corrección sólo admite servicios individuales, sin controles vehiculares ni jornadas vinculadas.')
  const reason = String(input.reason || '').trim()
  if (!reason || reason.length > 1000) fail('Indicá el motivo de la corrección (hasta 1000 caracteres).')
  const ids = Array.isArray(input.serviceIds) ? [...new Set(input.serviceIds.map(String))] : []
  if (!ids.length || ids.some(id => !state.services.some(service => String(service.id) === id && service.status === 'Activo' && !service.system))) fail('Seleccioná tipos de servicio activos del catálogo.')
  if (JSON.stringify([...selectedServiceIds(before)].sort()) === JSON.stringify([...ids].sort())) fail('Seleccioná una categoría distinta de la registrada.')
  const { serviceId, service, serviceTypes } = multiServicePatch(before, ids, state.services)
  const after = { ...before, serviceId, service, serviceTypes, categoryCorrections: [...(before.categoryCorrections || []), {
    at: now, actor: { id: user.id, name: user.name }, reason,
    before: { serviceId: before.serviceId ?? '', service: before.service ?? '', serviceTypes: serviceTypesFor(before) },
    after: { serviceId, service, serviceTypes }
  }] }
  return { before, after, state: { ...state, history: state.history.map(record => record === before ? after : record) } }
}
