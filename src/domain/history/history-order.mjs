const actionableStatuses = new Set(['Pendiente', 'Requiere revisión'])

export const historyStatusPriority = record => {
  const status = record?.status || 'Pendiente'
  if (actionableStatuses.has(status)) return 0
  if (status === 'Completado') return 1
  return 2
}

export function sortOperationalHistory(left, right) {
  const statusOrder = historyStatusPriority(left) - historyStatusPriority(right)
  if (statusOrder) return statusOrder

  const actionable = historyStatusPriority(left) === 0
  const leftDate = String(left?.date || (actionable ? '9999-12-31' : ''))
  const rightDate = String(right?.date || (actionable ? '9999-12-31' : ''))
  const dateOrder = actionable
    ? leftDate.localeCompare(rightDate)
    : rightDate.localeCompare(leftDate)
  if (dateOrder) return dateOrder

  const leftTime = String(left?.time || left?.scheduledTime || '99:99')
  const rightTime = String(right?.time || right?.scheduledTime || '99:99')
  const timeOrder = actionable
    ? leftTime.localeCompare(rightTime)
    : rightTime.localeCompare(leftTime)
  return timeOrder || String(left?.client || '').localeCompare(String(right?.client || ''), 'es', { numeric: true, sensitivity: 'base' })
}
