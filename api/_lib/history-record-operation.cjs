function historyRecordMatchesTask(task, record) {
  return Boolean(
    (task?.historyId && String(task.historyId) === String(record?.id)) ||
    (record?.sourceTaskId && task?.taskId && String(task.taskId) === String(record.sourceTaskId))
  )
}

function synchronizeAgendaHistoryRecord(value, previous, next) {
  if (Array.isArray(value)) return value.map(item => synchronizeAgendaHistoryRecord(item, previous, next))
  if (!value || typeof value !== 'object') return value
  const updated = historyRecordMatchesTask(value, previous) ? {
    ...value,
    status: next.status,
    scheduledDate: next.scheduledDate || '',
    customerId: next.customerId ?? value.customerId,
    clientAccount: next.clientAccount ?? value.clientAccount,
    clientNameAtService: next.clientNameAtService ?? value.clientNameAtService,
    client: next.client ?? value.client,
    serviceId: next.serviceId ?? value.serviceId,
    service: next.service ?? value.service,
    estimatedMinutes: next.estimatedMinutes ?? value.estimatedMinutes,
    estimatedMinutesCustomized: next.estimatedMinutesCustomized ?? value.estimatedMinutesCustomized,
    technicianIds: next.technicianIds ?? value.technicianIds,
    technicians: next.technicians ?? value.technicians,
    address: next.address ?? value.address,
    phone: next.phone ?? value.phone,
    detail: next.detail ?? value.detail,
    internalNote: next.internalNote ?? value.internalNote,
    internalChecklist: next.internalChecklist ?? value.internalChecklist,
    ...(next.completedAt ? { completedAt: next.completedAt } : {})
  } : value
  return Object.fromEntries(Object.entries(updated).map(([key, item]) => [key, synchronizeAgendaHistoryRecord(item, previous, next)]))
}

module.exports = { historyRecordMatchesTask, synchronizeAgendaHistoryRecord }
