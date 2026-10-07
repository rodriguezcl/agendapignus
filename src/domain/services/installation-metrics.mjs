import { normalizeServiceName } from '../shared/normalization.mjs'
import { serviceTypesFor } from './multi-service.mjs'

function matchesInstallation(type, services, alarmOnly) {
  const configured = services.find(service => type.id != null && String(service.id) === String(type.id))
    || services.find(service => normalizeServiceName(service.name) === normalizeServiceName(type.name))
  const name = normalizeServiceName(configured?.name || type.name)
  if (/^reinstalacion\b/.test(name)) return false
  if (alarmOnly) return configured?.code === 'alarm-installation' || name === 'instalacion de alarma'
  return configured?.category === 'installation' || /^instalacion\b/.test(name)
}

export const isInstallationRecord = (record, services = []) =>
  serviceTypesFor(record).some(type => matchesInstallation(type, services, false))

export const isAlarmInstallationRecord = (record, services = []) =>
  !record.subscriberReservation && serviceTypesFor(record).some(type => matchesInstallation(type, services, true))
