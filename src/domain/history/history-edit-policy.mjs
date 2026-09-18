export const requiresDifferentRescheduleDay = record =>
  record?.status === 'Reprogramación pendiente' ||
  record?.technicalStatus === 'Reprogramación solicitada' ||
  record?.technicianRequest === 'Reprogramación solicitada'
