import {
  DEFAULT_SERVICE_ESTIMATED_MINUTES,
  MAX_SERVICE_ESTIMATED_MINUTES,
  normalizeServiceEstimatedMinutes
} from '../agenda/service-scheduling.mjs'
import { normalizeServiceName } from '../shared/normalization.mjs'
import { serviceCode } from './service.mjs'

export const blankService = () => ({
  name: '',
  description: '',
  estimatedMinutes: DEFAULT_SERVICE_ESTIMATED_MINUTES,
  status: 'Activo'
})

export function buildServiceRecord(form, editingId, idFactory = () => Date.now()) {
  const estimatedMinutes = Number(form?.estimatedMinutes)
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 15 || estimatedMinutes > MAX_SERVICE_ESTIMATED_MINUTES) {
    throw new RangeError('Definí un tiempo estimado de entre 15 minutos y 12 horas.')
  }
  const id = editingId || idFactory()
  return {
    ...form,
    estimatedMinutes,
    id,
    code: editingId ? serviceCode(form) : `service-${id}`,
    category: editingId
      ? (form.category || 'service')
      : (normalizeServiceName(form.name).startsWith('instalacion') ? 'installation' : 'service')
  }
}

export function serviceIsReferenced(serviceId, history = [], teams = [], weekly = {}) {
  const agendaTeams = [
    ...(teams || []),
    ...Object.entries(weekly || {}).flatMap(([key, value]) => (
      key === '_monthlyTeams'
        ? Object.values(value || {}).flatMap(config => config?.teams || [])
        : key.startsWith('_') ? [] : value?.teams || []
    ))
  ]
  return history.some(record => String(record.serviceId) === String(serviceId)) || agendaTeams.some(team => (
    team.tasks || []
  ).some(task => String(task.serviceId) === String(serviceId)))
}

export const editableService = service => ({
  ...service,
  estimatedMinutes: normalizeServiceEstimatedMinutes(service?.estimatedMinutes)
})
