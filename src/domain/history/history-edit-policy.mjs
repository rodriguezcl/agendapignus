export const hasServiceActivity = record => Boolean(
  record?.startedAt || record?.completedAt || record?.technicalStatus ||
  record?.technicalReportedAt || record?.technicalObservation || record?.technicianRequest ||
  record?.reschedulingHistory?.length || ['Completado', 'Requiere revisión', 'Reprogramación pendiente'].includes(record?.status)
)

const protectedFields = ['customerId', 'client', 'clientAccount', 'clientNameAtService', 'serviceId', 'service', 'address', 'phone']

export function protectServiceIdentity(record, patch) {
  if (!hasServiceActivity(record)) return patch
  const safe = { ...patch }
  for (const key of protectedFields) {
    if (Object.hasOwn(record, key)) safe[key] = record[key]
    else delete safe[key]
  }
  return safe
}
