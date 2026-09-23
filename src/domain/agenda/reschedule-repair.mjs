const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

/**
 * Returns only reprogrammed records whose destination agenda is still open.
 * Historical agendas are authoritative snapshots: rebuilding one while an
 * unrelated History record changes would look like a forbidden late service.
 */
export function agendaRescheduleRepairCandidates(records = [], today = '') {
  if (!validDate(today)) return []
  return (records || []).filter(record => (
    validDate(record?.date) &&
    record.date >= today &&
    validDate(record?.rescheduledFrom) &&
    record.rescheduledFrom !== record.date
  ))
}

// Reprogramming persists the weekly projection as the previous task enriched
// with the authoritative history record. Repairing that projection in the UI
// must keep the same representation: replacing it with a smaller display-only
// object makes compare-and-swap treat the user's next edit as a concurrent
// modification even when nobody else changed the service.
export function rescheduledAgendaTask(record, persistedTask = null) {
  if (!record?.id) return persistedTask
  return {
    ...(persistedTask || {}),
    ...record,
    taskId: record.sourceTaskId || persistedTask?.taskId || record.id,
    historyId: record.id
  }
}
