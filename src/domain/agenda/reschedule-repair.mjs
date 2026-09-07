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
