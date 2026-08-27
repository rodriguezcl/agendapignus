const actionableStatuses = new Set(['Pendiente', 'Requiere revisión'])

export const historyStatusPriority = record => actionableStatuses.has(record?.status || 'Pendiente') ? 0 : 1

export function sortOperationalHistory(left, right) {
  const dateOrder = String(right?.date || '').localeCompare(String(left?.date || ''))
  if (dateOrder) return dateOrder
  const statusOrder = historyStatusPriority(left) - historyStatusPriority(right)
  if (statusOrder) return statusOrder
  const leftTime = String(left?.time || left?.scheduledTime || '99:99')
  const rightTime = String(right?.time || right?.scheduledTime || '99:99')
  return leftTime.localeCompare(rightTime) || String(left?.client || '').localeCompare(String(right?.client || ''), 'es', { numeric: true, sensitivity: 'base' })
}
