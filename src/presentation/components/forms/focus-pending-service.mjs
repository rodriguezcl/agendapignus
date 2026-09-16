export function focusPendingService(taskId, root = document) {
  if (!taskId) return false
  const row = [...root.querySelectorAll('[data-daily-task-id]')]
    .find(element => element.getAttribute('data-daily-task-id') === String(taskId))
  if (!row) return false
  row.focus({ preventScroll: true })
  row.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  return true
}
