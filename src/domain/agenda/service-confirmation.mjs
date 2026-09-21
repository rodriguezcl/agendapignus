export const awaitingServiceConfirmation = record => record?.awaitingConfirmation === true
export const canChangeServiceConfirmation = record => Boolean(record && !record.vehicleControl && !record.startedAt && !record.completedAt && !record.technicalStatus && !record.technicianRequest && !['Completado', 'Cancelado', 'Reprogramado', 'Requiere revisión'].includes(record.status))
