const actionableStatuses = new Set(['Pendiente', 'Requiere revisión'])

export const historyStatusPriority = record => {
  const status = record?.status || 'Pendiente'
  if (actionableStatuses.has(status)) return 0
  if (status === 'Completado') return 1
  return 2
}

export function sortOperationalHistory(left, right) {
  const dateOrder = String(left?.date || '9999-12-31').localeCompare(String(right?.date || '9999-12-31'))
  if (dateOrder) return dateOrder
  const timeOrder = String(left?.time || left?.scheduledTime || '99:99').localeCompare(String(right?.time || right?.scheduledTime || '99:99'))
  return timeOrder || String(left?.client || '').localeCompare(String(right?.client || ''), 'es', { numeric: true, sensitivity: 'base' })
}
