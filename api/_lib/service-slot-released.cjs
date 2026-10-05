// Shared by browser availability and server overlap validation.
function serviceSlotReleased(task, day = task?.date) {
  if (!task) return false
  if (task.status === 'Cancelado' || task.technicalStatus === 'Cancelado') return true
  if (task.status === 'Reprogramado') {
    return !task.scheduledDate || task.scheduledDate !== day
  }
  return task.status === 'Reprogramación pendiente'
    || task.technicalStatus === 'Reprogramación solicitada'
    || task.technicianRequest === 'Reprogramación solicitada'
}

module.exports = { serviceSlotReleased }
