import { normalizeServiceEstimatedMinutes } from '../agenda/service-scheduling.mjs'
import { normalizeServiceName } from '../shared/normalization.mjs'

export const serviceCode = service => service?.code || (
  normalizeServiceName(service?.name) === 'instalacion de alarma'
    ? 'alarm-installation'
    : `service-${service?.id}`
)

export const formatServiceEstimatedTime = value => {
  const minutes = normalizeServiceEstimatedMinutes(value)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return [hours ? `${hours} h` : '', remainingMinutes ? `${remainingMinutes} min` : '']
    .filter(Boolean)
    .join(' ')
}
